// Regression tests for the gha IR writer: the split-pane source editor
// must feed a live WorkflowIR to the workflowStore gha slice so cursor
// sync, expression completion, and the forms editor work. The
// retirement of sourceGhaWorkflowPreview (WI-2.4) removed the only
// production writer and left the slice permanently null — this
// extension restores it. Store access is injected (GhaIrSyncHooks), so
// these tests observe the hooks; the yaml adapter test covers the real
// store binding end-to-end.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import {
  ghaIrSyncExtension,
  GHA_IR_SYNC_DEBOUNCE_MS,
  type GhaIrSyncHooks,
} from "./sourceGhaIrSync";

const WORKFLOW_YAML = [
  "name: ci",
  "on: push",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: pnpm test",
  "",
].join("\n");

const PLAIN_YAML = ["title: hello", "items:", "  - a", "  - b", ""].join("\n");

function makeHooks(filePath: string | null = null) {
  const state: {
    published: (WorkflowIR | null)[];
    filePath: string | null;
  } = { published: [], filePath };
  const hooks: GhaIrSyncHooks = {
    getFilePath: () => state.filePath,
    publish: (workflow) => {
      state.published.push(workflow);
    },
  };
  const last = () => state.published[state.published.length - 1];
  return { hooks, state, last };
}

function mountView(doc: string, hooks: GhaIrSyncHooks): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [ghaIrSyncExtension(hooks)],
    }),
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ghaIrSyncExtension", () => {
  it("publishes the parsed IR on mount for workflow-shaped content", () => {
    const { hooks, last } = makeHooks();
    const view = mountView(WORKFLOW_YAML, hooks);
    expect(last()?.jobs.map((j) => j.id)).toEqual(["build"]);
    view.destroy();
  });

  it("publishes null for non-workflow YAML (clears any stale IR)", () => {
    const { hooks, state, last } = makeHooks();
    const view = mountView(PLAIN_YAML, hooks);
    expect(state.published).toHaveLength(1);
    expect(last()).toBeNull();
    view.destroy();
  });

  it("publishes a best-effort IR with diagnostics for a malformed file under .github/workflows/", () => {
    // parse() never throws — malformed input yields an IR whose
    // diagnostics carry the errors. Path detection wins (ADR-5), so the
    // IR is published even though the shape heuristic would decline.
    const { hooks, last } = makeHooks("/repo/.github/workflows/ci.yml");
    const view = mountView("name: broken\nsteps: oops", hooks);
    expect(last()).not.toBeNull();
    expect(last()!.diagnostics.length).toBeGreaterThan(0);
    view.destroy();
  });

  it("re-parses after an edit, debounced", () => {
    vi.useFakeTimers();
    const { hooks, last } = makeHooks();
    const view = mountView(WORKFLOW_YAML, hooks);
    expect(last()?.jobs).toHaveLength(1);

    view.dispatch({
      changes: {
        from: WORKFLOW_YAML.length,
        insert:
          "  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n",
      },
    });
    // Not yet — debounce window still open.
    expect(last()?.jobs).toHaveLength(1);

    vi.advanceTimersByTime(GHA_IR_SYNC_DEBOUNCE_MS + 1);
    expect(last()?.jobs.map((j) => j.id)).toEqual(["build", "deploy"]);
    view.destroy();
  });

  it("publishes null when an edit turns the doc into non-workflow content", () => {
    vi.useFakeTimers();
    const { hooks, last } = makeHooks();
    const view = mountView(WORKFLOW_YAML, hooks);
    expect(last()).not.toBeNull();

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: PLAIN_YAML },
    });
    vi.advanceTimersByTime(GHA_IR_SYNC_DEBOUNCE_MS + 1);
    expect(last()).toBeNull();
    view.destroy();
  });

  it("reads the file path fresh on each parse (Save As between edits)", () => {
    vi.useFakeTimers();
    const { hooks, state, last } = makeHooks(null);
    // Non-workflow shape + no path → null on mount.
    const view = mountView("name: broken\nsteps: oops", hooks);
    expect(last()).toBeNull();

    // Save As moves the file under .github/workflows/ — path detection
    // must now win on the next parse without a remount.
    state.filePath = "/repo/.github/workflows/ci.yml";
    view.dispatch({ changes: { from: 0, insert: "# saved\n" } });
    vi.advanceTimersByTime(GHA_IR_SYNC_DEBOUNCE_MS + 1);
    expect(last()).not.toBeNull();
    view.destroy();
  });

  it("publishes null on destroy so a closed tab leaves no stale IR", () => {
    const { hooks, last } = makeHooks();
    const view = mountView(WORKFLOW_YAML, hooks);
    expect(last()).not.toBeNull();
    view.destroy();
    expect(last()).toBeNull();
  });

  it("a pending debounce does not fire after destroy", () => {
    vi.useFakeTimers();
    const { hooks, state } = makeHooks();
    const view = mountView(WORKFLOW_YAML, hooks);
    view.dispatch({
      changes: { from: 0, insert: "# edited\n" },
    });
    view.destroy();
    const countAfterDestroy = state.published.length;
    vi.advanceTimersByTime(GHA_IR_SYNC_DEBOUNCE_MS + 1);
    // destroy()'s null must be the final publish — the canceled timer
    // must not resurrect the edited content afterwards.
    expect(state.published).toHaveLength(countAfterDestroy);
    expect(state.published[state.published.length - 1]).toBeNull();
  });
});
