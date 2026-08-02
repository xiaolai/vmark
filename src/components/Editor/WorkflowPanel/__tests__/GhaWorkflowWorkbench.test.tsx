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

const mockSaveToPath = vi.fn();
vi.mock("@/services/persistence/saveToPath", () => ({
  saveToPath: (...args: unknown[]) => mockSaveToPath(...args),
}));

const mockToast = { success: vi.fn(), error: vi.fn() };
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: {
    success: (...args: unknown[]) => mockToast.success(...args),
    error: (...args: unknown[]) => mockToast.error(...args),
  },
}));

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
  // @ts-expect-error jsdom shim
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

async function renderAndQueuePatch() {
  render(<GhaWorkflowWorkbench workflow={sampleIr()} tabId="tab-1" />);
  await waitFor(() =>
    expect(document.querySelector(".workflow-editor-panel")).not.toBeNull(),
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
    await waitFor(() =>
      expect(container.querySelector(".workflow-editor-panel")).not.toBeNull(),
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
