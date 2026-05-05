/**
 * Purpose: Bidirectional cursor sync between the source-mode CodeMirror
 *   editor and the workflow side-panel canvas. When the user moves the
 *   cursor into a job's source range, the corresponding JobNode lights
 *   up in the side panel — selectJob in workflowViewStore.
 *
 *   Reverse direction (canvas click → source scroll) is handled by
 *   DiagnosticsBanner / JobNode click handlers and is already wired.
 *
 *   Behavior:
 *     - Cursor moves to line N
 *     - Look up JobIR.position for each job; first match wins
 *     - If a job matches AND it differs from the current selection,
 *       call selectJob(jobId)
 *     - If no job matches (workflow-level lines), DO NOT clear the
 *       existing selection — the user might be tweaking permissions
 *       and still want to see the last job they were in
 *
 * @coordinates-with src/stores/ghaWorkflowPanelStore.ts — IR source
 * @coordinates-with src/stores/workflowViewStore.ts — selectJob target
 * @module plugins/codemirror/sourceWorkflowCursorSync
 */

import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { useGhaWorkflowPanelStore } from "@/stores/ghaWorkflowPanelStore";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";

function findJobAtLine(workflow: WorkflowIR, line: number): string | null {
  for (const job of workflow.jobs) {
    if (line >= job.position.startLine && line <= job.position.endLine) {
      return job.id;
    }
  }
  return null;
}

const cursorSyncPlugin = ViewPlugin.fromClass(
  class {
    private lastLine = -1;
    constructor(view: EditorView) {
      // Sync once on mount so opening a workflow file with the cursor
      // already in a job lights up the right node immediately.
      this.maybeSync(view);
    }
    update(update: ViewUpdate) {
      // Only react to selection changes — doc-only updates don't move
      // the cursor's logical line in a way that should resync (the
      // panel store re-parses on doc edits anyway).
      if (!update.selectionSet) return;
      this.maybeSync(update.view);
    }
    private maybeSync(view: EditorView) {
      const { workflow } = useGhaWorkflowPanelStore.getState();
      if (!workflow) return;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head).number;
      if (line === this.lastLine) return;
      this.lastLine = line;
      const jobId = findJobAtLine(workflow, line);
      if (!jobId) return; // workflow-level — keep prior selection
      const current = useWorkflowViewStore.getState().selectedJobId;
      if (current === jobId) return;
      useWorkflowViewStore.getState().selectJob(jobId);
    }
  },
);

export function workflowCursorSyncExtension(): Extension {
  return cursorSyncPlugin;
}
