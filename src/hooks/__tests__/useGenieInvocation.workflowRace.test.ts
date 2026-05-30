// WI-0.3 — genie workflow execution-id race (C2)
//
// Proves race *closure*, not just call order: step-update / complete events
// that arrive BEFORE the run_workflow invoke promise resolves must be
// attributed to the execution (not dropped, not wiped), and the workflow must
// not get stuck in a fake "running" state.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { GenieDefinition } from "@/types/aiGenies";

// listen() captured by event name so we can drive the real workflow listeners.
const listeners = new Map<string, (e: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
    listeners.set(name, cb);
    return Promise.resolve(() => listeners.delete(name));
  }),
}));

// run_workflow stays pending until we resolve it, so events can race ahead.
let resolveRun: ((id: string) => void) | null = null;
const mockInvoke = vi.fn((cmd: string) => {
  if (cmd === "run_workflow") {
    return new Promise<string>((res) => {
      resolveRun = res;
    });
  }
  return Promise.resolve();
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...(args as [string])),
}));

vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("@/utils/debug", () => ({ genieWarn: vi.fn() }));

import { useGenieInvocation } from "../useGenieInvocation";
import { useWorkflowExecution } from "../useWorkflowExecution";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useAiProviderStore } from "@/stores/aiStore";
import { useUIStore } from "@/stores/uiStore";

function workflowGenie(): GenieDefinition {
  return {
    kind: "workflow",
    template: "name: test\non: manual\njobs: {}\n",
    metadata: { name: "WF", scope: "document" },
  } as unknown as GenieDefinition;
}

describe("useGenieInvocation — workflow execution-id race (WI-0.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    resolveRun = null;
    useWorkflowStore.getState().setExecution(null);
    useWorkspaceStore.setState({ rootPath: "/ws" } as never);
    useUIStore.setState({ sourceMode: false } as never);
    useAiProviderStore.setState({
      activeProvider: "openai",
      restProviders: [
        { type: "openai", name: "OpenAI", apiKey: "sk", model: "gpt-4", endpoint: null } as never,
      ],
      cliProviders: [],
      ensureProvider: vi.fn(async () => true),
    } as never);
  });

  it("attributes early step/complete events and never gets stuck running", async () => {
    // Mount the real workflow event listeners.
    renderHook(() => useWorkflowExecution());
    const { result } = renderHook(() => useGenieInvocation());

    let invocation!: Promise<void>;
    await act(async () => {
      invocation = result.current.invokeGenie(workflowGenie());
      // Flush the async chain (ensureProvider + dynamic imports) until
      // run_workflow has been invoked — but it stays pending.
      for (
        let i = 0;
        i < 30 && !mockInvoke.mock.calls.some((c) => c[0] === "run_workflow");
        i++
      ) {
        await Promise.resolve();
      }
    });

    // The execution id is registered BEFORE invoke resolves.
    const id = useWorkflowStore.getState().preview.executionId;
    expect(id).not.toBeNull();

    // ...and it is the same id passed to run_workflow.
    const runCall = mockInvoke.mock.calls.find((c) => c[0] === "run_workflow");
    expect((runCall?.[1] as { executionId?: string })?.executionId).toBe(id);

    // A step-update arrives while invoke is still pending, via the real
    // listener. With the id already registered it is attributed (not dropped).
    act(() => {
      listeners.get("workflow:step-update")?.({
        payload: { executionId: id, stepId: "s1", status: "success" },
      });
    });
    expect(useWorkflowStore.getState().preview.stepStatuses.s1).toBeDefined();

    // A complete event (also pre-invoke-resolution) drives a terminal state.
    act(() => {
      listeners.get("workflow:complete")?.({
        payload: { executionId: id, status: "completed" },
      });
    });
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();

    // Now the invoke resolves — it must NOT resurrect a fake "running" state.
    await act(async () => {
      resolveRun?.(id as string);
      await invocation;
    });
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
  });
});
