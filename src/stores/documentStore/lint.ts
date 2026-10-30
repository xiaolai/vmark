/**
 * Per-tab markdown / YAML lint diagnostics.
 *
 * Owns two lint flows: the synchronous linter the tab's format contributes
 * (`runLintForFormat`), and asynchronous local-link existence checking. The async path
 * is gated by per-tab monotonic tokens so a stale completion can't
 * overwrite a newer one.
 *
 * @coordinates-with stores/settingsStore.ts — subscribed at module init to
 *                   clear diagnostics when the user disables lint
 * @module stores/documentStore/lint
 */

import { create } from "zustand";
import type { LintDiagnostic } from "@/lib/lintEngine";
import { checkLocalLinks } from "@/lib/markdownLinkCheck/check";
import { useSettingsStore } from "@/stores/settingsStore";
import { dispatchEditor } from "@/lib/formats/registry";

interface LintState {
  /** Diagnostics keyed by tabId */
  diagnosticsByTab: Record<string, LintDiagnostic[]>;
  /** Currently selected diagnostic index per tab for navigation */
  selectedIndexByTab: Record<string, number>;
}

/**
 * Per-tab tokens for async link-check ordering. Each runLinkCheck call
 * increments `next` and stamps `byTab[tabId]`. When a Promise resolves,
 * we compare the captured token to the current `byTab[tabId]`; if they
 * differ, a newer call started during our await window and we drop our
 * result. This eliminates the stale-overwrite race Codex flagged.
 *
 * Module-level (not in zustand state) because it's plumbing, not UI
 * state — no component reads it.
 */
const linkCheckTokens = {
  next: 0,
  byTab: {} as Record<string, number>,
};

interface LintActions {
  /**
   * Lint using the linter the FILE'S FORMAT contributes (markdown, YAML, …),
   * replacing ALL prior diagnostics for the tab. A format with no linter
   * yields an empty set.
   */
  runLintForFormat: (
    tabId: string,
    source: string,
    filePath: string | null | undefined,
  ) => LintDiagnostic[];
  /**
   * Run async link-existence check for a specific tab. Append-only —
   * does NOT clear sync diagnostics; merges results in. Returns
   * the merged set. No-op when filePath is null (untitled).
   */
  runLinkCheck: (
    tabId: string,
    source: string,
    filePath: string | null,
  ) => Promise<LintDiagnostic[]>;
  /** Clear diagnostics for a specific tab */
  clearDiagnostics: (tabId: string) => void;
  /** Clear all tabs */
  clearAllDiagnostics: () => void;
  /** Navigate to next diagnostic (wraps around) */
  selectNext: (tabId: string) => void;
  /** Navigate to previous diagnostic (wraps around) */
  selectPrev: (tabId: string) => void;
}

export const useLintStore = create<LintState & LintActions>((set, get) => ({
  diagnosticsByTab: {},
  selectedIndexByTab: {},

  runLintForFormat: (tabId, source, filePath) => {
    const format = (() => {
      try {
        return dispatchEditor(filePath ?? null);
      } catch {
        return undefined;
      }
    })();

    // A format with no linter yields no diagnostics — that is a valid answer,
    // not a fallback to markdown. Silently linting an unknown format AS
    // markdown is exactly the failure-open behaviour Phase 4B removes.
    const diagnostics = format?.lint?.(source) ?? [];

    // A link-check started before this run (or while the tab was another
    // format) must not later overwrite these diagnostics.
    linkCheckTokens.next++;
    delete linkCheckTokens.byTab[tabId];

    set((state) => ({
      diagnosticsByTab: { ...state.diagnosticsByTab, [tabId]: diagnostics },
      selectedIndexByTab: { ...state.selectedIndexByTab, [tabId]: 0 },
    }));
    return diagnostics;
  },

  runLinkCheck: async (tabId, source, filePath) => {
    if (!filePath) return [];
    // Per-tab token guards against stale async
    // results overwriting newer ones. Increment the token before the
    // fs.exists race; only commit results when the token matches at
    // settle time. Older completions resolve their promise but don't
    // touch the store.
    const myToken = ++linkCheckTokens.next;
    linkCheckTokens.byTab[tabId] = myToken;
    const linkDiags = await checkLocalLinks(source, filePath);
    if (linkCheckTokens.byTab[tabId] !== myToken) {
      // A newer link-check started while we were awaiting fs.exists.
      // Drop this result on the floor — the newer call will commit.
      return get().diagnosticsByTab[tabId] ?? [];
    }
    // Merge: REPLACE prior link-check diagnostics (M001/M002) for this
    // tab, preserve other rules' diagnostics. This ensures content
    // changes that fix a broken link clear the old diagnostic, and
    // re-runs with different params replace by content rather than
    // dedupe by id.
    const result = await new Promise<LintDiagnostic[]>((resolve) => {
      set((state) => {
        const existing = state.diagnosticsByTab[tabId] ?? [];
        const nonLinkCheck = existing.filter(
          (d) => d.ruleId !== "M001" && d.ruleId !== "M002",
        );
        const merged = [...nonLinkCheck, ...linkDiags].sort(
          (a, b) => a.line - b.line || a.column - b.column,
        );
        resolve(merged);
        return {
          diagnosticsByTab: { ...state.diagnosticsByTab, [tabId]: merged },
        };
      });
    });
    return result;
  },

  clearDiagnostics: (tabId) => {
    // Invalidate any in-flight runLinkCheck promise for this tab —
    // bumping `next` and clearing byTab[tabId] makes any pending
    // completion's token comparison fail, so it drops its result
    // instead of repopulating the cleared tab.
    linkCheckTokens.next++;
    delete linkCheckTokens.byTab[tabId];
    set((state) => {
      const { [tabId]: _, ...rest } = state.diagnosticsByTab;
      const { [tabId]: __, ...indexRest } = state.selectedIndexByTab;
      return {
        diagnosticsByTab: rest,
        selectedIndexByTab: indexRest,
      };
    });
  },

  clearAllDiagnostics: () => {
    // Same invalidation: nuke all per-tab tokens so every in-flight
    // runLinkCheck Promise drops its result on settle.
    linkCheckTokens.next++;
    linkCheckTokens.byTab = {};
    set({ diagnosticsByTab: {}, selectedIndexByTab: {} });
  },

  selectNext: (tabId) => {
    set((state) => {
      const diagnostics = state.diagnosticsByTab[tabId];
      if (!diagnostics || diagnostics.length === 0) return state;
      const current = state.selectedIndexByTab[tabId] ?? 0;
      return {
        selectedIndexByTab: {
          ...state.selectedIndexByTab,
          [tabId]: (current + 1) % diagnostics.length,
        },
      };
    });
  },

  selectPrev: (tabId) => {
    set((state) => {
      const diagnostics = state.diagnosticsByTab[tabId];
      if (!diagnostics || diagnostics.length === 0) return state;
      const current = state.selectedIndexByTab[tabId] ?? 0;
      return {
        selectedIndexByTab: {
          ...state.selectedIndexByTab,
          [tabId]: current <= 0 ? diagnostics.length - 1 : current - 1,
        },
      };
    });
  },
}));

// Clear all diagnostics when lint is disabled in settings
let prevLintEnabled = useSettingsStore.getState().markdown?.lintEnabled;
useSettingsStore.subscribe((state) => {
  const enabled = state.markdown?.lintEnabled;
  if (prevLintEnabled && !enabled) {
    useLintStore.getState().clearAllDiagnostics();
  }
  prevLintEnabled = enabled;
});
