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
 * No working default here, unlike the peek and block-math registries: this
 * state is READ by React panels the plugin cannot see, so an in-memory
 * stand-in would parse workflows into a void. An unbound call throws with a
 * message naming the fix.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @module plugins/codemirror/workflowPort
 */

import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import type { WorkflowGraph } from "@/lib/workflow/types";

/** What the Source workflow plugins need. */
interface WorkflowPortState {
  preview: { panelOpen: boolean };
  gha: { workflow: WorkflowIR | null };
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

let bound: WorkflowPort | null = null;

/** Bind the host's workflow state. Called once, at app startup. */
export function bindWorkflowPort(port: WorkflowPort): void {
  bound = port;
}

/** The bound state, or a failure that names the fix. */
export function workflowPort(): WorkflowPort {
  if (!bound) {
    throw new Error(
      "the Source workflow plugins need their state bound — call bindWorkflowPort() from the app's assembly."
    );
  }
  return bound;
}
