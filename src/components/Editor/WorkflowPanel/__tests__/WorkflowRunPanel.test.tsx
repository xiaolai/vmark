// WI-LX2.1/WI-LX2.3 — the run panel both surfaces mount: Run/Cancel, why Run is off, Restore after a run.
/**
 * The graph canvas is stubbed (React Flow needs layout); the IPC and native
 * dialog are the only other fakes. Stores and hooks are real. Text is asserted
 * as i18n KEYS for the `workflow` namespace, which the test i18n map does not
 * load — the English values live in `src/locales/en/workflow.json`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
/** When set, `listen` waits on it — holds a start BEFORE it registers its run. */
const listenGate = vi.hoisted(() => ({ pending: null as Promise<void> | null }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => {
    if (listenGate.pending) await listenGate.pending;
    return () => {};
  },
}));
const ask = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask }));

const previewProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock("@/plugins/workflowPreview/WorkflowPreview", () => ({
  WorkflowPreview: (props: Record<string, unknown>) => {
    previewProps.last = props;
    return <div data-testid="workflow-graph" />;
  },
}));

import { WorkflowRunPanel } from "../WorkflowRunPanel";
import { resetWorkflowEvents, retainWorkflowEvents } from "@/services/workflow/workflowRunEvents";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkflowGraph } from "@/lib/workflow/types";

const GRAPH: WorkflowGraph = {
  name: "demo",
  triggers: [],
  env: {},
  defaults: {},
  steps: [],
  edges: [],
};
const initialWorkflow = useWorkflowStore.getState();

beforeEach(() => {
  useWorkflowStore.setState(initialWorkflow, true);
  useDocumentStore.setState({
    documents: { "tab-1": { content: "name: demo\nsteps:\n  - uses: action/notify\n" } },
  } as never);
  useWorkspaceStore.setState({ rootPath: "/work" } as never);
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "run_workflow") return args?.executionId;
    if (cmd === "list_workflow_snapshots") return [];
    return undefined;
  });
  ask.mockReset();
  previewProps.last = null;
  listenGate.pending = null;
  // The window's event owner (the approval dialog in the app); panels hold nothing.
  resetWorkflowEvents();
  retainWorkflowEvents();
});

const DOC = "name: demo\nsteps:\n  - uses: action/notify\n";

function runButton() {
  return screen.getByRole("button", { name: "Run workflow" });
}

describe("WorkflowRunPanel", () => {
  it("offers Run for a parsed graph and runs this tab's document", async () => {
    render(<WorkflowRunPanel tabId="tab-1" graph={GRAPH} parseError={null} />);
    expect(screen.getByTestId("workflow-graph")).toBeInTheDocument();
    await userEvent.click(runButton());
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "run_workflow",
        expect.objectContaining({ workspaceRoot: "/work" }),
      ),
    );
    expect(await screen.findByRole("button", { name: "Cancel workflow" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Running…");
  });

  it("disables Run and SAYS why when no folder is open", () => {
    useWorkspaceStore.setState({ rootPath: null } as never);
    render(<WorkflowRunPanel tabId="tab-1" graph={GRAPH} parseError={null} />);
    expect(runButton()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Open a folder to run this workflow");
  });

  it("disables Run while another surface's run is live, and paints none of its statuses", () => {
    useWorkflowStore.getState().setExecution("genie-run");
    useWorkflowStore.getState().setStepStatus("x", { status: "running" });
    render(<WorkflowRunPanel tabId="tab-1" graph={GRAPH} parseError={null} />);
    expect(runButton()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Another workflow is running");
    expect(previewProps.last?.stepStatuses).toBeUndefined();
  });

  it("shows a parse error instead of the graph, with Run disabled", () => {
    render(<WorkflowRunPanel tabId="tab-1" graph={null} parseError="Workflow must have a 'name' field" />);
    expect(screen.getByText("Workflow must have a 'name' field")).toBeInTheDocument();
    expect(screen.queryByTestId("workflow-graph")).toBeNull();
    expect(runButton()).toBeDisabled();
  });

  it("with no tab it renders the graph but cannot run", () => {
    render(<WorkflowRunPanel tabId={null} graph={GRAPH} parseError={null} />);
    expect(runButton()).toBeDisabled();
  });

  it("after this tab's run ends: shows the outcome and offers Restore Files when it took a snapshot", async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === "list_workflow_snapshots"
        ? [{ id: "snap-r1", executionId: "r1", timestamp: 1, fileCount: 1, createdCount: 0 }]
        : { restored: 1, deleted: 0, skipped: 0 },
    );
    ask.mockResolvedValue(true);
    act(() => {
      useWorkflowStore.getState().setExecution("r1", { tabId: "tab-1", source: DOC });
      useWorkflowStore.getState().finishExecution("r1", "completed");
    });
    render(<WorkflowRunPanel tabId="tab-1" graph={GRAPH} parseError={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Completed");
    const restore = await screen.findByRole("button", { name: "Restore Files" });
    await userEvent.click(restore);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("restore_workflow_snapshot", { snapshotId: "snap-r1" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Restore Files" })).toBeNull(),
    );
  });

  it("does not offer Restore to a tab that did not run the workflow", async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === "list_workflow_snapshots"
        ? [{ id: "snap-r1", executionId: "r1", timestamp: 1, fileCount: 1, createdCount: 0 }]
        : undefined,
    );
    act(() => {
      useWorkflowStore.getState().setExecution("r1", { tabId: "tab-other", source: DOC });
      useWorkflowStore.getState().finishExecution("r1", "completed");
    });
    render(<WorkflowRunPanel tabId="tab-1" graph={GRAPH} parseError={null} />);
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: "Restore Files" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  function clickNode(stepId: string) {
    act(() => {
      (previewProps.last?.onNodeClick as (id: string) => void)(stepId);
    });
  }

  it("clicking a node selects that step", async () => {
    render(<WorkflowRunPanel tabId="tab-1" graph={GRAPH} parseError={null} />);
    clickNode("save");
    expect(previewProps.last?.activeStepId).toBe("save");
  });

  // Audit fix-round #105: the selection was window-global, so a panel for
  // another workflow highlighted ITS step that happened to share the id.
  it("a step selected in one tab's panel is not highlighted in another tab's", () => {
    const seen: Record<string, unknown> = {};
    render(<WorkflowRunPanel tabId="tab-1" graph={GRAPH} parseError={null} />);
    clickNode("save");
    seen.first = previewProps.last?.activeStepId;
    render(<WorkflowRunPanel tabId="tab-2" graph={GRAPH} parseError={null} />);
    expect(seen.first).toBe("save");
    expect(previewProps.last?.activeStepId).toBeNull();
  });

  // Round 2 (#105): the yaml adapter re-parses the graph locally on every
  // edit and never told the store, so an edited workflow in the SAME tab
  // inherited the old selection by step id. A selection belongs to the graph
  // it was made on — as the markdown path's re-parse already clears it.
  it("a re-parsed graph in the same tab does not inherit the selection", () => {
    const { rerender } = render(<WorkflowRunPanel tabId="tab-1" graph={GRAPH} parseError={null} />);
    clickNode("save");
    expect(previewProps.last?.activeStepId).toBe("save");
    rerender(<WorkflowRunPanel tabId="tab-1" graph={{ ...GRAPH }} parseError={null} />);
    expect(previewProps.last?.activeStepId).toBeNull();
  });

  // Audit fix-round #102: before its run is registered, a start has nothing to
  // cancel — the panel says it is starting and Cancel is not live.
  it("while a start has not registered its run: says Starting and Cancel is disabled", async () => {
    let release = () => {};
    resetWorkflowEvents();
    listenGate.pending = new Promise<void>((resolve) => (release = resolve));
    retainWorkflowEvents(); // subscription in flight: a start waits before registering
    render(<WorkflowRunPanel tabId="tab-1" graph={GRAPH} parseError={null} />);
    await userEvent.click(runButton());
    const cancel = screen.getByRole("button", { name: "Cancel workflow" });
    expect(cancel).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Starting…");

    await act(async () => release());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel workflow" })).toBeEnabled(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Running…");
  });

  // Audit fix-round #103: Restore stayed enabled while its confirmation was
  // open, so a second click opened a second dialog and a second restore.
  it("Restore is disabled from the click on, through the confirmation", async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === "list_workflow_snapshots"
        ? [{ id: "snap-r1", executionId: "r1", timestamp: 1, fileCount: 1, createdCount: 0 }]
        : undefined,
    );
    let answer: (yes: boolean) => void = () => {};
    ask.mockReturnValue(new Promise<boolean>((resolve) => (answer = resolve)));
    act(() => {
      useWorkflowStore.getState().setExecution("r1", { tabId: "tab-1", source: DOC });
      useWorkflowStore.getState().finishExecution("r1", "completed");
    });
    render(<WorkflowRunPanel tabId="tab-1" graph={GRAPH} parseError={null} />);
    const restore = await screen.findByRole("button", { name: "Restore Files" });
    await userEvent.click(restore);
    expect(restore).toBeDisabled();
    await userEvent.click(restore);
    expect(ask).toHaveBeenCalledTimes(1);
    await act(async () => answer(false));
    await waitFor(() => expect(restore).toBeEnabled());
  });
});
