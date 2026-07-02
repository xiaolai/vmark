// Behavior coverage for the MCP bridge entry hook. Specifically:
//   - listener registration on mount, teardown on unmount (unlisten + heartbeat)
//   - Strict Mode guard: unmount before listen() resolves still cleans up
//   - heartbeat cadence (5s) and swallowed heartbeat failures
//   - event dispatch: args_json / argsJson / missing-args parsing into handleRequest
//   - malformed payloads dropped loudly, never dispatched, never responded to
//   - invalid args JSON answered with a success:false response, not dispatched
//   - duplicate deliveries: in-flight duplicates dropped, completed duplicates
//     get the cached response re-sent (real requestDedup + real respond —
//     assertions land on the outbound `mcp_bridge_respond` invoke payload)
//   - handler rejections contained (logged, no unhandled rejection)

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type BridgeHandler = (event: { payload: unknown }) => void;

const {
  mockListen,
  mockInvoke,
  mockHandleRequest,
  mockHydrateCheckpoints,
  mockBridgeLog,
  mockBridgeError,
  handlerBox,
} = vi.hoisted(() => {
  const handlerBox: { current: ((event: { payload: unknown }) => void) | null } = {
    current: null,
  };
  return {
    mockListen: vi.fn(),
    mockInvoke: vi.fn(async () => undefined),
    mockHandleRequest: vi.fn(async () => undefined),
    mockHydrateCheckpoints: vi.fn(async () => undefined),
    mockBridgeLog: vi.fn(),
    mockBridgeError: vi.fn(),
    handlerBox,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("./handleRequest", () => ({
  handleRequest: (...args: unknown[]) => mockHandleRequest(...args),
}));

vi.mock("@/stores/mcpCheckpointPersistence", () => ({
  hydrateCheckpoints: (...args: unknown[]) => mockHydrateCheckpoints(...args),
}));

vi.mock("@/utils/debug", () => ({
  mcpBridgeLog: (...args: unknown[]) => mockBridgeLog(...args),
  mcpBridgeError: (...args: unknown[]) => mockBridgeError(...args),
}));

import { useMcpBridge } from "./useMcpBridge";
import { respond } from "./utils";
import { resetRequestDedup } from "./requestDedup";

const defaultUnlisten = vi.fn();

/** Flush pending microtasks so the async listen().then chain settles. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Mount the hook and wait for the listener registration to settle. */
async function mountBridge() {
  const utils = renderHook(() => useMcpBridge());
  await flushMicrotasks();
  return utils;
}

/** Deliver an event to the captured `mcp-bridge:request` handler. */
function deliver(payload: unknown): void {
  const handler = handlerBox.current;
  if (!handler) throw new Error("No mcp-bridge:request handler captured");
  handler({ payload });
}

/** All outbound `mcp_bridge_respond` payloads, in call order. */
function respondPayloads(): unknown[] {
  return mockInvoke.mock.calls
    .filter(([cmd]) => cmd === "mcp_bridge_respond")
    .map(([, args]) => (args as { payload: unknown }).payload);
}

/**
 * Make the next respond() call reject: respond()'s "Sending response:" log
 * runs before its internal try/catch, so a throwing logger surfaces as a
 * rejected respond() promise — the only real rejection path it has.
 */
function failRespondLogging(): void {
  mockBridgeLog.mockImplementation((...args: unknown[]) => {
    if (args[0] === "Sending response:") throw new Error("log boom");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks does NOT clear implementations — drop the throwing logger
  // installed by failRespondLogging() so it can't leak across tests.
  mockBridgeLog.mockReset();
  resetRequestDedup();
  handlerBox.current = null;
  mockInvoke.mockResolvedValue(undefined);
  mockHandleRequest.mockResolvedValue(undefined);
  mockHydrateCheckpoints.mockResolvedValue(undefined);
  mockListen.mockImplementation((_event: unknown, handler: unknown) => {
    handlerBox.current = handler as BridgeHandler;
    return Promise.resolve(defaultUnlisten);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMcpBridge — registration and teardown", () => {
  it("registers a single mcp-bridge:request listener and hydrates checkpoints on mount", async () => {
    await mountBridge();

    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith("mcp-bridge:request", expect.any(Function));
    expect(mockHydrateCheckpoints).toHaveBeenCalledTimes(1);
  });

  it("calls unlisten on unmount", async () => {
    const { unmount } = await mountBridge();

    expect(defaultUnlisten).not.toHaveBeenCalled();
    unmount();
    expect(defaultUnlisten).toHaveBeenCalledTimes(1);
  });

  it("cleans up the listener even when unmounted before listen() resolves (Strict Mode guard)", async () => {
    let resolveListen!: (fn: () => void) => void;
    mockListen.mockImplementation(
      () => new Promise<() => void>((resolve) => { resolveListen = resolve; }),
    );
    const lateUnlisten = vi.fn();

    const { unmount } = renderHook(() => useMcpBridge());
    unmount(); // registration promise still pending

    resolveListen(lateUnlisten);
    await flushMicrotasks();

    // The late-arriving unlisten fn must be invoked immediately — no leak.
    expect(lateUnlisten).toHaveBeenCalledTimes(1);
  });

  it("logs and survives listener registration failure", async () => {
    mockListen.mockImplementation(() => Promise.reject(new Error("no ipc")));

    const { unmount } = await mountBridge();

    expect(mockBridgeError).toHaveBeenCalledWith(
      "Failed to register event listener:",
      expect.any(Error),
    );
    expect(() => unmount()).not.toThrow(); // unlisten stayed undefined
  });
});

describe("useMcpBridge — heartbeat", () => {
  it("sends mcp_bridge_heartbeat every 5 seconds", async () => {
    vi.useFakeTimers();
    renderHook(() => useMcpBridge());

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("mcp_bridge_heartbeat");

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("keeps beating after a heartbeat failure (errors are swallowed)", async () => {
    vi.useFakeTimers();
    mockInvoke.mockRejectedValue(new Error("bridge down"));
    renderHook(() => useMcpBridge());

    // Two failing ticks: no unhandled rejection, interval keeps firing.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("stops the heartbeat on unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useMcpBridge());

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mockInvoke).toHaveBeenCalledTimes(1); // no beats after teardown
  });
});

describe("useMcpBridge — request dispatch", () => {
  it("parses args_json and forwards the parsed request to handleRequest", async () => {
    await mountBridge();

    deliver({
      id: "req-1",
      type: "vmark.document.read",
      args_json: '{"path":"a.md","limit":2}',
    });
    await flushMicrotasks();

    expect(mockHandleRequest).toHaveBeenCalledTimes(1);
    expect(mockHandleRequest).toHaveBeenCalledWith({
      id: "req-1",
      type: "vmark.document.read",
      args: { path: "a.md", limit: 2 },
    });
  });

  it("falls back to camelCase argsJson when args_json is absent (Tauri IPC quirk)", async () => {
    await mountBridge();

    deliver({ id: "req-2", type: "vmark.selection.get", argsJson: '{"mode":"apply"}' });
    await flushMicrotasks();

    expect(mockHandleRequest).toHaveBeenCalledWith({
      id: "req-2",
      type: "vmark.selection.get",
      args: { mode: "apply" },
    });
  });

  it("prefers snake_case args_json over camelCase argsJson when both are present", async () => {
    await mountBridge();

    deliver({
      id: "req-3",
      type: "vmark.workspace.list",
      args_json: '{"from":"snake"}',
      argsJson: '{"from":"camel"}',
    });
    await flushMicrotasks();

    expect(mockHandleRequest).toHaveBeenCalledWith(
      expect.objectContaining({ args: { from: "snake" } }),
    );
  });

  it("defaults to empty args when neither args field is present", async () => {
    await mountBridge();

    deliver({ id: "req-4", type: "vmark.session.get_state" });
    await flushMicrotasks();

    expect(mockHandleRequest).toHaveBeenCalledWith({
      id: "req-4",
      type: "vmark.session.get_state",
      args: {},
    });
  });

  it("drops malformed payloads loudly — no dispatch, no response", async () => {
    await mountBridge();

    deliver(null);
    deliver("not an object");
    deliver({ id: "no-type" });
    deliver({ id: 42, type: "vmark.document.read" });
    await flushMicrotasks();

    expect(mockHandleRequest).not.toHaveBeenCalled();
    expect(respondPayloads()).toEqual([]); // an undefined id can't be replied to
    expect(mockBridgeError).toHaveBeenCalledTimes(4);
    expect(mockBridgeError).toHaveBeenCalledWith(
      "Dropping malformed MCP request payload:",
      null,
    );
  });

  it("answers invalid args JSON with success:false and skips the handler", async () => {
    await mountBridge();

    deliver({ id: "req-bad-json", type: "vmark.document.write", args_json: "{not json" });
    await flushMicrotasks();

    expect(mockHandleRequest).not.toHaveBeenCalled();
    expect(respondPayloads()).toEqual([
      { id: "req-bad-json", success: false, error: "Invalid JSON in request args" },
    ]);
  });

  it("contains a failing respond() on the invalid-JSON path (fire-and-forget, logged)", async () => {
    await mountBridge();
    // respond() rejects only when something ahead of its internal try/catch
    // throws — its "Sending response:" log call is that spot. The contract
    // under test: the rejection is caught and logged, never unhandled.
    failRespondLogging();

    deliver({ id: "req-bad-json-2", type: "vmark.document.write", args_json: "{oops" });
    await flushMicrotasks();

    expect(mockBridgeError).toHaveBeenCalledWith(
      "Failed to respond to malformed request:",
      expect.any(Error),
    );
  });

  it("contains handler rejections — logged, no unhandled rejection", async () => {
    await mountBridge();
    mockHandleRequest.mockRejectedValueOnce(new Error("handler boom"));

    deliver({ id: "req-err", type: "vmark.document.read", args_json: "{}" });
    await flushMicrotasks();

    expect(mockBridgeError).toHaveBeenCalledWith(
      "Unhandled error in request handler:",
      expect.any(Error),
    );
  });
});

describe("useMcpBridge — duplicate deliveries (wake-and-retry)", () => {
  it("executes only the first delivery of an in-flight request id", async () => {
    await mountBridge();
    // Handler never responds within the test → the id stays in-flight.
    mockHandleRequest.mockImplementation(() => new Promise(() => {}));

    deliver({ id: "req-dup", type: "vmark.document.write", args_json: "{}" });
    deliver({ id: "req-dup", type: "vmark.document.write", args_json: "{}" });
    await flushMicrotasks();

    expect(mockHandleRequest).toHaveBeenCalledTimes(1);
    expect(respondPayloads()).toEqual([]); // duplicate dropped silently, no extra reply
  });

  it("re-sends the cached response for a duplicate of a completed request", async () => {
    await mountBridge();
    // Real respond() records the response in the real dedup window.
    mockHandleRequest.mockImplementation(async (event) => {
      const { id } = event as { id: string };
      await respond({ id, success: true, data: "first-result" });
    });

    deliver({ id: "req-done", type: "vmark.document.read", args_json: "{}" });
    await flushMicrotasks();
    expect(respondPayloads()).toHaveLength(1);

    // Retry delivery of the SAME id after completion: must NOT re-execute,
    // must re-send the identical cached response.
    deliver({ id: "req-done", type: "vmark.document.read", args_json: "{}" });
    await flushMicrotasks();

    expect(mockHandleRequest).toHaveBeenCalledTimes(1);
    expect(respondPayloads()).toEqual([
      { id: "req-done", success: true, data: "first-result" },
      { id: "req-done", success: true, data: "first-result" },
    ]);
  });

  it("contains a failing cached-response re-send (fire-and-forget, logged)", async () => {
    await mountBridge();
    mockHandleRequest.mockImplementation(async (event) => {
      const { id } = event as { id: string };
      await respond({ id, success: true, data: "cached" });
    });

    deliver({ id: "req-resend-fail", type: "vmark.document.read", args_json: "{}" });
    await flushMicrotasks();

    // Now the duplicate's re-send respond() rejects: must be caught + logged.
    failRespondLogging();
    deliver({ id: "req-resend-fail", type: "vmark.document.read", args_json: "{}" });
    await flushMicrotasks();

    expect(mockHandleRequest).toHaveBeenCalledTimes(1); // still no re-execution
    expect(mockBridgeError).toHaveBeenCalledWith(
      "Failed to re-send cached response:",
      expect.any(Error),
    );
  });

  it("treats distinct request ids independently", async () => {
    await mountBridge();

    deliver({ id: "req-a", type: "vmark.document.read", args_json: "{}" });
    deliver({ id: "req-b", type: "vmark.document.read", args_json: "{}" });
    await flushMicrotasks();

    expect(mockHandleRequest).toHaveBeenCalledTimes(2);
  });
});
