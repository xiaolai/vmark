/**
 * AI Provider Store
 *
 * Purpose: Manages available AI providers (CLI like Claude/Ollama, REST like
 *   Anthropic API/OpenAI/Google AI) and the user's active selection.
 *
 * Pipeline: App startup → onRehydrateStorage → loadEnvApiKeys() fills empty
 *   API key fields from env vars → detectProviders() invokes Rust to scan
 *   PATH for CLI tools → auto-selects first available if none set.
 *
 * Key decisions:
 *   - CLI vs REST distinction: CLI providers are detected via Rust PATH scan,
 *     REST providers are configured with endpoint/key in the UI.
 *   - Race guard (_detectId counter) prevents stale detection results from
 *     overwriting fresh data when multiple detections run concurrently.
 *   - Never auto-overwrites explicit user selection — if a CLI goes missing,
 *     the error surfaces at invocation time rather than silently switching.
 *   - Persist version migrations strip dead fields and merge new defaults.
 *
 * @coordinates-with geniesStore.ts — genies use the active provider for execution
 * @coordinates-with ai_provider.rs — Rust backend for CLI detection and env key reading
 * @module stores/aiProviderStore
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type {
  CliProviderInfo,
  RestProviderConfig,
  ProviderType,
  RestProviderType,
} from "@/types/aiGenies";

// ============================================================================
// Types
// ============================================================================

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
  setActiveProvider(type: ProviderType): void;
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

// ============================================================================
// Default REST providers
// ============================================================================

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

/** REST provider types (need API key). CLI types are everything else. */
export const REST_TYPES = new Set<string>(["anthropic", "openai", "google-ai", "ollama-api"]);

/** Ollama API doesn't require an API key. */
export const KEY_OPTIONAL_REST = new Set<string>(["ollama-api"]);

// Race guard counter for detectProviders
let _detectId = 0;

// ============================================================================
// Store
// ============================================================================

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
            // No active provider — auto-select first available CLI,
            // or first REST with an API key configured
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
          console.error("Failed to detect providers:", e);
          if (thisDetectId === _detectId) {
            set({ detecting: false });
          }
        }
      },

      ensureProvider: async () => {
        const { activeProvider, cliProviders } = get();
        if (activeProvider) {
          // CLI provider selected but detection hasn't populated the list yet —
          // run detection to populate cliProviders (won't overwrite selection).
          if (!REST_TYPES.has(activeProvider) && cliProviders.length === 0) {
            await get().detectProviders();
          }
          return true;
        }
        // No provider at all — detect and auto-select
        await get().detectProviders();
        return get().activeProvider !== null;
      },

      setActiveProvider: (type) => {
        set({ activeProvider: type });
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
              // Only fill if the field is currently empty
              if (envKey && !p.apiKey) {
                return { ...p, apiKey: envKey };
              }
              return p;
            }),
          }));
        } catch (e) {
          // Non-critical — user can still type keys manually
          console.warn("Failed to read env API keys:", e);
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
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeProvider: state.activeProvider,
        restProviders: state.restProviders,
      }),
      onRehydrateStorage: () => {
        // After hydration:
        // 1. Fill empty API key fields from environment variables.
        // 2. Detect CLI providers so the CLI section is populated on startup.
        return () => {
          useAiProviderStore.getState().loadEnvApiKeys();
          useAiProviderStore.getState().detectProviders();
        };
      },
      migrate: (persisted, version) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data = persisted as any;
        if (version < 1) {
          // v0 → v1: merge DEFAULT_REST_PROVIDERS by type, preserving user overrides
          const merged = DEFAULT_REST_PROVIDERS.map((def) => {
            const existing = data.restProviders?.find(
              (p: RestProviderConfig) => p.type === def.type
            );
            return existing
              ? { ...def, ...existing, apiKey: "" }
              : def;
          });
          data = {
            activeProvider: data.activeProvider ?? null,
            restProviders: merged,
          };
        }
        if (version < 2) {
          // v1 → v2: strip dead `enabled` field from REST providers
          if (Array.isArray(data.restProviders)) {
            data.restProviders = data.restProviders.map(
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              ({ enabled, ...rest }: RestProviderConfig & { enabled?: boolean }) => rest
            );
          }
        }
        return data as AiProviderState;
      },
    }
  )
);
