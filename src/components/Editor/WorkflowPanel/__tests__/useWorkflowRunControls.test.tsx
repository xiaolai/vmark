// WI-LX2.1/WI-LX2.2 — Run/Cancel for ONE document: its own content, its own run, failures shown.
/**
 * Only the IPC boundary is faked (`invoke`, `listen`); the execution hook,
 * the workflow/document/workspace stores and the ownership rule are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

type Listener = (event: { payload: unknown }) => void;
const listeners = vi.hoisted(() => new Map<string, Listener>());
/** When set, `listen` waits on it — holds a start BEFORE it registers its run. */
const listenGate = vi.hoisted(() => ({ pending: null as Promise<void> | null }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: Listener) => {
    if (listenGate.pending) await listenGate.pending;
    listeners.set(name, handler);
    return () => listeners.delete(name);
  },
}));

import { useWorkflowRunControls } from "../useWorkflowRunControls";
import { resetWorkflowEvents, retainWorkflowEvents } from "@/services/workflow/workflowRunEvents";
import { dispatchWorkflowRun } from "@/services/workflow/dispatchWorkflowRun";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { imeToast } from "@/services/ime/imeToast";

const initialWorkflow = useWorkflowStore.getState();
const YAML_A = "name: a\nsteps:\n  - uses: action/notify\n";
const YAML_B = "name: b\nsteps:\n  - uses: action/copy\n";

function runWorkflowCalls(): Array<Record<string, unknown>> {
  return invoke.mock.calls
    .filter(([cmd]) => cmd === "run_workflow")
    .map(([, args]) => args as Record<string, unknown>);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) =>
    cmd === "run_workflow" ? args?.executionId : undefined,
  );
  listeners.clear();
  listenGate.pending = null;
  // The window's event owner — the approval dialog in the app — holds the one
  // subscription; the panels under test subscribe nothing themselves (#115).
  resetWorkflowEvents();
  retainWorkflowEvents();
  useWorkflowStore.setState(initialWorkflow, true);
  useDocumentStore.setState({
    documents: { "tab-a": { content: YAML_A }, "tab-b": { content: YAML_B } },
  } as never);
  useWorkspaceStore.setState({ rootPath: "/work" } as never);
  // The ACTIVE tab of window "main" is another document: the panel must not
  // care (WI-LX2.2 — it used to read `getActiveTab("main")`).
  useTabStore.setState({ activeTabId: { main: "tab-a" } } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Re-hold the window's subscription with `listen` gated, so a start waits
 *  BEFORE it registers. Returns the gate's opener. */
function holdSubscription(): () => void {
  resetWorkflowEvents();
  let open = () => {};
  listenGate.pending = new Promise<void>((resolve) => (open = resolve));
  retainWorkflowEvents();
  return open;
}

describe("useWorkflowRunControls — starting a run", () => {
  it("runs THIS tab's document against the workspace root, whatever tab is active elsewhere", async () => {
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    const [call] = runWorkflowCalls();
    expect(call.yaml).toBe(YAML_B);
    expect(call.workspaceRoot).toBe("/work");
  });

  it("owns the run it started: running, Cancel available, statuses visible", async () => {
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    const id = useWorkflowStore.getState().preview.executionId;
    expect(id).not.toBeNull();
    expect(useWorkflowStore.getState().preview.runTabId).toBe("tab-b");
    expect(result.current.owned).toBe(true);
    expect(result.current.running).toBe(true);

    act(() => {
      listeners.get("workflow:step-update")?.({
        payload: { executionId: id, stepId: "copy", status: "success" },
      });
    });
    expect(result.current.stepStatuses).toEqual({ copy: { status: "success" } });
  });

  it("keeps ownership and reports the outcome after the run completes", async () => {
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    const id = useWorkflowStore.getState().preview.executionId;
    act(() => {
      listeners.get("workflow:complete")?.({ payload: { executionId: id, status: "failed" } });
    });
    expect(result.current.running).toBe(false);
    expect(result.current.owned).toBe(true);
    expect(result.current.outcome).toBe("failed");
  });

  it("cancel asks the runner to stop THIS run", async () => {
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    const id = useWorkflowStore.getState().preview.executionId;
    await act(async () => {
      result.current.cancel();
    });
    expect(invoke).toHaveBeenCalledWith("cancel_workflow", { executionId: id });
  });

  // Audit fix-round #102: `running` covers the start BEFORE its execution id
  // is registered, and a Cancel clicked then did nothing at all — the run
  // started anyway. Cancel is offered only once there is a run to cancel.
  it("offers no Cancel until the start has registered its run", async () => {
    const release = holdSubscription();
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = result.current.run();
    });
    expect(result.current.running).toBe(true);
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
    expect(result.current.cancellable).toBe(false);

    await act(async () => {
      release();
      await started;
    });
    expect(result.current.cancellable).toBe(true);
  });

  // Audit fix-round #116: every cancel failure was logged as a benign race, so
  // a cancel the transport or backend lost left the run going with no word.
  it("shows a cancel that failed, but not one refused because the run already ended", async () => {
    const errorDetail = vi.spyOn(imeToast, "errorDetail").mockReturnValue("t" as never);
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    const lost = { code: "io", message: "pipe closed" };
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "cancel_workflow") throw lost;
      return undefined;
    });
    await act(async () => {
      result.current.cancel();
    });
    await waitFor(() => expect(errorDetail).toHaveBeenCalledWith("The workflow could not be cancelled", lost));

    errorDetail.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "cancel_workflow") throw { code: "not-found", message: "not running" };
      return undefined;
    });
    await act(async () => {
      result.current.cancel();
    });
    expect(errorDetail).not.toHaveBeenCalled();
  });

  // Audit fix-round #106: a finished run's statuses were painted over whatever
  // the document said NOW, so an edited step sharing an old id showed the old
  // step's success or failure. They are painted only over the text that ran.
  it("paints the run's statuses only while the document is the text it ran", async () => {
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    const id = useWorkflowStore.getState().preview.executionId;
    act(() => {
      listeners.get("workflow:step-update")?.({
        payload: { executionId: id, stepId: "copy", status: "success" },
      });
      listeners.get("workflow:complete")?.({ payload: { executionId: id, status: "completed" } });
    });
    expect(result.current.stepStatuses).toEqual({ copy: { status: "success" } });

    act(() => {
      useDocumentStore.setState({
        documents: { "tab-b": { content: YAML_B.replace("copy", "move") } },
      } as never);
    });
    expect(result.current.stepStatuses).toBeUndefined();

    act(() => {
      useDocumentStore.setState({ documents: { "tab-b": { content: YAML_B } } } as never);
    });
    expect(result.current.stepStatuses).toEqual({ copy: { status: "success" } });
  });
});

describe("useWorkflowRunControls — when it cannot run", () => {
  it("says a folder is needed and starts nothing without a workspace", async () => {
    useWorkspaceStore.setState({ rootPath: null } as never);
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    expect(result.current.blockedReason).toBe("needsWorkspace");
    await act(async () => {
      await result.current.run();
    });
    expect(runWorkflowCalls()).toHaveLength(0);
  });

  it("does not claim a run another surface started (a workflow genie)", () => {
    useWorkflowStore.getState().setExecution("genie-run");
    useWorkflowStore.getState().setStepStatus("copy", { status: "running" });
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    expect(result.current.owned).toBe(false);
    expect(result.current.running).toBe(false);
    expect(result.current.blockedReason).toBe("busy");
    expect(result.current.stepStatuses).toBeUndefined();
  });

  it("another tab's run is not this tab's: busy here, owned there", async () => {
    const a = renderHook(() => useWorkflowRunControls("tab-a"));
    const b = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await a.result.current.run();
    });
    expect(a.result.current.owned).toBe(true);
    expect(b.result.current.owned).toBe(false);
    expect(b.result.current.blockedReason).toBe("busy");
  });

  it("with no tab, it never runs", async () => {
    const { result } = renderHook(() => useWorkflowRunControls(null));
    await act(async () => {
      await result.current.run();
    });
    expect(runWorkflowCalls()).toHaveLength(0);
  });

  it("an empty document starts nothing", async () => {
    useDocumentStore.setState({ documents: { "tab-b": { content: "   " } } } as never);
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    expect(runWorkflowCalls()).toHaveLength(0);
  });
});

describe("useWorkflowRunControls — a start the backend refuses", () => {
  it("shows the typed error to the user and leaves nothing running", async () => {
    const refusal = {
      code: "feature-disabled",
      message: "The workflow engine is turned off in Settings",
    };
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "run_workflow") throw refusal;
      return undefined;
    });
    const errorDetail = vi.spyOn(imeToast, "errorDetail").mockReturnValue("t" as never);
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    // The test i18n map does not load the `workflow` namespace, so the key
    // itself is what renders here; the English text lives in workflow.json.
    expect(errorDetail).toHaveBeenCalledWith("The workflow could not start", refusal);
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
    expect(result.current.owned).toBe(false);
  });
});

// Audit 20260928 #113/#114 — ownership is registered WITH the run, so Cancel
// can only ever reach this panel's own execution, and a panel that remounts
// while its start is still in flight recognises the run as its own.
describe("useWorkflowRunControls — ownership from registration (#113/#114)", () => {
  it("competing starts: the panel that loses never offers a Cancel that reaches the winner's run", async () => {
    const open = holdSubscription();
    const a = renderHook(() => useWorkflowRunControls("tab-a"));
    const b = renderHook(() => useWorkflowRunControls("tab-b"));
    vi.spyOn(imeToast, "errorDetail").mockReturnValue("t" as never);

    let startedB: Promise<void> = Promise.resolve();
    let startedA: Promise<void> = Promise.resolve();
    act(() => {
      startedB = b.result.current.run(); // queued first: registers first
      startedA = a.result.current.run();
    });
    // Both are waiting for the subscription; neither has registered.
    expect(a.result.current.cancellable).toBe(false);
    expect(b.result.current.cancellable).toBe(false);

    await act(async () => {
      open();
      await Promise.all([startedA, startedB]);
    });
    const winner = useWorkflowStore.getState().preview.executionId;
    expect(useWorkflowStore.getState().preview.runTabId).toBe("tab-b");
    expect(b.result.current.cancellable).toBe(true);
    expect(a.result.current.owned).toBe(false);
    expect(a.result.current.cancellable).toBe(false);
    expect(a.result.current.blockedReason).toBe("busy");

    invoke.mockClear();
    await act(async () => {
      a.result.current.cancel();
    });
    expect(invoke).not.toHaveBeenCalledWith("cancel_workflow", expect.anything());

    await act(async () => {
      b.result.current.cancel();
    });
    expect(invoke).toHaveBeenCalledWith("cancel_workflow", { executionId: winner });
  });

  it("a genie's run registered mid-start is never this panel's to cancel", async () => {
    const open = holdSubscription();
    const panel = renderHook(() => useWorkflowRunControls("tab-a"));
    vi.spyOn(imeToast, "errorDetail").mockReturnValue("t" as never);

    let genie: Promise<unknown> = Promise.resolve();
    let started: Promise<void> = Promise.resolve();
    act(() => {
      genie = dispatchWorkflowRun({ yaml: YAML_B, workspaceRoot: "/work", provider: null });
      started = panel.result.current.run();
    });
    await act(async () => {
      open();
      await Promise.all([genie, started]);
    });

    expect(useWorkflowStore.getState().preview.executionId).not.toBeNull();
    expect(useWorkflowStore.getState().preview.runTabId).toBeNull();
    expect(panel.result.current.cancellable).toBe(false);
    invoke.mockClear();
    await act(async () => {
      panel.result.current.cancel();
    });
    expect(invoke).not.toHaveBeenCalledWith("cancel_workflow", expect.anything());
  });

  it("a panel unmounted and remounted during a deferred start sees ITS run, and can cancel it", async () => {
    let admit: (id: string) => void = () => {};
    invoke.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
      cmd === "run_workflow"
        ? new Promise<string>((resolve) => (admit = () => resolve(String(args?.executionId))))
        : Promise.resolve(undefined),
    );
    const first = renderHook(() => useWorkflowRunControls("tab-a"));
    let started: Promise<void> = Promise.resolve();
    await act(async () => {
      started = first.result.current.run();
      await vi.waitFor(() => expect(runWorkflowCalls()).toHaveLength(1)); // snapshotting…
    });
    first.unmount();

    const again = renderHook(() => useWorkflowRunControls("tab-a"));
    const id = useWorkflowStore.getState().preview.executionId;
    expect(again.result.current.owned).toBe(true);
    expect(again.result.current.running).toBe(true);
    expect(again.result.current.cancellable).toBe(true);
    expect(again.result.current.blockedReason).toBeNull();

    await act(async () => {
      again.result.current.cancel();
    });
    expect(invoke).toHaveBeenCalledWith("cancel_workflow", { executionId: id });

    await act(async () => {
      admit(String(id));
      await started;
    });
  });
});
