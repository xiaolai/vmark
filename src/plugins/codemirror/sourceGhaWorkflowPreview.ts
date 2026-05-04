/**
 * Source GHA Workflow Preview Plugin
 *
 * Purpose: When editing a standalone GitHub Actions workflow `.yml` file
 *   in Source mode, debounces YAML parsing and feeds the result to
 *   `useGhaWorkflowPanelStore` so `GhaWorkflowSidePanel` can show the
 *   live React Flow DAG (Phase 2 of the GHA workflow viewer plan).
 *
 *   Mirrors src/plugins/codemirror/sourceWorkflowPreview.ts (which serves
 *   the existing Genie workflow feature). Both plugins coexist; the
 *   shape detection is mutually exclusive (Genie has top-level steps,
 *   GHA has top-level jobs), so for legitimate input only one fires.
 *
 * Pipeline: doc change → debounce 300ms → isWorkflowYaml() → parse() →
 *   useGhaWorkflowPanelStore.setWorkflow / openPanel.
 *
 * @coordinates-with src/lib/ghaWorkflow/parser/index.ts — IR producer
 * @coordinates-with src/lib/ghaWorkflow/detection.ts — isWorkflowYaml shape check
 * @coordinates-with src/stores/ghaWorkflowPanelStore.ts — write target
 * @module plugins/codemirror/sourceGhaWorkflowPreview
 */

import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { useGhaWorkflowPanelStore } from "@/stores/ghaWorkflowPanelStore";
import { isWorkflowYaml } from "@/lib/ghaWorkflow/detection";
import { parse } from "@/lib/ghaWorkflow/parser";
import { lintWithActionlint } from "@/lib/ghaWorkflow/lint/actionlint";
import { workflowLog, workflowWarn } from "@/utils/debug";

const DEBOUNCE_MS = 300;

class SourceGhaWorkflowPreviewPlugin {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastContent = "";
  /** True once this view has actually written workflow state to the store. */
  private ownsStoreState = false;
  /**
   * Bumped on every parse so a stale actionlint result that resolves
   * after a newer parse can be detected and discarded. Without this,
   * concurrent actionlint invocations on slower machines would each
   * race to write into the panel store as they finished — typing
   * fast through a workflow would oscillate the diagnostic banner
   * (Codex round 5 finding: stale run accumulation).
   */
  private lintGeneration = 0;

  constructor(view: EditorView) {
    // Parse the initial doc state. Without this, opening an existing
    // workflow file leaves the panel empty until the user makes a
    // change, since update() only fires on docChanged.
    const content = view.state.doc.toString();
    if (content) {
      this.lastContent = content;
      // Synchronous on initial mount — no debounce so the panel opens
      // immediately on file load.
      this.parseAndUpdate(content);
    }
  }

  update(update: ViewUpdate) {
    if (!update.docChanged) return;

    const content = update.state.doc.toString();
    if (content === this.lastContent) return;
    this.lastContent = content;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.parseAndUpdate(content);
    }, DEBOUNCE_MS);
  }

  private parseAndUpdate(content: string) {
    const store = useGhaWorkflowPanelStore.getState();

    if (!isWorkflowYaml(content)) {
      // Only clear if THIS view owned the panel state — otherwise we'd
      // erase another tab's workflow when this tab transitioned out of
      // workflow shape (auditor finding: cross-tab pollution bug).
      if (this.ownsStoreState) {
        store.setWorkflow(null);
        store.closePanel();
        this.ownsStoreState = false;
      }
      return;
    }

    try {
      const ir = parse(content);
      const fatal = ir.diagnostics.find(
        (d) => d.severity === "error" && d.code.startsWith("GHA-PARSE"),
      );
      if (fatal) {
        store.setWorkflow(null, fatal.message);
        this.ownsStoreState = true;
        return;
      }
      workflowLog(
        "Parsed GHA workflow:",
        ir.name ?? "(unnamed)",
        `(${ir.jobs.length} jobs, ${ir.diagnostics.length} diagnostics)`,
      );
      store.setWorkflow(ir);
      this.ownsStoreState = true;
      // Edit-queue binding lives in the GhaWorkflowSidePanel, which has
      // access to the real active tab's filePath via the documentStore.
      // Content-derived ids collide on common shapes like
      // "(unnamed)::build" (Codex audit round 5 finding).
      // Forward to actionlint asynchronously and merge its diagnostics
      // when the binary is available. Fire-and-forget — the parser-side
      // diagnostics already populated the panel; actionlint enriches.
      void this.maybeLintWithActionlint(content, ir);
      if (!useGhaWorkflowPanelStore.getState().panelOpen) {
        useGhaWorkflowPanelStore.getState().openPanel();
      }
    } catch (e) {
      workflowWarn(
        "Unexpected GHA workflow parse error:",
        e instanceof Error ? e.message : String(e),
      );
      store.setWorkflow(null, e instanceof Error ? e.message : String(e));
      this.ownsStoreState = true;
    }
  }

  /**
   * Run actionlint asynchronously over the same YAML and merge its
   * diagnostics into the panel store. No-op when the binary isn't
   * available (the wrapper handles the silent-fallback case). Stale
   * results are dropped: if the lastContent has changed by the time
   * actionlint resolves, we discard its output rather than overwrite a
   * fresher parse.
   */
  private async maybeLintWithActionlint(
    content: string,
    ir: import("@/lib/ghaWorkflow/types").WorkflowIR,
  ): Promise<void> {
    const generation = ++this.lintGeneration;
    try {
      const out = await lintWithActionlint(content);
      // Drop the result if a newer parse has fired in the interim.
      // Both the content + generation guards close two windows: the
      // content guard catches simultaneous typing, the generation
      // guard catches concurrent invocations of this method itself.
      if (generation !== this.lintGeneration) return;
      if (this.lastContent !== content) return;
      if (!this.ownsStoreState) return;
      if (out.diagnostics.length === 0) return;
      const merged = {
        ...ir,
        diagnostics: [...ir.diagnostics, ...out.diagnostics],
      };
      useGhaWorkflowPanelStore.getState().setWorkflow(merged);
    } catch {
      // Silent — actionlint is optional.
    }
  }

  destroy() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    // Only reset the panel store if THIS view's content was its source.
    // Tab-switch destroys the view that's leaving — which would clear
    // panel state for whichever tab is now active (auditor finding).
    //
    // Note: we deliberately do NOT clear pendingPatches here. Doing so
    // turns "switch tabs while editing" into silent data loss for the
    // user's unsaved work in the previous tab. Cross-document patch
    // pollution is prevented at the workflowEditStore layer instead —
    // the store binds the queue to a `boundDocumentId` and rejects
    // patches that don't match (cross-validator round 2 finding).
    if (this.ownsStoreState) {
      useGhaWorkflowPanelStore.getState().reset();
    }
  }
}

export function createSourceGhaWorkflowPreviewPlugin() {
  return ViewPlugin.fromClass(SourceGhaWorkflowPreviewPlugin);
}

export const sourceGhaWorkflowPreviewExtensions = [
  createSourceGhaWorkflowPreviewPlugin(),
];
