/**
 * Purpose: feed the lint plugin the host's diagnostics.
 *
 * The lint ENGINE is the app's — it serializes the document, runs the rules,
 * and writes results into `useLintStore`. Painting those results in the
 * editor is the plugin's job, and the plugin should not have to know where
 * they came from (ADR-015). This adapter is the join.
 *
 * The subscribe callback re-derives which tab changed rather than handing the
 * plugin the whole store: the plugin holds exactly one `tabId` and ignores
 * everything else, and passing the store shape through would put
 * `diagnosticsByTab` back in the plugin's vocabulary.
 *
 * @coordinates-with plugins/lint/tiptap.ts — the LintDiagnosticsSource contract
 * @coordinates-with stores/documentStore/lint.ts — where diagnostics live
 * @module services/assembly/lintDiagnosticsSource
 */

import { useLintStore } from "@/stores/documentStore";
import type { LintDiagnosticsSource } from "@/plugins/lint/tiptap";

export const lintDiagnosticsSource: LintDiagnosticsSource = {
  get: (tabId) => useLintStore.getState().diagnosticsByTab[tabId] ?? [],
  subscribe: (listener) => {
    let prev = useLintStore.getState().diagnosticsByTab;
    return useLintStore.subscribe((state) => {
      const next = state.diagnosticsByTab;
      if (next === prev) return;
      const before = prev;
      prev = next;
      // Report every tab whose entry changed identity. Usually one; a tab
      // close can retire several at once, and the plugin filters by its own id.
      for (const tabId of new Set([...Object.keys(before), ...Object.keys(next)])) {
        if (before[tabId] !== next[tabId]) listener(tabId, next[tabId] ?? []);
      }
    });
  },
};
