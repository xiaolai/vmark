// Tests for GhaWorkflowWorkbench — canvas + forms editor + save
// pipeline for standalone workflow files, mounted by the yaml adapter's
// gha-workflow schemaRenderer inside the split-pane preview. Successor
// to GhaWorkflowSidePanel (whose markdown-adapter mount became
// unreachable when standalone YAML routing moved to the split pane).
//
// The hosting tab arrives via props (from SplitPaneEditor), NOT from
// tabStore's focused-pane activeTabId — under document split the
// focused pane can be the OTHER pane, and binding/saving against it
// corrupts the patch queue across documents.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { GhaWorkflowWorkbench } from "../GhaWorkflowWorkbench";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";

const mockSaveToPath = vi.fn();
vi.mock("@/services/persistence/saveToPath", () => ({
  saveToPath: (...args: unknown[]) => mockSaveToPath(...args),
}));

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: {
    success: (...args: unknown[]) => mockToast.success(...args),
    error: (...args: unknown[]) => mockToast.error(...args),
    info: (...args: unknown[]) => mockToast.info(...args),
    warning: (...args: unknown[]) => mockToast.warning(...args),
  },
}));

// The forms editor runs actionlint over its tab (WI-FL3.8). That path has
// its own cases under WorkflowEditor/; here it is switched off so the
// save-pipeline cases are not joined by an IPC firing after the debounce.
const initialAdvanced = useSettingsStore.getState().advanced;

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

beforeEach(() => {
  // jsdom shims required by @xyflow/react under WorkflowCanvas.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  mockSaveToPath.mockReset();
  mockToast.success.mockReset();
  mockToast.error.mockReset();
  mockToast.warning.mockReset();
  useSettingsStore.setState({
    advanced: {
      ...useSettingsStore.getState().advanced,
      workflowActionlint: false,
    },
  });
  useWorkflowStore.getState().resetGha();
  useWorkflowStore.getState().resetEdit();
  useWorkflowStore.getState().resetView();
  useDocumentStore.setState({
    documents: {
      "tab-1": {
        content: WORKFLOW_YAML,
        filePath: "/repo/.github/workflows/ci.yml",
      },
    },
    setEditorContent: (id: string, content: string) => {
      useDocumentStore.setState((s: { documents: Record<string, object> }) => ({
        documents: {
          ...s.documents,
          [id]: { ...s.documents[id], content },
        },
      }) as never);
    },
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  useSettingsStore.setState({ advanced: initialAdvanced });
});

const sampleIr = (): WorkflowIR => ({
  triggers: [],
  permissions: {},
  env: {},
  jobs: [
    {
      id: "build",
      needs: [],
      steps: [],
      position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    },
  ],
  positions: {},
  diagnostics: [],
});

// The forms editor sits behind a React.lazy boundary; its FIRST resolution
// pays vitest's on-demand transform of the editor's import graph, which can
// exceed waitFor's 1s default on a cold or contended worker (observed flaking
// 1-in-5 in isolation). The timeout removes the wall-clock race without
// weakening the assertion.
const LAZY_MOUNT = { timeout: 15_000 };

async function renderAndQueuePatch() {
  render(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
  await waitFor(
    () => expect(document.querySelector(".workflow-editor-panel")).not.toBeNull(),
    LAZY_MOUNT,
  );
  useWorkflowStore
    .getState()
    .queuePatch({ kind: "workflow.set", path: "name", value: "renamed" });
  const save = await screen.findByRole("button", { name: "Save" });
  await waitFor(() => expect(save).toBeEnabled());
  return save;
}

describe("GhaWorkflowWorkbench", () => {
  it("renders the canvas region for a workflow IR", () => {
    const { container } = render(
      <GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />,
    );
    expect(
      container.querySelector(".gha-workflow-workbench__canvas"),
    ).not.toBeNull();
  });

  it("lazily mounts the structured forms editor below the canvas", async () => {
    const { container } = render(
      <GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />,
    );
    await waitFor(
      () =>
        expect(container.querySelector(".workflow-editor-panel")).not.toBeNull(),
      LAZY_MOUNT,
    );
  });

  it("binds the edit store's patch queue to its OWN tab's document path", async () => {
    render(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
    await waitFor(() =>
      expect(useWorkflowStore.getState().edit.boundDocumentId).toBe(
        "/repo/.github/workflows/ci.yml",
      ),
    );
  });

  it("falls back to an untitled id when the document has no path", async () => {
    useDocumentStore.setState({
      documents: { "tab-1": { content: WORKFLOW_YAML, filePath: null } },
    } as never);
    render(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
    await waitFor(() =>
      expect(useWorkflowStore.getState().edit.boundDocumentId).toBe(
        "untitled:tab-1",
      ),
    );
  });

  // Audit 20260907 (#292): the binding read the document's filePath through
  // getState() while the effect depended only on the IR and the tab, so a
  // Save As of an untitled workflow left the queue bound under the OLD id.
  it("rebinds when the document's filePath changes without a remount (Save As)", async () => {
    useDocumentStore.setState({
      documents: { "tab-1": { content: WORKFLOW_YAML, filePath: null } },
    } as never);
    render(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
    await waitFor(() =>
      expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("untitled:tab-1"),
    );

    useDocumentStore.setState({
      documents: { "tab-1": { content: WORKFLOW_YAML, filePath: "/repo/.github/workflows/new.yml" } },
    } as never);

    await waitFor(() =>
      expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("/repo/.github/workflows/new.yml"),
    );
  });

  it("resets the canvas selection when the bound document changes", async () => {
    const { rerender } = render(
      <GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />,
    );
    await waitFor(() =>
      expect(useWorkflowStore.getState().edit.boundDocumentId).toBe(
        "/repo/.github/workflows/ci.yml",
      ),
    );
    useWorkflowStore.getState().selectJob("build");

    useDocumentStore.setState({
      documents: {
        "tab-1": {
          content: "name: other\n",
          filePath: "/repo/.github/workflows/other.yml",
        },
      },
    } as never);
    rerender(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
    await waitFor(() =>
      expect(useWorkflowStore.getState().edit.boundDocumentId).toBe(
        "/repo/.github/workflows/other.yml",
      ),
    );
    expect(useWorkflowStore.getState().view.selectedJobId).toBeNull();
  });

  // Audit 20260907 (#293, round 2): the mount/re-parse effect bound
  // unconditionally, so a second pane mounting — or re-parsing after an
  // external change — redirected the binding away from a pane the user was
  // still typing in, with no pointer or focus event to bind it back.
  it("does not take the binding from a workbench the user is focused in (mount or re-parse)", async () => {
    useWorkflowStore.getState().bindToDocument("/repo/.github/workflows/other.yml");
    const otherPanesForm = document.createElement("input");
    document.body.appendChild(otherPanesForm);
    otherPanesForm.focus();

    const { rerender } = render(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("/repo/.github/workflows/other.yml");

    // A re-parse of THIS pane's document (external change) must not steal it either.
    rerender(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("/repo/.github/workflows/other.yml");

    // Focus arriving here is what binds this pane.
    const root = document.querySelector(".gha-workflow-workbench") as HTMLElement;
    root.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("/repo/.github/workflows/ci.yml");
    otherPanesForm.remove();
  });

  it("binds on mount when nothing holds keyboard focus, even with another document bound", async () => {
    useWorkflowStore.getState().bindToDocument("/repo/.github/workflows/other.yml");
    (document.activeElement as HTMLElement | null)?.blur();
    render(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
    await waitFor(() =>
      expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("/repo/.github/workflows/ci.yml"),
    );
  });

  it("without a tabId, the forms editor is not mounted (canvas-only degraded mode)", async () => {
    const { container } = render(
      <GhaWorkflowWorkbench workflow={sampleIr()} tabId={null} />,
    );
    expect(
      container.querySelector(".gha-workflow-workbench__canvas"),
    ).not.toBeNull();
    // Give the lazy chunk a beat — it must never appear.
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector(".workflow-editor-panel")).toBeNull();
  });

  describe("save pipeline", () => {
    it("writes to disk FIRST, then updates the doc and clears the queue (data-loss ordering)", async () => {
      const user = userEvent.setup();
      const order: string[] = [];
      mockSaveToPath.mockImplementation(() => {
        order.push("disk-write");
        return Promise.resolve(true);
      });
      const save = await renderAndQueuePatch();
      await user.click(save);

      await waitFor(() => expect(mockSaveToPath).toHaveBeenCalledTimes(1));
      const [tabId, path, next] = mockSaveToPath.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(tabId).toBe("tab-1");
      expect(path).toBe("/repo/.github/workflows/ci.yml");
      expect(next).toContain("name: renamed");
      // Doc state updated and queue cleared only after the disk write.
      expect(
        useDocumentStore.getState().documents["tab-1"].content,
      ).toContain("name: renamed");
      expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(0);
      expect(mockToast.success).toHaveBeenCalled();
      expect(order).toEqual(["disk-write"]);
    });

    it("keeps the patch queue intact when the disk write fails, so the user can retry", async () => {
      const user = userEvent.setup();
      mockSaveToPath.mockResolvedValue(false);
      const save = await renderAndQueuePatch();
      await user.click(save);

      await waitFor(() => expect(mockSaveToPath).toHaveBeenCalledTimes(1));
      // Nothing mutated, nothing cleared — the retry has the same state.
      expect(useDocumentStore.getState().documents["tab-1"].content).toBe(
        WORKFLOW_YAML,
      );
      expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(1);
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it("untitled workflows skip the disk write but apply the patch to the doc", async () => {
      const user = userEvent.setup();
      useDocumentStore.setState({
        documents: { "tab-1": { content: WORKFLOW_YAML, filePath: null } },
      } as never);
      const save = await renderAndQueuePatch();
      await user.click(save);

      await waitFor(() =>
        expect(
          useDocumentStore.getState().documents["tab-1"].content,
        ).toContain("name: renamed"),
      );
      expect(mockSaveToPath).not.toHaveBeenCalled();
      expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(0);
      expect(mockToast.success).toHaveBeenCalled();
    });

    // Audit 20260907 (#293/#296): the edit store has ONE active binding, and
    // every mounted workbench binds it on mount — so with two workflow panes
    // the last mount won and the other pane's forms queued patches under the
    // wrong document. The store stashes each document's queue on rebind, so a
    // workbench now rebinds to ITS document on interaction (pointer or focus)
    // and again before it saves, and only ever applies its own queue.
    it("saves ITS OWN document's queue even after another workbench rebound the store", async () => {
      const user = userEvent.setup();
      mockSaveToPath.mockResolvedValue(true);
      const save = await renderAndQueuePatch();
      // The other pane's workbench mounted and took the binding; this pane's
      // patch is stashed under its own document.
      useWorkflowStore.getState().bindToDocument("/repo/.github/workflows/other.yml");
      useWorkflowStore
        .getState()
        .queuePatch({ kind: "workflow.set", path: "name", value: "the-other-document" });
      expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(1);

      await user.click(save);

      await waitFor(() => expect(mockSaveToPath).toHaveBeenCalledTimes(1));
      const [, path, next] = mockSaveToPath.mock.calls[0] as [string, string, string];
      expect(path).toBe("/repo/.github/workflows/ci.yml");
      expect(next).toContain("name: renamed");
      expect(next).not.toContain("the-other-document");
      expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("/repo/.github/workflows/ci.yml");
      // The other document's queue is untouched in its stash.
      expect(useWorkflowStore.getState().edit.patchesByDocument["/repo/.github/workflows/other.yml"]).toHaveLength(1);
    });

    it.each(["pointerdown", "focusin"] as const)(
      "%s inside the workbench rebinds the store to its document without resetting the selection",
      async (eventName) => {
        render(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
        await waitFor(() =>
          expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("/repo/.github/workflows/ci.yml"),
        );
        useWorkflowStore.getState().selectJob("build");
        useWorkflowStore.getState().bindToDocument("/repo/.github/workflows/other.yml");

        const root = document.querySelector(".gha-workflow-workbench") as HTMLElement;
        root.dispatchEvent(new Event(eventName, { bubbles: true }));

        expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("/repo/.github/workflows/ci.yml");
        expect(useWorkflowStore.getState().view.selectedJobId).toBe("build");
      },
    );

    // Audit 20260907 (#297): applyAndSerialize returns the ORIGINAL yaml when
    // the document will not parse or a patch cannot be applied, and the save
    // then wrote the unchanged text, cleared the queue and toasted "saved" —
    // the user's edits gone with a success message. Unchanged output with a
    // pending queue is that failure (or a no-op), and neither writes nor clears.
    it("does not write, clear or claim success when the patches did not change the YAML", async () => {
      const user = userEvent.setup();
      useDocumentStore.setState({
        documents: {
          "tab-1": { content: "name: [unclosed\n", filePath: "/repo/.github/workflows/ci.yml" },
        },
      } as never);
      const save = await renderAndQueuePatch();
      await user.click(save);

      await waitFor(() => expect(mockToast.warning).toHaveBeenCalledTimes(1));
      expect(mockSaveToPath).not.toHaveBeenCalled();
      expect(useDocumentStore.getState().documents["tab-1"].content).toBe("name: [unclosed\n");
      expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(1);
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    // Audit 20260907 (#298): the forms stay editable while the disk write is
    // in flight. Clearing the WHOLE queue afterwards dropped a patch queued
    // during the write, and overwriting the editor with the pre-write text
    // discarded what the user typed meanwhile. Only the snapshot that was
    // written is cleared; the editor is overwritten only if it did not move.
    it("keeps a patch queued during the save, and ignores a second Save while one is in flight", async () => {
      const user = userEvent.setup();
      let finishWrite!: (ok: boolean) => void;
      mockSaveToPath.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finishWrite = resolve;
          }),
      );
      const save = await renderAndQueuePatch();
      await user.click(save);
      await waitFor(() => expect(mockSaveToPath).toHaveBeenCalledTimes(1));

      useWorkflowStore
        .getState()
        .queuePatch({ kind: "workflow.set", path: "run-name", value: "later" });
      await user.click(save);
      expect(mockSaveToPath).toHaveBeenCalledTimes(1);

      finishWrite(true);
      await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
      expect(useDocumentStore.getState().documents["tab-1"].content).toContain("name: renamed");
      expect(useWorkflowStore.getState().edit.pendingPatches).toEqual([
        { kind: "workflow.set", path: "run-name", value: "later" },
      ]);
    });

    // Audit R2 #590 — the in-flight guard was a component ref, so it covered
    // the BUTTON rather than the document. Two workbenches bound to the same
    // document (the same file open in two tabs) could each be mid-write, and
    // the later one would overwrite the earlier one's YAML.
    it("refuses a concurrent save of the SAME document from another workbench", async () => {
      const user = userEvent.setup();
      // A second tab on the same file — one document id, two workbenches.
      useDocumentStore.setState((s: { documents: Record<string, object> }) => ({
        documents: {
          ...s.documents,
          "tab-2": { content: WORKFLOW_YAML, filePath: "/repo/.github/workflows/ci.yml" },
        },
      }) as never);
      let finishWrite!: (ok: boolean) => void;
      mockSaveToPath.mockImplementation(
        () => new Promise<boolean>((resolve) => { finishWrite = resolve; }),
      );

      const firstSave = await renderAndQueuePatch();
      render(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-2" />);
      await waitFor(
        () => expect(document.querySelectorAll(".workflow-editor-panel")).toHaveLength(2),
        LAZY_MOUNT,
      );
      const saves = await screen.findAllByRole("button", { name: "Save" });

      await user.click(firstSave);
      await waitFor(() => expect(mockSaveToPath).toHaveBeenCalledTimes(1));
      await user.click(saves[1]!);
      expect(mockSaveToPath).toHaveBeenCalledTimes(1);

      finishWrite(true);
      await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    });

    it("releases the document lock once the save settles", async () => {
      const user = userEvent.setup();
      mockSaveToPath.mockResolvedValue(true);
      const save = await renderAndQueuePatch();
      await user.click(save);
      await waitFor(() => expect(mockSaveToPath).toHaveBeenCalledTimes(1));

      useWorkflowStore
        .getState()
        .queuePatch({ kind: "workflow.set", path: "run-name", value: "again" });
      await waitFor(() => expect(save).toBeEnabled());
      await user.click(save);
      await waitFor(() => expect(mockSaveToPath).toHaveBeenCalledTimes(2));
    });

    it("does not overwrite text the user typed while the save was in flight", async () => {
      const user = userEvent.setup();
      let finishWrite!: (ok: boolean) => void;
      mockSaveToPath.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finishWrite = resolve;
          }),
      );
      const save = await renderAndQueuePatch();
      await user.click(save);
      await waitFor(() => expect(mockSaveToPath).toHaveBeenCalledTimes(1));

      useDocumentStore.getState().setEditorContent("tab-1", "name: typed-meanwhile\n");
      finishWrite(true);
      await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
      expect(useDocumentStore.getState().documents["tab-1"].content).toBe("name: typed-meanwhile\n");
      expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(0);
    });

    it("surfaces a save exception as an error toast and keeps the queue", async () => {
      // applyAndSerialize is contractually non-throwing (it returns the
      // original YAML on any internal failure), so the catch branch
      // guards the disk write itself — a rejected saveToPath (I/O
      // exception, not the boolean-false soft failure).
      const user = userEvent.setup();
      mockSaveToPath.mockRejectedValue(new Error("disk exploded"));
      const save = await renderAndQueuePatch();
      await user.click(save);

      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
      expect(mockToast.error.mock.calls[0][0]).toContain("disk exploded");
      // Nothing mutated, nothing cleared — the retry has the same state.
      expect(useDocumentStore.getState().documents["tab-1"].content).toBe(
        WORKFLOW_YAML,
      );
      expect(useWorkflowStore.getState().edit.pendingPatches).toHaveLength(1);
      expect(mockToast.success).not.toHaveBeenCalled();
    });
  });
});

// Audit 20260907, round 3 — the two residuals of the one-binding design.
describe("GhaWorkflowWorkbench — binding hand-off between panes and paths", () => {
  // #293: pointerdown precedes the browser's focus change, so the destination
  // pane's capture handler rebound the store BEFORE the source pane's field
  // blurred — and that blur is the forms' commit, so the outgoing pane's patch
  // was queued under the destination document. The pane clicked into now
  // commits the other pane's field (blurs it) before it takes the binding.
  it("commits the outgoing pane's field under ITS document before the pane clicked into takes the binding", async () => {
    const user = userEvent.setup();
    useDocumentStore.setState({
      documents: {
        "tab-1": { content: WORKFLOW_YAML, filePath: "/repo/.github/workflows/ci.yml" },
        "tab-2": { content: WORKFLOW_YAML, filePath: "/repo/.github/workflows/other.yml" },
      },
    } as never);
    render(
      <>
        <GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />
        <GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-2" />
      </>,
    );
    await waitFor(
      () => expect(document.querySelectorAll(".workflow-editor-panel")).toHaveLength(2),
      LAZY_MOUNT,
    );
    const [groupA, groupB] = screen.getAllByPlaceholderText(/github\.ref/) as HTMLInputElement[];

    await user.click(groupA);
    await user.type(groupA, "ci-group");
    expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("/repo/.github/workflows/ci.yml");

    // pointerdown on B → (browser) A blurs and commits → B focuses.
    await user.click(groupB);

    const edit = useWorkflowStore.getState().edit;
    expect(edit.boundDocumentId).toBe("/repo/.github/workflows/other.yml");
    expect(edit.pendingPatches).toEqual([]);
    expect(edit.patchesByDocument["/repo/.github/workflows/ci.yml"]).toEqual([
      { kind: "workflow.concurrency.set", value: "ci-group" },
    ]);
  });

  // #292: rebinding on a path change moved the BINDING but not the QUEUE — the
  // store stashes the old id's patches and restores the new id's (empty) queue,
  // so a Save As of an untitled workflow with edits pending left them stranded
  // under `untitled:<tab>`, where nothing would ever save them.
  it("carries the pending queue to the new path on Save As", async () => {
    useDocumentStore.setState({
      documents: { "tab-1": { content: WORKFLOW_YAML, filePath: null } },
    } as never);
    render(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
    await waitFor(() =>
      expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("untitled:tab-1"),
    );
    useWorkflowStore.getState().queuePatch({ kind: "workflow.set", path: "name", value: "renamed" });

    useDocumentStore.setState({
      documents: { "tab-1": { content: WORKFLOW_YAML, filePath: "/repo/.github/workflows/new.yml" } },
    } as never);

    await waitFor(() =>
      expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("/repo/.github/workflows/new.yml"),
    );
    const edit = useWorkflowStore.getState().edit;
    expect(edit.pendingPatches).toEqual([{ kind: "workflow.set", path: "name", value: "renamed" }]);
    expect(edit.patchesByDocument["untitled:tab-1"]).toBeUndefined();
  });

  it("carries the queue even while another pane holds the binding and the user's focus", async () => {
    useDocumentStore.setState({
      documents: { "tab-1": { content: WORKFLOW_YAML, filePath: null } },
    } as never);
    render(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
    await waitFor(() =>
      expect(useWorkflowStore.getState().edit.boundDocumentId).toBe("untitled:tab-1"),
    );
    useWorkflowStore.getState().queuePatch({ kind: "workflow.set", path: "name", value: "renamed" });

    // The other pane takes the binding and the user's keyboard focus.
    useWorkflowStore.getState().bindToDocument("/repo/.github/workflows/other.yml");
    useWorkflowStore.getState().queuePatch({ kind: "workflow.set", path: "name", value: "theirs" });
    const otherPanesForm = document.createElement("input");
    document.body.appendChild(otherPanesForm);
    otherPanesForm.focus();

    useDocumentStore.setState({
      documents: { "tab-1": { content: WORKFLOW_YAML, filePath: "/repo/.github/workflows/new.yml" } },
    } as never);
    await new Promise((r) => setTimeout(r, 20));

    const edit = useWorkflowStore.getState().edit;
    // The other pane keeps the binding and its own queue…
    expect(edit.boundDocumentId).toBe("/repo/.github/workflows/other.yml");
    expect(edit.pendingPatches).toEqual([{ kind: "workflow.set", path: "name", value: "theirs" }]);
    // …and this pane's edits wait under its NEW path, not the untitled id.
    expect(edit.patchesByDocument["/repo/.github/workflows/new.yml"]).toEqual([
      { kind: "workflow.set", path: "name", value: "renamed" },
    ]);
    expect(edit.patchesByDocument["untitled:tab-1"]).toBeUndefined();
    otherPanesForm.remove();
  });
});
