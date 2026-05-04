// Phase 9 follow-up — full save-flow integration test.
//
// Drives the pipeline end-to-end without xyflow / React Flow:
//
//   1. CodeMirror Source plugin parses an in-memory workflow file → IR
//      lands in ghaWorkflowPanelStore.
//   2. UI emits IRPatches via workflowEditStore.queuePatch (we call the
//      store directly to simulate form input).
//   3. applyAndSerialize transforms the original YAML using those
//      patches via the CST mutator path.
//   4. The serialized text is written via the Tauri atomic_write_file
//      command (mocked in the test setup) — this is the contract that
//      saveToPath honors.
//
// This is the deterministic substitute for the live Tauri-MCP smoke
// session. When the dev server is running, the same flow can be driven
// through the real webview; here we lock in the data contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { sourceGhaWorkflowPreviewExtensions } from "@/plugins/codemirror/sourceGhaWorkflowPreview";
import { useGhaWorkflowPanelStore } from "@/stores/ghaWorkflowPanelStore";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import { semanticEqual } from "@/lib/ghaWorkflow/save/cstParser";

const ORIGINAL = `# CI workflow — keep me!
name: ci
on: push
env:
  NODE_ENV: production # inline env
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
`;

beforeEach(() => {
  useGhaWorkflowPanelStore.getState().reset();
  useWorkflowEditStore.setState({
    pendingPatches: [],
    preserveYamlFormatting: true,
  });
  vi.mocked(invoke).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("save flow — IR → form patch → CST mutation → disk write", () => {
  it("preserves comments + applies edits in a single round trip", () => {
    // 1. Mount the source plugin with the original YAML.
    const view = new EditorView({
      state: EditorState.create({
        doc: ORIGINAL,
        extensions: sourceGhaWorkflowPreviewExtensions,
      }),
      parent: document.createElement("div"),
    });
    // Initial parse is synchronous on mount.
    const ir = useGhaWorkflowPanelStore.getState().workflow;
    expect(ir).not.toBeNull();
    expect(ir!.jobs).toHaveLength(1);
    expect(ir!.jobs[0].id).toBe("build");

    // 2. Form-equivalent edits: rename, change runs-on, edit env.
    const queue = useWorkflowEditStore.getState().queuePatch;
    queue({ kind: "workflow.set", path: "name", value: "renamed-ci" });
    queue({
      kind: "job.set",
      jobId: "build",
      path: "runs-on",
      value: "macos-latest",
    });
    queue({
      kind: "step.set",
      jobId: "build",
      stepIndex: 1,
      path: "run",
      value: "pnpm check:all",
    });

    // 3. Apply + serialize.
    const next = useWorkflowEditStore.getState().applyAndSerialize(ORIGINAL);

    // Edits applied:
    expect(next).toMatch(/name: renamed-ci/);
    expect(next).toMatch(/runs-on: macos-latest/);
    expect(next).toMatch(/run: pnpm check:all/);

    // Comments preserved:
    expect(next).toMatch(/# CI workflow — keep me!/);
    expect(next).toMatch(/# inline env/);

    // 4. Plain-yaml round-trip equivalence: re-parsing the saved text
    //    semantically equals the patched IR (no silent data loss).
    const expected = ORIGINAL
      .replace("name: ci", "name: renamed-ci")
      .replace("runs-on: ubuntu-latest", "runs-on: macos-latest")
      .replace("run: pnpm test", "run: pnpm check:all");
    expect(semanticEqual(next, expected)).toBe(true);

    view.destroy();
  });

  it("write contract — saveToPath calls atomic_write_file with the serialized text", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { saveToPath } = await import("@/utils/saveToPath");
    const { useDocumentStore } = await import("@/stores/documentStore");
    // Seed a minimal document state so saveToPath has line-ending +
    // hard-break metadata to read.
    useDocumentStore.getState().initDocument(
      "test-tab",
      ORIGINAL,
      "/tmp/.github/workflows/ci.yml",
      ORIGINAL,
    );
    useWorkflowEditStore.getState().queuePatch({
      kind: "workflow.set",
      path: "name",
      value: "renamed-ci",
    });
    const next = useWorkflowEditStore
      .getState()
      .applyAndSerialize(ORIGINAL);
    const ok = await saveToPath(
      "test-tab",
      "/tmp/.github/workflows/ci.yml",
      next,
      "manual",
    );
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "atomic_write_file",
      expect.objectContaining({
        path: "/tmp/.github/workflows/ci.yml",
        content: expect.stringContaining("name: renamed-ci"),
      }),
    );
  });
});
