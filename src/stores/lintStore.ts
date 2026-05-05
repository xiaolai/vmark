/**
 * Lint Store
 *
 * Purpose: Tab-scoped storage for markdown lint diagnostics.
 * Ephemeral — no persistence. Diagnostics are cleared on document edit.
 */

import { create } from "zustand";
import { lintMarkdown } from "@/lib/lintEngine";
import { lintYaml } from "@/lib/lintEngine/yaml";
import type { LintDiagnostic } from "@/lib/lintEngine";
import { checkLocalLinks } from "@/lib/markdownLinkCheck/check";

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
  /** Run markdown lint on source for a specific tab */
  runLint: (tabId: string, source: string) => LintDiagnostic[];
  /**
   * Run YAML lint on source for a specific tab. Replaces ALL prior
   * diagnostics for the tab — YAML files are exclusive; they don't
   * also run markdown rules.
   */
  runYamlLint: (tabId: string, source: string) => LintDiagnostic[];
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

  runLint: (tabId, source) => {
    const diagnostics = lintMarkdown(source);

    set((state) => ({
      diagnosticsByTab: { ...state.diagnosticsByTab, [tabId]: diagnostics },
      selectedIndexByTab: { ...state.selectedIndexByTab, [tabId]: 0 },
    }));

    return diagnostics;
  },

  runYamlLint: (tabId, source) => {
    // Bumping the link-check token here too: a runLinkCheck() that
    // started while this tab was being treated as markdown should
    // not later overwrite our YAML diagnostics. Uniform invalidation.
    linkCheckTokens.next++;
    delete linkCheckTokens.byTab[tabId];
    const diagnostics = lintYaml(source);
    set((state) => ({
      diagnosticsByTab: { ...state.diagnosticsByTab, [tabId]: diagnostics },
      selectedIndexByTab: { ...state.selectedIndexByTab, [tabId]: 0 },
    }));
    return diagnostics;
  },

  runLinkCheck: async (tabId, source, filePath) => {
    if (!filePath) return [];
    // Codex audit HIGH-1 fix: per-tab token guards against stale async
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
    // instead of repopulating the cleared tab. Codex audit HIGH-1
    // partial finding.
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
import { useSettingsStore } from "@/stores/settingsStore";
let prevLintEnabled = useSettingsStore.getState().markdown.lintEnabled;
useSettingsStore.subscribe((state) => {
  const enabled = state.markdown.lintEnabled;
  if (prevLintEnabled && !enabled) {
    useLintStore.getState().clearAllDiagnostics();
  }
  prevLintEnabled = enabled;
});
