// WI-LX2.3 — after a run, its pre-run snapshot is offered back, confirmed, and restored.
/**
 * Only the IPC and native-dialog boundaries are faked (`invoke`, `ask`); the
 * workflow store, the snapshot wrappers and the hook are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const ask = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask }));

import { useRunSnapshot } from "../useRunSnapshot";
import { useWorkflowStore } from "@/stores/workflowStore";
import { imeToast } from "@/services/ime/imeToast";

const initialWorkflow = useWorkflowStore.getState();
const SNAPSHOT = { id: "snap-r1", executionId: "r1", timestamp: 9, fileCount: 2, createdCount: 1 };

/** A run owned by tab-1 that has finished. */
function finishedOwnedRun(id = "r1") {
  useWorkflowStore.getState().setExecution(id, { tabId: "tab-1", source: "name: a\n" });
  useWorkflowStore.getState().finishExecution(id, "completed");
}

beforeEach(() => {
  useWorkflowStore.setState(initialWorkflow, true);
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "list_workflow_snapshots") return [SNAPSHOT];
    if (cmd === "restore_workflow_snapshot") return { restored: 2, deleted: 1, skipped: 0 };
    return undefined;
  });
  ask.mockReset();
  ask.mockResolvedValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("useRunSnapshot — finding the snapshot", () => {
  it("offers the snapshot the owner's finished run took", async () => {
    finishedOwnedRun();
    const { result } = renderHook(() => useRunSnapshot(true));
    await waitFor(() => expect(result.current.snapshot).toEqual(SNAPSHOT));
  });

  it("offers nothing when this tab does not own the run", async () => {
    finishedOwnedRun();
    const { result } = renderHook(() => useRunSnapshot(false));
    await Promise.resolve();
    expect(result.current.snapshot).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("offers nothing while the run is still going", async () => {
    useWorkflowStore.getState().setExecution("r1", { tabId: "tab-1", source: "name: a\n" });
    const { result } = renderHook(() => useRunSnapshot(true));
    await Promise.resolve();
    expect(result.current.snapshot).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("offers nothing when the run took no snapshot (it wrote no files)", async () => {
    finishedOwnedRun("r2");
    const { result } = renderHook(() => useRunSnapshot(true));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_workflow_snapshots"));
    expect(result.current.snapshot).toBeNull();
  });

  it("a failed listing offers nothing and does not throw", async () => {
    invoke.mockRejectedValue({ code: "io", message: "disk" });
    vi.spyOn(imeToast, "errorDetail").mockReturnValue("e" as never);
    finishedOwnedRun();
    const { result } = renderHook(() => useRunSnapshot(true));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(result.current.snapshot).toBeNull();
  });

  // Audit fix-round #112: a failed listing was logged and never retried, so the
  // run's recovery point silently never appeared. One retry, then say so.
  describe("a listing that fails", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("is retried once, and a retry that succeeds offers the snapshot", async () => {
      invoke.mockRejectedValueOnce({ code: "io", message: "busy" });
      finishedOwnedRun();
      const { result } = renderHook(() => useRunSnapshot(true));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(result.current.snapshot).toEqual(SNAPSHOT);
    });

    it("tells the user when the retry fails too", async () => {
      const failure = { code: "io", message: "disk" };
      invoke.mockRejectedValue(failure);
      const errorDetail = vi.spyOn(imeToast, "errorDetail").mockReturnValue("e" as never);
      finishedOwnedRun();
      renderHook(() => useRunSnapshot(true));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(errorDetail).toHaveBeenCalledWith("Could not look up the files this run can restore", failure);
    });

    it("does not retry for a panel that has gone", async () => {
      invoke.mockRejectedValue({ code: "io", message: "disk" });
      finishedOwnedRun();
      const { unmount } = renderHook(() => useRunSnapshot(true));
      await act(async () => {
        await Promise.resolve();
      });
      unmount();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(invoke).toHaveBeenCalledTimes(1);
    });
  });
});

describe("useRunSnapshot — restoring", () => {
  async function ready() {
    finishedOwnedRun();
    const hook = renderHook(() => useRunSnapshot(true));
    await waitFor(() => expect(hook.result.current.snapshot).not.toBeNull());
    return hook;
  }

  it("asks first, naming what will change, then restores by id and reports success", async () => {
    const success = vi.spyOn(imeToast, "success").mockImplementation(() => undefined);
    const { result } = await ready();
    await act(async () => {
      await result.current.restore();
    });
    const [message, options] = ask.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("2 files will be put back as they were before the run.");
    expect(message).toContain("1 file the run created will be deleted.");
    expect(message).toContain("Edits made to these files since the run will be lost.");
    expect(options.kind).toBe("warning");
    expect(options.okLabel).toBe("Restore");
    expect(invoke).toHaveBeenCalledWith("restore_workflow_snapshot", { snapshotId: "snap-r1" });
    expect(success).toHaveBeenCalledWith("Files restored to their state before the run");
    // Offered once: a second click would clobber edits made since.
    expect(result.current.snapshot).toBeNull();
  });

  it("does nothing when the user declines", async () => {
    ask.mockResolvedValue(false);
    const { result } = await ready();
    await act(async () => {
      await result.current.restore();
    });
    expect(invoke).not.toHaveBeenCalledWith("restore_workflow_snapshot", expect.anything());
    expect(result.current.snapshot).toEqual(SNAPSHOT);
  });

  it("warns with a count when some files could not be restored", async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === "list_workflow_snapshots" ? [SNAPSHOT] : { restored: 1, deleted: 1, skipped: 2 },
    );
    const warning = vi.spyOn(imeToast, "warning").mockReturnValue("w" as never);
    const { result } = await ready();
    await act(async () => {
      await result.current.restore();
    });
    expect(warning).toHaveBeenCalledWith("2 files could not be restored and were left as they are");
    // Audit fix-round #110: the skipped files are still unrecovered, so the
    // offer stays — a retry after fixing the cause is the only way back.
    expect(result.current.snapshot).toEqual(SNAPSHOT);
    expect(useWorkflowStore.getState().preview.restoredExecutionId).toBeNull();
  });

  // Audit fix-round #109: "offered once" lived in this hook's state, so a
  // remounted panel listed the same snapshot and offered it again.
  it("a fully restored run is not offered again by a panel mounted later", async () => {
    const { result, unmount } = await ready();
    await act(async () => {
      await result.current.restore();
    });
    unmount();
    invoke.mockClear();
    const again = renderHook(() => useRunSnapshot(true));
    await Promise.resolve();
    expect(again.result.current.snapshot).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("list_workflow_snapshots");
  });

  // Audit fix-round #107/#103: `restoring` was set only after the confirmation,
  // so two quick activations opened two dialogs and restored twice.
  it("a second activation while the first is confirming does nothing", async () => {
    let answer: (yes: boolean) => void = () => {};
    ask.mockReturnValue(new Promise<boolean>((resolve) => (answer = resolve)));
    const { result } = await ready();
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.restore();
    });
    expect(result.current.restoring).toBe(true);
    await act(async () => {
      await result.current.restore();
    });
    await act(async () => {
      answer(true);
      await first;
    });
    expect(ask).toHaveBeenCalledTimes(1);
    const restores = invoke.mock.calls.filter(([cmd]) => cmd === "restore_workflow_snapshot");
    expect(restores).toHaveLength(1);
    expect(result.current.restoring).toBe(false);
  });

  // Audit fix-round #111/#104: the confirmation sat outside the try, and the
  // panel discards the promise — a dialog failure became an unhandled rejection.
  it("a confirmation dialog that fails is reported, not thrown", async () => {
    const failure = new Error("dialog plugin unavailable");
    ask.mockRejectedValue(failure);
    const errorDetail = vi.spyOn(imeToast, "errorDetail").mockReturnValue("e" as never);
    const { result } = await ready();
    await act(async () => {
      await expect(result.current.restore()).resolves.toBeUndefined();
    });
    expect(errorDetail).toHaveBeenCalledWith("Could not restore the files", failure);
    expect(result.current.restoring).toBe(false);
    expect(result.current.snapshot).toEqual(SNAPSHOT);
  });

  // Audit fix-round #108: while the dialog was open another run could finish,
  // and confirming then restored the OLD snapshot over the newer results.
  it("does not restore when another run has happened since the dialog opened", async () => {
    let answer: (yes: boolean) => void = () => {};
    ask.mockReturnValue(new Promise<boolean>((resolve) => (answer = resolve)));
    const warning = vi.spyOn(imeToast, "warning").mockReturnValue("w" as never);
    const { result } = await ready();
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.restore();
    });
    act(() => {
      useWorkflowStore.getState().setExecution("genie-run");
      useWorkflowStore.getState().finishExecution("genie-run", "completed");
    });
    await act(async () => {
      answer(true);
      await pending;
    });
    expect(invoke).not.toHaveBeenCalledWith("restore_workflow_snapshot", expect.anything());
    expect(warning).toHaveBeenCalledWith("Another workflow ran since, so these files were not restored");
  });

  it("shows a refused restore with its typed message, and keeps the offer", async () => {
    const refusal = { code: "conflict", message: "A workflow is running." };
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_workflow_snapshots") return [SNAPSHOT];
      throw refusal;
    });
    const errorDetail = vi.spyOn(imeToast, "errorDetail").mockReturnValue("e" as never);
    const { result } = await ready();
    await act(async () => {
      await result.current.restore();
    });
    expect(errorDetail).toHaveBeenCalledWith("Could not restore the files", refusal);
    expect(result.current.snapshot).toEqual(SNAPSHOT);
    expect(result.current.restoring).toBe(false);
  });
});
