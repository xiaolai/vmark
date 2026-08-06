/**
 * Purpose: the workflow state the Source-mode plugins read and drive.
 *
 * Three CodeMirror plugins share it: the preview parses YAML into a graph,
 * the cursor sync selects the job under the caret, and completion reads the
 * parsed GHA workflow for its suggestions. All three are constructed by
 * CodeMirror rather than by the host, so a binder is the shape that fits —
 * the same reasoning as `sourcePeekInline`'s peek state (ADR-015).
 *
 * The port is narrow on purpose. The app's workflow store carries five
 * slices; these plugins touch two, and only the handful of members below.
 *
 * Unbound, this reads as "no workflow" and swallows writes.
 *
 * An earlier version threw instead, on the grounds that the state is read by
 * React panels the plugin cannot see, so an in-memory stand-in would parse
 * workflows into a void. That reasoning was right about the writes and wrong
 * about the cost: `workflowPort()` is reached from the autocomplete source on
 * every keystroke and from cursor sync on every selection change, so throwing
 * turns a missing binding into a broken editor rather than a missing panel.
 * A quiet no-op is the lesser failure on a hot path.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @module plugins/codemirror/workflowPort
 */

import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import type { WorkflowGraph } from "@/lib/workflow/types";

/** What the Source workflow plugins need. */
interface WorkflowPortState {
  preview: { panelOpen: boolean };
  /** Live workflow IR per tab — keyed so two split panes (#1081)
   *  cannot clobber each other. Absent key = no workflow. */
  gha: { byTab: Record<string, WorkflowIR> };
  view: { selectedJobId: string | null };
  setGraph: (graph: WorkflowGraph | null, error?: string) => void;
  previewOpenPanel: () => void;
  previewClosePanel: () => void;
  resetPreview: () => void;
  selectJob: (jobId: string) => void;
}

export interface WorkflowPort {
  getState: () => WorkflowPortState;
}

/** No workflow, and nowhere for a parse result to go. */
const UNBOUND: WorkflowPort = {
  getState: () => ({
    preview: { panelOpen: false },
    gha: { byTab: {} },
    view: { selectedJobId: null },
    setGraph: () => {},
    previewOpenPanel: () => {},
    previewClosePanel: () => {},
    resetPreview: () => {},
    selectJob: () => {},
  }),
};

let bound: WorkflowPort = UNBOUND;

/** Bind the host's workflow state. Called once, at app startup. */
export function bindWorkflowPort(port: WorkflowPort): void {
  bound = port;
}

/** Restore the unbound default. Tests only. */
export function resetWorkflowPort(): void {
  bound = UNBOUND;
}

/** The bound state, or the no-workflow default. */
export function workflowPort(): WorkflowPort {
  return bound;
}
