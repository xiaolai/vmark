// Tests for the GHA workflow CodeMirror preview plugin.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { sourceGhaWorkflowPreviewExtensions } from "./sourceGhaWorkflowPreview";
import { useGhaWorkflowPanelStore } from "@/stores/ghaWorkflowPanelStore";

const VALID_WORKFLOW = `name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;

const NON_WORKFLOW_YAML = `version: "3"
services:
  web:
    image: nginx
`;

function makeView(initial: string): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc: initial,
      extensions: sourceGhaWorkflowPreviewExtensions,
    }),
    parent: document.createElement("div"),
  });
}

describe("sourceGhaWorkflowPreview", () => {
  beforeEach(() => {
    useGhaWorkflowPanelStore.getState().reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("populates the store when a workflow YAML is typed", () => {
    const view = makeView("");
    view.dispatch({
      changes: { from: 0, to: 0, insert: VALID_WORKFLOW },
    });
    vi.runAllTimers();
    const s = useGhaWorkflowPanelStore.getState();
    expect(s.workflow).not.toBeNull();
    expect(s.panelOpen).toBe(true);
    view.destroy();
  });

  it("populates the store on initial mount when content is already a workflow", () => {
    const view = makeView(VALID_WORKFLOW);
    // Initial parse is synchronous — no debounce on first mount.
    const s = useGhaWorkflowPanelStore.getState();
    expect(s.workflow).not.toBeNull();
    expect(s.panelOpen).toBe(true);
    view.destroy();
  });

  it("leaves the store unchanged on initial mount when content is non-workflow YAML", () => {
    const view = makeView(NON_WORKFLOW_YAML);
    const s = useGhaWorkflowPanelStore.getState();
    expect(s.workflow).toBeNull();
    view.destroy();
  });

  it("clears the store when content stops being a workflow", () => {
    const view = makeView(VALID_WORKFLOW);
    // Append a trailing newline to trigger the docChanged listener
    // without altering top-level YAML key positions.
    view.dispatch({
      changes: { from: view.state.doc.length, to: view.state.doc.length, insert: "\n" },
    });
    vi.runAllTimers();
    expect(useGhaWorkflowPanelStore.getState().workflow).not.toBeNull();

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: NON_WORKFLOW_YAML },
    });
    vi.runAllTimers();
    expect(useGhaWorkflowPanelStore.getState().workflow).toBeNull();
    expect(useGhaWorkflowPanelStore.getState().panelOpen).toBe(false);
    view.destroy();
  });

  it("debounces parses (no parse before debounce window elapses)", () => {
    const view = makeView("");
    view.dispatch({ changes: { from: 0, to: 0, insert: VALID_WORKFLOW } });
    // Don't run timers — parse hasn't fired yet.
    expect(useGhaWorkflowPanelStore.getState().workflow).toBeNull();
    vi.runAllTimers();
    expect(useGhaWorkflowPanelStore.getState().workflow).not.toBeNull();
    view.destroy();
  });

  it("resets the store when the editor is destroyed", () => {
    const view = makeView("");
    view.dispatch({ changes: { from: 0, to: 0, insert: VALID_WORKFLOW } });
    vi.runAllTimers();
    view.destroy();
    expect(useGhaWorkflowPanelStore.getState().workflow).toBeNull();
    expect(useGhaWorkflowPanelStore.getState().panelOpen).toBe(false);
  });
});
