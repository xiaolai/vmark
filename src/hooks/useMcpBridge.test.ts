// Behavior coverage for the MCP bridge entry hook. Specifically:
//   - listener registration on mount, teardown on unmount (unlisten + heartbeat)
//   - the listener is scoped to this webview window, never the global
//     target-Any listen that hears requests routed to other windows
//   - Strict Mode guard: unmount before listen() resolves still cleans up
//   - a refused registration is retried with bounded backoff; after the last
//     attempt the failure is logged and the heartbeat stops claiming liveness
//   - heartbeat cadence (5s) and swallowed heartbeat failures
//   - event dispatch: args_json / argsJson / missing-args parsing into handleRequest
//   - malformed payloads dropped loudly, never dispatched, never responded to
//   - invalid args JSON answered with a success:false response, not dispatched
//   - duplicate deliveries: in-flight duplicates dropped, completed duplicates
//     get the cached response re-sent (real requestDedup + real respond —
//     assertions land on the outbound `mcp_bridge_respond` invoke payload)
//   - handler rejections contained (logged, no unhandled rejection)
//   - attribution: forwarded validated and frozen; a missing or malformed one
//     is refused with success:false and never dispatched under a default

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type BridgeHandler = (event: { payload: unknown }) => void;

const {
  mockListen,
  mockGlobalListen,
  mockInvoke,
  mockHandleRequest,
  mockBridgeLog,
  mockBridgeError,
  handlerBox,
} = vi.hoisted(() => {
  const handlerBox: { current: ((event: { payload: unknown }) => void) | null } = {
    current: null,
  };
  return {
    mockListen: vi.fn(),
    mockGlobalListen: vi.fn((..._args: unknown[]) => Promise.resolve(() => {})),
    mockInvoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
    mockHandleRequest: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
    mockBridgeLog: vi.fn(),
    mockBridgeError: vi.fn(),
    handlerBox,
  };
});

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "doc-0",
    listen: (...args: unknown[]) => mockListen(...args),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockGlobalListen(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@/services/mcpBridge/handleRequest", () => ({
  handleRequest: (...args: unknown[]) => mockHandleRequest(...args),
}));

vi.mock("@/utils/debug", () => ({
  mcpBridgeLog: (...args: unknown[]) => mockBridgeLog(...args),
  mcpBridgeError: (...args: unknown[]) => mockBridgeError(...args),
}));

import { LISTEN_ATTEMPTS, LISTEN_RETRY_MS, useMcpBridge } from "./useMcpBridge";
import { respond } from "@/services/mcpBridge/utils";
import { resetRequestDedup } from "@/services/mcpBridge/requestDedup";
import envelopeFixture from "@/test/fixtures/mcpRequestEnvelope.json";

/** A valid attribution, as Rust generates it (the provider-state envelope). */
const ATTRIBUTION = envelopeFixture.envelopes.provider.attribution;

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

/** Deliver an event to the captured `mcp-bridge:request` handler, exactly as given. */
function deliverRaw(payload: unknown): void {
  const handler = handlerBox.current;
  if (!handler) throw new Error("No mcp-bridge:request handler captured");
  handler({ payload });
}

/**
 * Deliver an event; an object payload without an `attribution` key gets the
 * Rust-generated one, because the real bridge never emits a request without it.
 */
function deliver(payload: unknown): void {
  const needsAttribution =
    typeof payload === "object" && payload !== null && !("attribution" in payload);
  deliverRaw(needsAttribution ? { ...payload, attribution: ATTRIBUTION } : payload);
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
  mockListen.mockImplementation((_event: unknown, handler: unknown) => {
    handlerBox.current = handler as BridgeHandler;
    return Promise.resolve(defaultUnlisten);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMcpBridge — registration and teardown", () => {
  it("registers a single mcp-bridge:request listener on mount", async () => {
    await mountBridge();

    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith("mcp-bridge:request", expect.any(Function));
    // A global listen matches every emit target, so this window would also
    // run requests Rust routed to another window.
    expect(mockGlobalListen).not.toHaveBeenCalled();
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

describe("useMcpBridge — listener registration retry", () => {
  const refuse = () => Promise.reject(new Error("no ipc"));
  const accept = (_event: unknown, handler: unknown) => {
    handlerBox.current = handler as BridgeHandler;
    return Promise.resolve(defaultUnlisten);
  };

  it("retries a refused registration and serves requests once it registers", async () => {
    vi.useFakeTimers();
    mockListen.mockImplementationOnce(refuse).mockImplementationOnce(refuse).mockImplementation(accept);
    renderHook(() => useMcpBridge());
    await vi.advanceTimersByTimeAsync(0);
    expect(handlerBox.current).toBeNull();
    await vi.advanceTimersByTimeAsync(LISTEN_RETRY_MS);
    expect(mockListen).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LISTEN_RETRY_MS); // backed off: twice as long
    expect(mockListen).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LISTEN_RETRY_MS);
    expect(mockListen).toHaveBeenCalledTimes(3);
    deliver({ id: "req-late", type: "vmark.document.read", args_json: "{}" });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockHandleRequest).toHaveBeenCalledTimes(1);
  });

  it("gives up after a bounded number of attempts, says so, and stops claiming the webview is alive", async () => {
    vi.useFakeTimers();
    mockListen.mockImplementation(refuse);
    renderHook(() => useMcpBridge());
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mockListen).toHaveBeenCalledTimes(LISTEN_ATTEMPTS);
    expect(mockBridgeError).toHaveBeenCalledWith(
      expect.stringMatching(/cannot serve requests/i),
      expect.any(Error),
    );
    const beats = mockInvoke.mock.calls.filter(([cmd]) => cmd === "mcp_bridge_heartbeat").length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === "mcp_bridge_heartbeat").length).toBe(beats);
  });

  it("an unmount during the backoff makes no further attempt", async () => {
    vi.useFakeTimers();
    mockListen.mockImplementation(refuse);
    const { unmount } = renderHook(() => useMcpBridge());
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mockListen).toHaveBeenCalledTimes(1);
  });

  it("a registration that lands after unmount is released at once", async () => {
    vi.useFakeTimers();
    let land: (fn: () => void) => void = () => undefined;
    mockListen.mockImplementationOnce(refuse).mockImplementationOnce(() => new Promise((r) => (land = r)));
    const { unmount } = renderHook(() => useMcpBridge());
    await vi.advanceTimersByTimeAsync(LISTEN_RETRY_MS);
    expect(mockListen).toHaveBeenCalledTimes(2);
    unmount();
    const late = vi.fn();
    land(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late).toHaveBeenCalledTimes(1);
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
      attribution: ATTRIBUTION,
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
      attribution: ATTRIBUTION,
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
      attribution: ATTRIBUTION,
    });
  });

  it("drops malformed payloads loudly — no dispatch, no response", async () => {
    await mountBridge();

    deliverRaw(null);
    deliverRaw("not an object");
    deliverRaw({ id: "no-type" });
    deliverRaw({ id: 42, type: "vmark.document.read" });
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

  it("forwards the attribution frozen, as its own copy", async () => {
    await mountBridge();

    deliver({ id: "req-attr", type: "vmark.document.read", args_json: "{}" });
    await flushMicrotasks();

    const forwarded = (mockHandleRequest.mock.calls[0] as unknown[])[0] as {
      attribution: unknown;
    };
    expect(forwarded.attribution).toEqual(ATTRIBUTION);
    expect(forwarded.attribution).not.toBe(ATTRIBUTION);
    expect(Object.isFrozen(forwarded.attribution)).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["a collapsed 'unknown' principal", { ...ATTRIBUTION, principal: { kind: "unknown" } }],
    ["keyed by the client counter", { ...ATTRIBUTION, connectionId: "7" }],
  ])("refuses a request whose attribution is %s — never dispatched under a default", async (_l, attribution) => {
    await mountBridge();

    deliverRaw({ id: "req-no-attr", type: "vmark.document.write", args_json: "{}", attribution });
    await flushMicrotasks();

    expect(mockHandleRequest).not.toHaveBeenCalled();
    expect(respondPayloads()).toEqual([
      { id: "req-no-attr", success: false, error: "Invalid request attribution" },
    ]);
    expect(mockBridgeError).toHaveBeenCalledWith(
      "Refusing MCP request with invalid attribution:",
      "req-no-attr",
    );
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
