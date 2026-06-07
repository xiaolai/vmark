/**
 * AI Provider store — REST + CLI provider configs with persistence.
 *
 * REST provider configs (endpoint, model, name) persist to `tauri-plugin-store`
 * (`vmark-ai-providers`). API keys are NOT persisted there — RW-16 (L8) routes
 * them through the OS keychain (`services/secrets/apiKeySecrets`); the store
 * holds keys only in memory for the active session. CLI providers are detected
 * at runtime via `detect_ai_providers`.
 *
 * @coordinates-with src/services/secrets/apiKeySecrets — keychain key store
 * @module stores/aiStore/provider
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { createSecureStorage } from "@/utils/secureStorage";
import {
  loadApiKeysWithStatus,
  migrateLegacyApiKeys,
  setApiKey,
} from "@/services/secrets/apiKeySecrets";
import { aiProviderError, aiProviderLog, aiProviderWarn } from "@/utils/debug";
import { imeToast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import type {
  CliProviderInfo,
  RestProviderConfig,
  ProviderType,
  RestProviderType,
} from "@/types/aiGenies";

interface AiProviderState {
  activeProvider: ProviderType | null;
  cliProviders: CliProviderInfo[];
  restProviders: RestProviderConfig[];
  detecting: boolean;
}

interface AiProviderActions {
  detectProviders(): Promise<void>;
  /** Ensure a provider is available. Auto-detects if none set. Returns true if ready. */
  ensureProvider(): Promise<boolean>;
  /** Activate a provider — sets it as active and syncs REST `enabled` flags. */
  activateProvider(type: ProviderType): void;
  updateRestProvider(
    type: RestProviderType,
    updates: Partial<RestProviderConfig>
  ): void;
  /** Load API keys from environment variables into empty REST provider fields. */
  loadEnvApiKeys(): Promise<void>;
  getActiveProviderName(): string;
}

const DEFAULT_REST_PROVIDERS: RestProviderConfig[] = [
  {
    type: "anthropic",
    name: "Anthropic",
    endpoint: "https://api.anthropic.com",
    apiKey: "",
    model: "claude-sonnet-4-5-20250929",
  },
  {
    type: "openai",
    name: "OpenAI",
    endpoint: "https://api.openai.com",
    apiKey: "",
    model: "gpt-4o",
  },
  {
    type: "google-ai",
    name: "Google AI",
    endpoint: "",
    apiKey: "",
    model: "gemini-2.0-flash",
  },
  {
    type: "ollama-api",
    name: "Ollama (API)",
    endpoint: "http://localhost:11434",
    apiKey: "",
    model: "llama3.2",
  },
];

/**
 * Shape-guard one persisted REST provider entry (T4). Coerces missing/
 * wrong-typed string fields to `""` so a tampered or stale secure-store blob
 * can't inject `undefined`/non-string fields downstream. Returns null for
 * entries with no string `type` — the identity key is unusable without it.
 */
function sanitizeRestProvider(raw: unknown): RestProviderConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== "string") return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    type: r.type as RestProviderType,
    name: str(r.name),
    endpoint: str(r.endpoint),
    apiKey: str(r.apiKey),
    model: str(r.model),
  };
}

/**
 * Validate/normalize the persisted AI-provider blob at the migrate boundary
 * (T4, zero-trust). Replaces a blind `as unknown as AiProviderState` cast:
 * drops a non-array `restProviders` and malformed entries, and coerces
 * `activeProvider` to `string | null`. A fully-malformed blob recovers to
 * defaults (onRehydrateStorage backfills DEFAULT_REST_PROVIDERS).
 *
 * Exported for testing.
 */
export function sanitizeAiProviderPersist(data: Record<string, unknown>): {
  activeProvider: ProviderType | null;
  restProviders: RestProviderConfig[];
} {
  const activeProvider =
    typeof data.activeProvider === "string"
      ? (data.activeProvider as ProviderType)
      : null;
  const restProviders = Array.isArray(data.restProviders)
    ? data.restProviders
        .map(sanitizeRestProvider)
        .filter((p): p is RestProviderConfig => p !== null)
    : [];
  return { activeProvider, restProviders };
}

/** REST provider type identifiers that require API key configuration. CLI types are everything else. */
export const REST_TYPES = new Set<string>(["anthropic", "openai", "google-ai", "ollama-api"]);

/** Ollama API doesn't require an API key. */
export const KEY_OPTIONAL_REST = new Set<string>(["ollama-api"]);

// Race guard counter for detectProviders
let _detectId = 0;

/**
 * audit-fix(r2) — surface a keychain write failure to the user.
 *
 * Dev-logs the failure (for diagnostics) AND raises a visible error toast so a
 * user whose API key failed to persist learns it now, instead of silently
 * losing the key on the next restart. Kept side-effecting and non-throwing so
 * it can be called from the fire-and-forget `setApiKey().then(...)` path.
 */
function reportKeySaveFailure(type: RestProviderType): void {
  aiProviderError(
    "Failed to persist API key to keychain (in-memory only; will be lost on restart):",
    type
  );
  imeToast.error(
    i18n.t("ai:provider.keySaveError", {
      defaultValue: "Failed to save API key to keychain. It will be lost when you restart.",
    })
  );
}

/** Manages available AI providers (CLI and REST), detection, and active selection with persistence. Use selectors, not destructuring. */
export const useAiProviderStore = create<AiProviderState & AiProviderActions>()(
  persist(
    (set, get) => ({
      activeProvider: null,
      cliProviders: [],
      restProviders: DEFAULT_REST_PROVIDERS,
      detecting: false,

      detectProviders: async () => {
        const thisDetectId = ++_detectId;
        set({ detecting: true });
        try {
          type RawEntry = {
            type: string;
            name: string;
            command: string;
            available: boolean;
            path?: string;
          };
          const raw: RawEntry[] = await invoke("detect_ai_providers");

          // Stale check
          if (thisDetectId !== _detectId) return;

          const providers: CliProviderInfo[] = raw.map((r) => ({
            type: r.type as CliProviderInfo["type"],
            name: r.name,
            command: r.command,
            available: r.available,
            path: r.path,
          }));
          set({ cliProviders: providers, detecting: false });

          // Auto-select only when no provider is set.
          // Never overwrite an explicit user selection — if the CLI
          // they chose is unavailable, surface the error at invocation time.
          const { activeProvider, restProviders } = get();
          if (!activeProvider) {
            const firstCli = providers.find((p) => p.available);
            if (firstCli) {
              set({ activeProvider: firstCli.type });
            } else {
              const firstReadyRest = restProviders.find(
                (p) => p.apiKey && !KEY_OPTIONAL_REST.has(p.type)
              ) ?? restProviders.find((p) => KEY_OPTIONAL_REST.has(p.type));
              if (firstReadyRest) {
                set({ activeProvider: firstReadyRest.type });
              }
            }
          }
        } catch (e) {
          aiProviderLog("Failed to detect providers:", e);
          if (thisDetectId === _detectId) {
            set({ detecting: false });
          }
        }
      },

      ensureProvider: async () => {
        const { activeProvider, cliProviders } = get();
        if (activeProvider) {
          if (!REST_TYPES.has(activeProvider) && cliProviders.length === 0) {
            await get().detectProviders();
          }
          return true;
        }
        await get().detectProviders();
        return get().activeProvider !== null;
      },

      activateProvider: (type) => {
        set({ activeProvider: type });
      },

      updateRestProvider: (type, updates) => {
        set((state) => ({
          restProviders: state.restProviders.map((p) =>
            p.type === type ? { ...p, ...updates } : p
          ),
        }));
        // RW-16 (L8): the API key is a secret — persist it to the OS keychain,
        // never to the plaintext store. Other fields ride the normal persist.
        // audit-fix(r2) — surface keychain write failures to the user via a
        // toast (not dev-log-only): a silent failure leaves the new key only in
        // memory (lost on restart) while the UI shows it as saved. The write
        // stays fire-and-forget so the sync action never blocks on the keychain.
        if (Object.prototype.hasOwnProperty.call(updates, "apiKey")) {
          void setApiKey(type, updates.apiKey ?? "").then((ok) => {
            if (!ok) reportKeySaveFailure(type);
          });
        }
      },

      loadEnvApiKeys: async () => {
        try {
          const envKeys: Record<string, string> =
            await invoke("read_env_api_keys");
          set((state) => ({
            restProviders: state.restProviders.map((p) => {
              const envKey = envKeys[p.type];
              if (envKey && !p.apiKey) {
                return { ...p, apiKey: envKey };
              }
              return p;
            }),
          }));
        } catch (e) {
          aiProviderWarn("Failed to read env API keys:", e);
        }
      },

      getActiveProviderName: () => {
        const { activeProvider, cliProviders, restProviders } = get();
        if (!activeProvider) return "None";
        const cli = cliProviders.find((p) => p.type === activeProvider);
        if (cli) return cli.name;
        const rest = restProviders.find((p) => p.type === activeProvider);
        if (rest) return rest.name;
        return activeProvider;
      },
    }),
    {
      name: "vmark-ai-providers",
      version: 2,
      storage: createJSONStorage(() => createSecureStorage()),
      partialize: (state) => ({
        activeProvider: state.activeProvider,
        // RW-16 (L8): never persist API keys to the plaintext store. Strip
        // `apiKey` from every entry; the keychain is the source of truth and
        // keys are rehydrated into memory by hydrateAndMigrateApiKeys.
        restProviders: state.restProviders.map(
          ({ apiKey: _apiKey, ...rest }) => ({ ...rest, apiKey: "" })
        ),
      }),
      onRehydrateStorage: () => {
        return () => {
          const { restProviders } = useAiProviderStore.getState();
          const existingTypes = new Set(restProviders.map((p) => p.type));
          const newDefaults = DEFAULT_REST_PROVIDERS.filter(
            (d) => !existingTypes.has(d.type)
          );
          if (newDefaults.length > 0) {
            useAiProviderStore.setState({
              restProviders: [...restProviders, ...newDefaults],
            });
          }
          // RW-16 (L8): migrate any plaintext keys that survived in the old
          // persisted blob into the keychain, then load keychain keys into the
          // in-memory store. Runs before loadEnvApiKeys so env keys only fill
          // genuinely-empty fields.
          void hydrateAndMigrateApiKeys().finally(() => {
            useAiProviderStore.getState().loadEnvApiKeys();
            useAiProviderStore.getState().detectProviders();
          });
        };
      },
      migrate: (persisted, version) => {
        const data = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          const providers = data.restProviders;
          if (Array.isArray(providers)) {
            data.restProviders = providers.map(

              ({ enabled: _enabled, ...rest }: RestProviderConfig & { enabled?: boolean }) => rest
            );
          }
        }
        // T4: validate the persisted/3rd-party JSON shape before trusting it as
        // AiProviderState (zero-trust at the persist boundary). The partialized
        // shape is `{ activeProvider, restProviders }`; the rest of the store
        // (cliProviders, detecting, actions) comes from the initializer via the
        // default shallow merge.
        return sanitizeAiProviderPersist(data) as unknown as AiProviderState;
      },
    }
  )
);

/**
 * RW-16 (L8): one-time migration + keychain hydration of API keys.
 *
 * Runs after persist rehydration. Two phases, both safe to repeat:
 *   1. Migrate: any plaintext key that survived in the rehydrated state (an
 *      old persisted blob written before keys moved to the keychain) is lifted
 *      into the keychain — only when the keychain slot for that type is still
 *      empty, so a newer keychain value is never clobbered.
 *   2. Hydrate: read every provider's key from the keychain into the in-memory
 *      store, which is the live session source.
 *
 * After this, the persist layer re-saves with `apiKey: ""` (see partialize),
 * so the plaintext store no longer holds secrets. Never throws.
 *
 * Exported for testing.
 */
export async function hydrateAndMigrateApiKeys(): Promise<void> {
  const { restProviders } = useAiProviderStore.getState();
  const types = restProviders.map((p) => p.type);

  // Phase 1: migrate any plaintext keys left in the rehydrated state.
  const legacy: Record<string, string> = {};
  for (const p of restProviders) {
    if (p.apiKey) legacy[p.type] = p.apiKey;
  }
  if (Object.keys(legacy).length > 0) {
    await migrateLegacyApiKeys(legacy);
  }

  // Phase 2: load keychain keys into memory (authoritative for the session).
  // audit-fix — status-aware: only overwrite the in-memory key when the read
  // succeeded. `present` → use the keychain value; `absent` → clear to ""
  // (genuinely unset). On `error` (or an unread type) preserve whatever is
  // already in memory so a transient keychain failure can't blank a live key.
  const statuses = await loadApiKeysWithStatus(types);
  useAiProviderStore.setState((state) => ({
    restProviders: state.restProviders.map((p) => {
      const res = statuses[p.type];
      if (!res || res.status === "error") return p; // preserve in-memory key
      return { ...p, apiKey: res.status === "present" ? res.value : "" };
    }),
  }));
}
