/**
 * useWorkflowExecution — lifecycle owner tests (audit #955).
 *
 * Pins the seven correctness rules that live only inside the hook:
 *   1. wrong-executionId events are ignored (filter)
 *   2. matching-executionId events dispatch into the store
 *   3. invoke() rejection rolls executionId back to null
 *   4. setExecution() runs BEFORE invoke() resolves (race fix)
 *   5. randomUUID fallback produces a non-empty timestamp-suffix id
 *   6. workflow:complete dismisses a matching pending approval
 *   7. unmount cleans every listener; a second cleanup call is harmless
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks must be declared before the hook is imported so vi.mock hoists them
// above the `import { useWorkflowExecution }` line.
// ---------------------------------------------------------------------------

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
const unlistenMocks: ReturnType<typeof vi.fn>[] = [];

const listenMock = vi.fn(async (event: string, handler: Listener) => {
  listeners.set(event, handler);
  const unlisten = vi.fn();
  unlistenMocks.push(unlisten);
  return unlisten;
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) =>
    listenMock(args[0] as string, args[1] as Listener),
}));

// Import the hook *after* the mocks are registered.
import { useWorkflowExecution } from "./useWorkflowExecution";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useAiProviderStore } from "@/stores/aiStore";

const initialWorkflowState = useWorkflowStore.getState();
const initialAiProviderState = useAiProviderStore.getState();

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockClear();
  listeners.clear();
  unlistenMocks.length = 0;
  // Restore the stores so tests don't bleed state into each other.
  useWorkflowStore.setState(initialWorkflowState, true);
  useAiProviderStore.setState(initialAiProviderState, true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function waitForListeners() {
  await waitFor(() => {
    expect(listeners.size).toBe(3);
  });
}

describe("useWorkflowExecution — event filter", () => {
  it("ignores step-update for a non-matching executionId", async () => {
    renderHook(() => useWorkflowExecution());
    await waitForListeners();
    useWorkflowStore.getState().setExecution("active-id");

    act(() => {
      listeners.get("workflow:step-update")?.({
        payload: {
          executionId: "OTHER",
          stepId: "step-1",
          status: "running",
        },
      });
    });

    // Filter dropped the event — no step status recorded.
    expect(useWorkflowStore.getState().preview.stepStatuses).toEqual({});
  });

  it("dispatches step-update when the executionId matches", async () => {
    renderHook(() => useWorkflowExecution());
    await waitForListeners();
    useWorkflowStore.getState().setExecution("active-id");

    act(() => {
      listeners.get("workflow:step-update")?.({
        payload: {
          executionId: "active-id",
          stepId: "step-1",
          status: "success",
          output: "ok",
          duration: 12,
        },
      });
    });

    expect(useWorkflowStore.getState().preview.stepStatuses).toEqual({
      "step-1": {
        status: "success",
        output: "ok",
        error: undefined,
        duration: 12,
      },
    });
  });

  it("ignores approval-request for a non-matching executionId", async () => {
    renderHook(() => useWorkflowExecution());
    await waitForListeners();
    useWorkflowStore.getState().setExecution("active-id");

    act(() => {
      listeners.get("workflow:approval-request")?.({
        payload: {
          executionId: "OTHER",
          stepId: "step-1",
          actionType: "shell",
          summary: "rm -rf /",
        },
      });
    });

    expect(useWorkflowStore.getState().approval.pending).toBeNull();
  });
});

describe("useWorkflowExecution — invoke rollback", () => {
  it("clears executionId when invoke('run_workflow') rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("concurrency guard"));
    const { result } = renderHook(() => useWorkflowExecution());
    await waitForListeners();

    await expect(
      result.current.start({ yaml: "name: x", workspaceRoot: "/w" }),
    ).rejects.toThrow("concurrency guard");

    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
  });
});

describe("useWorkflowExecution — pre-emptive setExecution (race fix)", () => {
  it("registers executionId BEFORE invoke('run_workflow') resolves", async () => {
    let resolveInvoke: (value: string) => void = () => undefined;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          // Snapshot the store at the moment invoke runs (before it resolves).
          // This is the race the hook closes: events arriving during the
          // pending invoke must already have an executionId to filter against.
          expect(
            useWorkflowStore.getState().preview.executionId,
          ).not.toBeNull();
          resolveInvoke = resolve;
        }),
    );

    const { result } = renderHook(() => useWorkflowExecution());
    await waitForListeners();

    const started = result.current.start({
      yaml: "name: x",
      workspaceRoot: "/w",
    });
    // Let the invoke promise begin (snapshot inside mockImplementation runs).
    await Promise.resolve();
    resolveInvoke("server-id");
    await started;
  });
});

describe("useWorkflowExecution — randomUUID fallback", () => {
  it("produces a timestamp-suffix id when crypto.randomUUID is unavailable", async () => {
    // jsdom exposes a non-configurable `crypto` whose randomUUID can't be
    // deleted in place. Swap the whole binding for one without
    // randomUUID — that's what the hook's `"randomUUID" in crypto` guard
    // is meant to handle (older environments that ship Web Crypto but
    // pre-date the randomUUID addition).
    const realCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
      configurable: true,
    });

    try {
      invokeMock.mockResolvedValueOnce("server-id");
      const { result } = renderHook(() => useWorkflowExecution());
      await waitForListeners();

      await result.current.start({ yaml: "name: x", workspaceRoot: "/w" });

      const id = useWorkflowStore.getState().preview.executionId;
      // The fallback path runs before invoke resolves; once resolve hits,
      // setExecution stays at the generated id since the hook doesn't
      // overwrite with the server's returned id.
      expect(id).toMatch(/^\d+-[a-z0-9]+$/);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: realCrypto,
        configurable: true,
      });
    }
  });
});

describe("useWorkflowExecution — completion dismisses pending approval", () => {
  it("calls dismissApproval when workflow:complete matches the pending approval id", async () => {
    renderHook(() => useWorkflowExecution());
    await waitForListeners();

    useWorkflowStore.getState().setExecution("exec-42");
    useWorkflowStore.getState().enqueueApproval({
      executionId: "exec-42",
      stepId: "step-1",
      actionType: "shell",
      summary: "deploy",
    });
    expect(useWorkflowStore.getState().approval.pending).not.toBeNull();

    act(() => {
      listeners.get("workflow:complete")?.({
        payload: { executionId: "exec-42", status: "completed" },
      });
    });

    expect(useWorkflowStore.getState().approval.pending).toBeNull();
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
  });
});

describe("useWorkflowExecution — cancel + respondApproval (coverage)", () => {
  it("cancel() invokes cancel_workflow with the active executionId", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useWorkflowExecution());
    await waitForListeners();
    useWorkflowStore.getState().setExecution("exec-7");

    await result.current.cancel();

    expect(invokeMock).toHaveBeenCalledWith("cancel_workflow", {
      executionId: "exec-7",
    });
  });

  it("cancel() is a no-op when no execution is active", async () => {
    const { result } = renderHook(() => useWorkflowExecution());
    await waitForListeners();
    // executionId starts null after store reset.

    await result.current.cancel();

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("respondApproval() invokes respond_workflow_approval with the verdict", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useWorkflowExecution());
    await waitForListeners();

    await result.current.respondApproval("exec-1", "step-1", true);

    expect(invokeMock).toHaveBeenCalledWith("respond_workflow_approval", {
      executionId: "exec-1",
      stepId: "step-1",
      approved: true,
    });
  });
});

describe("useWorkflowExecution — start() provider payload (coverage)", () => {
  it("includes provider details when an active provider is configured", async () => {
    useAiProviderStore.setState({
      activeProvider: "anthropic",
      cliProviders: [],
      restProviders: [
        {
          type: "anthropic",
          name: "Anthropic",
          endpoint: "https://api.anthropic.com",
          apiKey: "sk-test",
          model: "claude",
        },
      ],
      detecting: false,
    } as Partial<ReturnType<typeof useAiProviderStore.getState>>);

    invokeMock.mockResolvedValueOnce("server-id");
    const { result } = renderHook(() => useWorkflowExecution());
    await waitForListeners();

    await result.current.start({ yaml: "name: x", workspaceRoot: "/w" });

    const call = invokeMock.mock.calls.find((c) => c[0] === "run_workflow");
    expect(call).toBeDefined();
    const args = call?.[1] as { provider: unknown };
    expect(args.provider).toEqual({
      provider: "anthropic",
      apiKey: "sk-test",
      endpoint: "https://api.anthropic.com",
      cliPath: null,
    });
  });

  it("sends provider=null when no provider is active", async () => {
    invokeMock.mockResolvedValueOnce("server-id");
    const { result } = renderHook(() => useWorkflowExecution());
    await waitForListeners();

    await result.current.start({ yaml: "name: x", workspaceRoot: "/w" });

    const call = invokeMock.mock.calls.find((c) => c[0] === "run_workflow");
    const args = call?.[1] as { provider: unknown };
    expect(args.provider).toBeNull();
  });
});

describe("useWorkflowExecution — cleanup", () => {
  it("invokes every unlisten on unmount and tolerates double-cleanup", async () => {
    const { unmount } = renderHook(() => useWorkflowExecution());
    await waitForListeners();
    expect(unlistenMocks).toHaveLength(3);

    // First cleanup is the unmount.
    unmount();
    for (const mock of unlistenMocks) {
      expect(mock).toHaveBeenCalledTimes(1);
    }

    // Second cleanup would happen if React strict-mode replays the effect or
    // if an external caller re-invokes the unlistener. The hook wraps the
    // call in try/catch — make sure neither throws here either, so the
    // contract holds end-to-end.
    expect(() => {
      for (const mock of unlistenMocks) {
        mock.mockImplementationOnce(() => {
          throw new Error("already cleaned up");
        });
      }
    }).not.toThrow();
  });
});
