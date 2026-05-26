/**
 * AI Provider store — REST + CLI provider configs with persistence.
 *
 * REST provider configs persist to secure storage (`vmark-ai-providers`).
 * CLI providers are detected at runtime via `detect_ai_providers`.
 *
 * @module stores/aiStore/provider
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { createSecureStorage } from "@/utils/secureStorage";
import { aiProviderLog, aiProviderWarn } from "@/utils/debug";
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

/** REST provider type identifiers that require API key configuration. CLI types are everything else. */
export const REST_TYPES = new Set<string>(["anthropic", "openai", "google-ai", "ollama-api"]);

/** Ollama API doesn't require an API key. */
export const KEY_OPTIONAL_REST = new Set<string>(["ollama-api"]);

// Race guard counter for detectProviders
let _detectId = 0;

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
        restProviders: state.restProviders,
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
          useAiProviderStore.getState().loadEnvApiKeys();
          useAiProviderStore.getState().detectProviders();
        };
      },
      migrate: (persisted, version) => {
        const data = persisted as Record<string, unknown>;
        if (version < 2) {
          const providers = data.restProviders;
          if (Array.isArray(providers)) {
            data.restProviders = providers.map(

              ({ enabled: _enabled, ...rest }: RestProviderConfig & { enabled?: boolean }) => rest
            );
          }
        }
        return data as unknown as AiProviderState;
      },
    }
  )
);
