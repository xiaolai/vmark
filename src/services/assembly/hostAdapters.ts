/**
 * Purpose: the host-side adapters this assembly hands to plugins.
 *
 * Plugins declare what they need — a port, an option, a source — with a
 * default that works standalone (ADR-015). The app overrides those defaults
 * with the real thing, and "the real thing" is what lives here. One module
 * rather than one file per adapter, so the set of app→plugin injections is
 * readable in a single place.
 *
 * @coordinates-with services/assembly/tiptapExtensions.ts — the only consumer
 * @module services/assembly/hostAdapters
 */

import { useLintStore } from "@/stores/documentStore";
import type { LintDiagnosticsSource } from "@/plugins/lint/tiptap";
import { createInlineMathEditingRegistry } from "@/plugins/latex/inlineMathEditingRegistry";

/**
 * The one inline-math editing registry the app shares across editors.
 *
 * The latex plugin defaults to a registry per extension instance, which is
 * right for a standalone plugin. The app deliberately overrides it with a
 * single shared instance, because that is the semantics VMark shipped:
 * opening inline math anywhere force-exits whichever math editor was already
 * open. Per-editor registries would be a silent behaviour change.
 *
 * Export extensions (`createExportExtensions.ts`) do NOT get this one —
 * export never edits, so its own throwaway default is correct there.
 */
export const appInlineMathEditingRegistry = createInlineMathEditingRegistry();

/**
 * Feed the lint plugin the host's diagnostics.
 *
 * The lint ENGINE is the app's — it serializes the document, runs the rules,
 * and writes results into `useLintStore`. Painting those results is the
 * plugin's job, and it should not have to know where they came from.
 *
 * The subscribe callback re-derives which tab changed rather than handing the
 * plugin the whole store: the plugin holds exactly one `tabId` and ignores
 * everything else, and passing the store shape through would put
 * `diagnosticsByTab` back in the plugin's vocabulary.
 */
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
