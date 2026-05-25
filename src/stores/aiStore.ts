/**
 * AI Store — T09 consolidation.
 *
 * Co-locates 5 legacy AI-related stores in a single file. Each store
 * keeps its own Zustand instance and persist middleware so the existing
 * localStorage keys (`vmark-genies`, `vmark-ai-providers`,
 * `vmark-prompt-history`) and the secure provider-keys storage stay
 * untouched. The file count drops from 5 to 1.
 *
 * Sections:
 *   - aiInvocationStore   — invocation lifecycle (isRunning, cancel)
 *   - aiProviderStore     — REST/CLI provider configs (persisted, secure-storage for API keys)
 *   - aiSuggestionStore   — pending AI suggestions for the editor
 *   - geniesStore         — genie definitions + recent (persisted)
 *   - promptHistoryStore  — last user prompt per genie (persisted)
 *
 * @module stores/aiStore
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { createSafeStorage } from "@/utils/safeStorage";
import { createSecureStorage } from "@/utils/secureStorage";
import { aiProviderLog, aiProviderWarn, geniesWarn, geniesLog } from "@/utils/debug";
import type {
  CliProviderInfo,
  RestProviderConfig,
  ProviderType,
  RestProviderType,
} from "@/types/aiGenies";
import type { AiSuggestion, SuggestionType } from "@/plugins/aiSuggestion/types";
import { AI_SUGGESTION_EVENTS } from "@/plugins/aiSuggestion/types";
import type { GenieDefinition, GenieMetadata, GenieScope } from "@/types/aiGenies";

// ============================================================================
// AI Invocation (T09 — formerly aiInvocationStore.ts)
// ============================================================================

interface AiInvocationState {
  isRunning: boolean;
  requestId: string | null;
  elapsedSeconds: number;
  error: string | null;
  showSuccess: boolean;
  hasActiveStatus: boolean;
}

interface AiInvocationActions {
  /** Try to start an invocation. Returns false if already running. */
  tryStart: (requestId: string) => boolean;
  /** Mark invocation as finished successfully. Shows brief success flash. */
  finish: () => void;
  /** Cancel the current invocation and reset all state. */
  cancel: () => void;
  /** Set an error message. Stops the invocation. */
  setError: (message: string) => void;
  /** Dismiss the current error. */
  dismissError: () => void;
}

const initialState: AiInvocationState = {
  isRunning: false,
  requestId: null,
  elapsedSeconds: 0,
  error: null,
  showSuccess: false,
  hasActiveStatus: false,
};

let elapsedInterval: ReturnType<typeof setInterval> | null = null;
let successTimeout: ReturnType<typeof setTimeout> | null = null;

function clearTimers() {
  if (elapsedInterval !== null) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }
  if (successTimeout !== null) {
    clearTimeout(successTimeout);
    successTimeout = null;
  }
}

/** Manages AI genie invocation concurrency — singleton guard, elapsed timer, error state, and success flash. Use selectors, not destructuring. */
export const useAiInvocationStore = create<AiInvocationState & AiInvocationActions>(
  (set, get) => ({
    ...initialState,

    tryStart: (requestId) => {
      if (get().isRunning) return false;
      clearTimers();
      set({
        isRunning: true,
        requestId,
        elapsedSeconds: 0,
        error: null,
        showSuccess: false,
        hasActiveStatus: true,
      });
      elapsedInterval = setInterval(() => {
        set((s) => ({ elapsedSeconds: s.elapsedSeconds + 1 }));
      }, 1000);
      return true;
    },

    finish: () => {
      if (!get().isRunning) return;
      clearTimers();
      set({
        isRunning: false,
        requestId: null,
        elapsedSeconds: 0,
        error: null,
        showSuccess: true,
        hasActiveStatus: true,
      });
      successTimeout = setTimeout(() => {
        set({ showSuccess: false, hasActiveStatus: false });
      }, 3000);
    },

    cancel: () => {
      clearTimers();
      set(initialState);
    },

    setError: (message) => {
      clearTimers();
      set({
        isRunning: false,
        requestId: null,
        elapsedSeconds: 0,
        error: message,
        showSuccess: false,
        hasActiveStatus: true,
      });
    },

    dismissError: () => {
      if (!get().error) return;
      set({ error: null, hasActiveStatus: false });
    },
  })
);

// ============================================================================
// AI Providers (T09 — formerly aiProviderStore.ts)
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

/** REST provider type identifiers that require API key configuration. CLI types are everything else. */
export const REST_TYPES = new Set<string>(["anthropic", "openai", "google-ai", "ollama-api"]);

/** Ollama API doesn't require an API key. */
export const KEY_OPTIONAL_REST = new Set<string>(["ollama-api"]);

// Race guard counter for detectProviders
let _detectId = 0;

// ============================================================================
// Store
// ============================================================================

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
          aiProviderLog("Failed to detect providers:", e);
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
        // After hydration:
        // 1. Merge any new default REST providers that were added since last persist.
        // 2. Fill empty API key fields from environment variables.
        // 3. Detect CLI providers so the CLI section is populated on startup.
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
          // v1 → v2: strip dead `enabled` field from REST providers
          const providers = data.restProviders;
          if (Array.isArray(providers)) {
            data.restProviders = providers.map(
               
              ({ enabled, ...rest }: RestProviderConfig & { enabled?: boolean }) => rest
            );
          }
        }
        return data as unknown as AiProviderState;
      },
    }
  )
);

// ============================================================================
// AI Suggestions (T09 — formerly aiSuggestionStore.ts)
// ============================================================================

interface AiSuggestionState {
  suggestions: Map<string, AiSuggestion>;
  focusedSuggestionId: string | null;
}

interface AiSuggestionActions {
  /** Add a new suggestion. Returns the generated ID. */
  addSuggestion: (params: {
    tabId: string;
    type: SuggestionType;
    from: number;
    to: number;
    newContent?: string;
    originalContent?: string;
  }) => string;

  /** Accept a suggestion by ID */
  acceptSuggestion: (id: string) => void;

  /** Reject a suggestion by ID */
  rejectSuggestion: (id: string) => void;

  /** Remove a suggestion without dispatching accept/reject events.
   *  Used by button handlers that apply changes directly. */
  removeSuggestion: (id: string) => void;

  /** Accept all pending suggestions */
  acceptAll: () => void;

  /** Reject all pending suggestions */
  rejectAll: () => void;

  /** Focus a specific suggestion */
  focusSuggestion: (id: string | null) => void;

  /** Navigate to next suggestion */
  navigateNext: () => void;

  /** Navigate to previous suggestion */
  navigatePrevious: () => void;

  /** Get suggestions sorted by position */
  getSortedSuggestions: () => AiSuggestion[];

  /** Get suggestion by ID */
  getSuggestion: (id: string) => AiSuggestion | undefined;

  /** Clear suggestions for a specific tab (used on tab switch) */
  clearForTab: (tabId: string) => void;

  /** Clear all suggestions (used on document/tab change) */
  clearAll: () => void;
}

const initialSuggestionState: AiSuggestionState = {
  suggestions: new Map(),
  focusedSuggestionId: null,
};

let suggestionCounter = 0;

function generateSuggestionId(): string {
  return `ai-suggestion-${++suggestionCounter}-${Date.now()}`;
}

/**
 * Delete a suggestion and update focus to the next available.
 * Shared by acceptSuggestion, rejectSuggestion, and removeSuggestion.
 */
function deleteAndUpdateFocus(state: AiSuggestionState, id: string): AiSuggestionState {
  const newSuggestions = new Map(state.suggestions);
  newSuggestions.delete(id);

  let newFocusedId: string | null = null;
  if (state.focusedSuggestionId === id && newSuggestions.size > 0) {
    const sorted = Array.from(newSuggestions.values()).sort(
      (a, b) => a.from - b.from
    );
    /* v8 ignore next -- @preserve sorted has at least one element because newSuggestions.size > 0 */
    newFocusedId = sorted[0]?.id ?? null;
  } else if (state.focusedSuggestionId !== id) {
    newFocusedId = state.focusedSuggestionId;
  }

  return {
    suggestions: newSuggestions,
    focusedSuggestionId: newFocusedId,
  };
}

/** Manages AI-generated content suggestions pending user approval — add, accept, reject, and navigation. Use selectors, not destructuring. */
export const useAiSuggestionStore = create<AiSuggestionState & AiSuggestionActions>(
  (set, get) => ({
    ...initialSuggestionState,

    addSuggestion: (params) => {
      const id = generateSuggestionId();
      const suggestion: AiSuggestion = {
        id,
        tabId: params.tabId,
        type: params.type,
        from: params.from,
        to: params.to,
        newContent: params.newContent,
        originalContent: params.originalContent,
        createdAt: Date.now(),
      };

      set((state) => {
        const newSuggestions = new Map(state.suggestions);
        newSuggestions.set(id, suggestion);
        return {
          suggestions: newSuggestions,
          // Auto-focus first suggestion if none focused
          focusedSuggestionId: state.focusedSuggestionId ?? id,
        };
      });

      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.ADDED, { detail: { id, suggestion } })
      );

      return id;
    },

    acceptSuggestion: (id) => {
      const suggestion = get().suggestions.get(id);
      if (!suggestion) return;

      // Dispatch event BEFORE removing from store so plugin can apply the change
      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.ACCEPT, { detail: { id, suggestion } })
      );

      set((state) => deleteAndUpdateFocus(state, id));
    },

    rejectSuggestion: (id) => {
      const suggestion = get().suggestions.get(id);
      if (!suggestion) return;

      // Dispatch event BEFORE removing from store so plugin can restore content
      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.REJECT, { detail: { id, suggestion } })
      );

      set((state) => deleteAndUpdateFocus(state, id));
    },

    removeSuggestion: (id) => {
      if (!get().suggestions.has(id)) return;
      const oldFocusedId = get().focusedSuggestionId;
      set((state) => deleteAndUpdateFocus(state, id));
      const newFocusedId = get().focusedSuggestionId;
      if (newFocusedId && newFocusedId !== oldFocusedId) {
        window.dispatchEvent(
          new CustomEvent(AI_SUGGESTION_EVENTS.FOCUS_CHANGED, { detail: { id: newFocusedId } })
        );
      }
    },

    acceptAll: () => {
      // Get suggestions in reverse position order (for correct position handling)
      const sorted = get().getSortedSuggestions().reverse();
      if (sorted.length === 0) return;

      // Emit single event with all suggestions for batched transaction
      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.ACCEPT_ALL, {
          detail: { suggestions: sorted },
        })
      );

      // Clear all from store
      set({ suggestions: new Map(), focusedSuggestionId: null });
    },

    rejectAll: () => {
      // Get suggestions in reverse position order
      const sorted = get().getSortedSuggestions().reverse();
      if (sorted.length === 0) return;

      // Emit single event for batched rejection (just clears decorations)
      window.dispatchEvent(
        new CustomEvent(AI_SUGGESTION_EVENTS.REJECT_ALL, {
          detail: { suggestions: sorted },
        })
      );

      // Clear all from store
      set({ suggestions: new Map(), focusedSuggestionId: null });
    },

    focusSuggestion: (id) => {
      set({ focusedSuggestionId: id });
      if (id) {
        window.dispatchEvent(
          new CustomEvent(AI_SUGGESTION_EVENTS.FOCUS_CHANGED, { detail: { id } })
        );
      }
    },

    navigateNext: () => {
      const { focusedSuggestionId, suggestions } = get();
      if (suggestions.size === 0) return;

      const sorted = get().getSortedSuggestions();
      /* v8 ignore next -- @preserve double-guard; suggestions.size > 0 guarantees getSortedSuggestions is non-empty */
      if (sorted.length === 0) return;

      const currentIndex = focusedSuggestionId
        ? sorted.findIndex((s) => s.id === focusedSuggestionId)
        : -1;

      const nextIndex = (currentIndex + 1) % sorted.length;
      get().focusSuggestion(sorted[nextIndex].id);
    },

    navigatePrevious: () => {
      const { focusedSuggestionId, suggestions } = get();
      if (suggestions.size === 0) return;

      const sorted = get().getSortedSuggestions();
      /* v8 ignore next -- @preserve double-guard; suggestions.size > 0 guarantees getSortedSuggestions is non-empty */
      if (sorted.length === 0) return;

      const currentIndex = focusedSuggestionId
        ? sorted.findIndex((s) => s.id === focusedSuggestionId)
        : 0;

      const prevIndex = currentIndex <= 0 ? sorted.length - 1 : currentIndex - 1;
      get().focusSuggestion(sorted[prevIndex].id);
    },

    getSortedSuggestions: () => {
      return Array.from(get().suggestions.values()).sort((a, b) => a.from - b.from);
    },

    getSuggestion: (id) => {
      return get().suggestions.get(id);
    },

    clearForTab: (tabId) => {
      const { suggestions, focusedSuggestionId } = get();
      const filtered = new Map<string, AiSuggestion>();
      let focusCleared = false;
      for (const [id, s] of suggestions) {
        if (s.tabId === tabId) {
          if (id === focusedSuggestionId) focusCleared = true;
        } else {
          filtered.set(id, s);
        }
      }
      if (filtered.size !== suggestions.size) {
        set({
          suggestions: filtered,
          focusedSuggestionId: focusCleared ? null : focusedSuggestionId,
        });
      }
    },

    clearAll: () => {
      set({ suggestions: new Map(), focusedSuggestionId: null });
    },
  })
);

// Clear suggestions on tab switch to prevent stale suggestions mutating wrong document.
// Initialized lazily by initSuggestionTabWatcher() to avoid circular imports.
let _tabWatcherInitialized = false;
let _prevActiveTabIds: Record<string, string | null> = {};

/**
 * Reset module-level singletons and store state.
 * For use in tests only — ensures a clean slate between test runs.
 */
export function resetAiSuggestionStore(): void {
  suggestionCounter = 0;
  _tabWatcherInitialized = false;
  _prevActiveTabIds = {};
  useAiSuggestionStore.setState({ suggestions: new Map(), focusedSuggestionId: null });
}

/** Start watching for tab changes. Call once at app startup. */
export function initSuggestionTabWatcher(
  tabStoreSubscribe: (cb: (state: { activeTabId: Record<string, string | null> }) => void) => () => void
): void {
  if (_tabWatcherInitialized) return;
  _tabWatcherInitialized = true;

  tabStoreSubscribe((state) => {
    // Clear suggestions scoped to the previous tab when any window switches tabs.
    // This avoids wiping suggestions that belong to a different window's active tab.
    for (const [label, tabId] of Object.entries(state.activeTabId)) {
      const prevTabId = _prevActiveTabIds[label] ?? null;
      if (prevTabId !== null && tabId !== prevTabId) {
        useAiSuggestionStore.getState().clearForTab(prevTabId);
      }
    }
    _prevActiveTabIds = { ...state.activeTabId };
  });
}

// ============================================================================
// Genies (T09 — formerly geniesStore.ts)
// ============================================================================

// ============================================================================
// Types
// ============================================================================

interface GenieEntry {
  name: string;
  path: string;
  source: string;
  category: string | null;
  /** WI-7.1: discriminator for picker dispatch. */
  kind?: "markdown" | "workflow";
}

interface GenieContent {
  metadata: GenieMetadata;
  template: string;
}

interface GeniesState {
  genies: GenieDefinition[];
  loading: boolean;
  recentGenieNames: string[];
  favoriteGenieNames: string[];
}

interface GeniesActions {
  loadGenies(): Promise<void>;
  searchGenies(query: string, scope?: GenieScope | null): GenieDefinition[];
  getGroupedByCategory(): Map<string, GenieDefinition[]>;
  addRecent(name: string): void;
  toggleFavorite(name: string): void;
  isFavorite(name: string): boolean;
  getRecent(): GenieDefinition[];
}

const MAX_RECENTS = 10;

// Race guard counter for loadGenies — prevents stale results from overwriting
let _loadId = 0;

// ============================================================================
// Store
// ============================================================================

/** Manages loaded AI genie definitions with persisted recent/favorite lists. Use selectors, not destructuring. */
export const useGeniesStore = create<GeniesState & GeniesActions>()(
  persist(
    (set, get) => ({
      genies: [],
      loading: false,
      recentGenieNames: [],
      favoriteGenieNames: [],

      loadGenies: async () => {
        const thisLoadId = ++_loadId;
        set({ loading: true });
        try {
          const entries: GenieEntry[] = await invoke("list_genies");

          // Stale check
          if (thisLoadId !== _loadId) return;

          const genies: GenieDefinition[] = [];
          for (const entry of entries) {
            try {
              const content: GenieContent = await invoke("read_genie", {
                path: entry.path,
              });
              genies.push({
                metadata: {
                  ...content.metadata,
                  // Fall back to folder-based category from listing
                  category: content.metadata.category ?? entry.category ?? undefined,
                },
                template: content.template,
                filePath: entry.path,
                source: "global",
                kind: entry.kind ?? "markdown",
              });
            } catch (e) {
              geniesWarn(`Failed to read genie ${entry.path}:`, e);
            }
          }

          // Stale check after reading all genies
          if (thisLoadId !== _loadId) return;

          // Prune stale recents/favorites
          const genieNames = new Set(genies.map((g) => g.metadata.name));
          const { recentGenieNames, favoriteGenieNames } = get();
          const prunedRecents = recentGenieNames.filter((n) => genieNames.has(n));
          const prunedFavorites = favoriteGenieNames.filter((n) => genieNames.has(n));

          set({
            genies,
            loading: false,
            recentGenieNames: prunedRecents,
            favoriteGenieNames: prunedFavorites,
          });
        } catch (e) {
          geniesLog("Failed to load genies:", e);
          /* v8 ignore next -- @preserve false branch: stale load error, newer load already set loading=false */
          if (thisLoadId === _loadId) {
            set({ loading: false });
          }
        }
      },

      searchGenies: (query, scope) => {
        const { genies } = get();
        const lower = query.toLowerCase();
        return genies.filter((g) => {
          if (scope && g.metadata.scope !== scope) return false;
          if (!lower) return true;
          return (
            g.metadata.name.toLowerCase().includes(lower) ||
            g.metadata.description.toLowerCase().includes(lower) ||
            (g.metadata.category?.toLowerCase().includes(lower) ?? false)
          );
        });
      },

      getGroupedByCategory: () => {
        const { genies } = get();
        const grouped = new Map<string, GenieDefinition[]>();
        for (const g of genies) {
          const cat = g.metadata.category ?? "Uncategorized";
          const list = grouped.get(cat) ?? [];
          list.push(g);
          grouped.set(cat, list);
        }
        return grouped;
      },

      addRecent: (name) => {
        set((state) => {
          const filtered = state.recentGenieNames.filter((n) => n !== name);
          return {
            recentGenieNames: [name, ...filtered].slice(0, MAX_RECENTS),
          };
        });
      },

      toggleFavorite: (name) => {
        set((state) => {
          const isFav = state.favoriteGenieNames.includes(name);
          return {
            favoriteGenieNames: isFav
              ? state.favoriteGenieNames.filter((n) => n !== name)
              : [...state.favoriteGenieNames, name],
          };
        });
      },

      isFavorite: (name) => {
        return get().favoriteGenieNames.includes(name);
      },

      getRecent: () => {
        const { genies, recentGenieNames } = get();
        return recentGenieNames
          .map((name) => genies.find((g) => g.metadata.name === name))
          .filter((g): g is GenieDefinition => g !== undefined);
      },
    }),
    {
      name: "vmark-genies",
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (state) => ({
        recentGenieNames: state.recentGenieNames,
        favoriteGenieNames: state.favoriteGenieNames,
      }),
    }
  )
);

// ============================================================================
// Prompt History (T09 — formerly promptHistoryStore.ts)
// ============================================================================

const MAX_ENTRIES = 100;

interface PromptHistoryState {
  entries: string[];
}

interface PromptHistoryActions {
  addEntry(prompt: string): void;
  clearHistory(): void;
  getFilteredEntries(prefix: string): string[];
}

/** Manages persisted freeform AI prompt history (max 100) with MRU ordering and deduplication. Use selectors, not destructuring. */
export const usePromptHistoryStore = create<
  PromptHistoryState & PromptHistoryActions
>()(
  persist(
    (set, get) => ({
      entries: [],

      addEntry: (prompt) => {
        const trimmed = prompt.trim();
        if (!trimmed) return;

        set((state) => {
          // Remove duplicates (moves to top)
          const filtered = state.entries.filter((e) => e !== trimmed);
          return {
            entries: [trimmed, ...filtered].slice(0, MAX_ENTRIES),
          };
        });
      },

      clearHistory: () => set({ entries: [] }),

      getFilteredEntries: (prefix) => {
        const { entries } = get();
        if (!prefix) return entries;
        const lower = prefix.toLowerCase();
        return entries.filter((e) => e.toLowerCase().includes(lower));
      },
    }),
    {
      name: "vmark-prompt-history",
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (state) => ({
        entries: state.entries,
      }),
    }
  )
);
