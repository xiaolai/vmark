/**
 * Source Lint Extension
 *
 * Purpose: CodeMirror extension that surfaces lint diagnostics from lintStore
 * in the Source mode editor — CodeMirror's built-in lint annotations.
 *
 * Key decisions:
 *   - Uses lintStore diagnostics directly (no re-running lint here).
 *   - Clears diagnostics on docChanged via updateListener — stale results
 *     must be explicitly cleared so the badge doesn't mislead.
 *   - offset/endOffset from LintDiagnostic are 0-based char offsets already.
 *
 * @coordinates-with lintStore.ts — reads diagnostics, clears on edit
 * @coordinates-with sourceEditorExtensions.ts — added when lintEnabled
 * @module plugins/codemirror/sourceLint
 */

import { linter, forceLinting, type Diagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { useLintStore } from "@/stores/documentStore";
import type { LintDiagnostic } from "@/lib/lintEngine/types";
import i18n from "@/i18n";
import { useEditorStore } from "@/stores/editorStore";

/**
 * Convert a LintDiagnostic (0-based offset) to a CodeMirror Diagnostic.
 * @internal Exported for testing.
 */
export function diagnosticToCM(docLength: number, d: LintDiagnostic): Diagnostic {
  const from = Math.min(d.offset, docLength);
  const to =
    d.endOffset != null
      ? Math.min(d.endOffset, docLength)
      : from;

  return {
    from,
    to: Math.max(to, from),
    severity: d.severity === "error" ? "error" : "warning",
    message: i18n.t(`editor:${d.messageKey}`, d.messageParams as Record<string, unknown>),
  };
}

/**
 * Create a CodeMirror linter + clear-on-edit listener for the given tab.
 * Does NOT re-run lint — diagnostics must already be in the lintStore.
 */
export function createSourceLintExtension(tabId: string) {
  // Lint source: pull pre-computed diagnostics from the store
  const lintSource = linter((view) => {
    const diagnostics = useLintStore.getState().diagnosticsByTab[tabId];
    if (!diagnostics || diagnostics.length === 0) return [];

    const docLength = view.state.doc.length;
    return diagnostics.map((d) => diagnosticToCM(docLength, d));
  });

  // Clear stale diagnostics whenever the document is edited
  const clearOnEdit = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      useLintStore.getState().clearDiagnostics(tabId);
    }
  });

  return [lintSource, clearOnEdit];
}

/**
 * Force the active CodeMirror source view to re-run its linter immediately.
 * Call this after runLint() to surface new diagnostics without waiting for
 * the next document change event.
 * Guards against calling forceLinting on a destroyed view (dom not connected).
 */
export function triggerLintRefresh(): void {
  const view = useEditorStore.getState().active.activeSourceView;
  if (view && view.dom?.isConnected) {
    forceLinting(view);
  }
}
