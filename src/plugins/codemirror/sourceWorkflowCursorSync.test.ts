// WI-B.3 — source-cursor → canvas-node selection sync.

import { describe, it, expect, beforeEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useGhaWorkflowPanelStore } from "@/stores/ghaWorkflowPanelStore";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { workflowCursorSyncExtension } from "./sourceWorkflowCursorSync";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";

function makeIR(): WorkflowIR {
  return {
    triggers: [
      {
        event: "push",
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    ],
    permissions: undefined,
    env: {},
    jobs: [
      {
        id: "lint",
        runsOn: ["ubuntu-latest"],
        needs: [],
        steps: [
          {
            id: "checkout",
            idSynthesized: false,
            uses: "actions/checkout@v4",
            position: { startLine: 5, startCol: 1, endLine: 6, endCol: 30 },
          },
        ],
        position: { startLine: 4, startCol: 1, endLine: 6, endCol: 30 },
      },
      {
        id: "test",
        runsOn: ["ubuntu-latest"],
        needs: [],
        steps: [
          {
            id: "run",
            idSynthesized: false,
            run: "pytest",
            position: { startLine: 10, startCol: 1, endLine: 11, endCol: 12 },
          },
        ],
        position: { startLine: 8, startCol: 1, endLine: 11, endCol: 12 },
      },
    ],
    positions: {},
    diagnostics: [],
  } as WorkflowIR;
}

function mountView(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [workflowCursorSyncExtension()],
    }),
  });
  return view;
}

beforeEach(() => {
  useGhaWorkflowPanelStore.setState({ workflow: null, parseError: null });
  useWorkflowViewStore.getState().reset();
});

describe("workflowCursorSync", () => {
  it("selects the job whose source range contains the cursor line", () => {
    useGhaWorkflowPanelStore.setState({ workflow: makeIR(), parseError: null });
    const doc = "line1\nline2\nline3\nlint:\n  steps:\n    - checkout\n      uses\nline8\ntest:\n  steps:\n    - run\n      pytest\n";
    const view = mountView(doc);
    // Move cursor to line 5 (inside lint job, lines 4-6).
    const lineInfo = view.state.doc.line(5);
    view.dispatch({
      selection: EditorSelection.cursor(lineInfo.from),
    });
    expect(useWorkflowViewStore.getState().selectedJobId).toBe("lint");
    view.destroy();
  });

  it("switches selection when cursor moves into a different job", () => {
    useGhaWorkflowPanelStore.setState({ workflow: makeIR(), parseError: null });
    const doc = "line1\nline2\nline3\nlint:\n  steps:\n    - checkout\n      uses\nline8\ntest:\n  steps:\n    - run\n      pytest\n";
    const view = mountView(doc);
    // Cursor at line 5 → lint
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(5).from) });
    expect(useWorkflowViewStore.getState().selectedJobId).toBe("lint");
    // Cursor at line 11 → test
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(11).from) });
    expect(useWorkflowViewStore.getState().selectedJobId).toBe("test");
    view.destroy();
  });

  it("does NOT change selection when cursor is outside any job (workflow-level)", () => {
    useGhaWorkflowPanelStore.setState({ workflow: makeIR(), parseError: null });
    useWorkflowViewStore.getState().selectJob("lint");
    const doc = "line1\nline2\nline3\nlint:\n  steps:\n    - checkout\n      uses\nline8\ntest:\n  steps:\n    - run\n      pytest\n";
    const view = mountView(doc);
    // Cursor at line 1 → outside any job; should preserve user's prior selection.
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(1).from) });
    expect(useWorkflowViewStore.getState().selectedJobId).toBe("lint");
    view.destroy();
  });

  it("does nothing when no workflow IR is loaded", () => {
    // No store data — extension should no-op without throwing.
    const doc = "name: ci\n";
    const view = mountView(doc);
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(useWorkflowViewStore.getState().selectedJobId).toBeNull();
    view.destroy();
  });
});
