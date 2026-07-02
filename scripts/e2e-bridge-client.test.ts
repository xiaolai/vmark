// Tests for the E2E automation-bridge WebSocket client (e2e/lib/bridge.mjs):
// request/response correlation, timeouts, late/unsolicited/malformed replies,
// and connection-close behavior — the pure protocol logic every E2E harness
// run depends on, exercised against a fake WebSocket (no live app needed).
//
// Placement: this file lives under scripts/ (not next to the source) because
// vitest.config.ts only includes src/** and scripts/** test globs — e2e/ is
// intentionally outside the unit-test tree (it drives a live app).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import { BridgeClient, expectSuccess, evalJs } from "../e2e/lib/bridge.mjs";

type Listener = (ev: unknown) => void;

/** Minimal fake of the browser/Node WebSocket API surface bridge.mjs uses. */
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  url: string;
  sent: string[] = [];
  closed = false;
  #listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.last = this;
  }

  addEventListener(type: string, fn: Listener) {
    const arr = this.#listeners.get(type) ?? [];
    arr.push(fn);
    this.#listeners.set(type, arr);
  }

  emit(type: string, ev: unknown = {}) {
    for (const fn of this.#listeners.get(type) ?? []) fn(ev);
  }

  send(payload: string) {
    if (this.closed) throw new Error("socket already closed");
    this.sent.push(payload);
  }

  close() {
    this.closed = true;
    this.emit("close", {});
  }
}

/** Connect a client against the fake socket (fires "open" immediately). */
async function connectedClient(idPrefix = "t") {
  const client = new BridgeClient({ idPrefix });
  const p = client.connect({ host: "127.0.0.1", port: 9323, timeoutMs: 5000 });
  const ws = FakeWebSocket.last as FakeWebSocket;
  ws.emit("open");
  await p;
  return { client, ws };
}

function sentRequest(ws: FakeWebSocket, index = 0) {
  return JSON.parse(ws.sent[index]) as { id: string; command: string; args: unknown };
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeWebSocket.last = null;
});

describe("BridgeClient.connect", () => {
  it("resolves on open and serializes requests in wire format", async () => {
    const { ws } = await connectedClient();
    expect(ws.url).toBe("ws://127.0.0.1:9323");
  });

  it("rejects when the socket does not open within timeoutMs", async () => {
    const client = new BridgeClient();
    const p = client.connect({ host: "127.0.0.1", port: 9323, timeoutMs: 100 });
    const rejection = expect(p).rejects.toThrow(/Timed out connecting.*after 100ms/);
    await vi.advanceTimersByTimeAsync(150);
    await rejection;
    expect((FakeWebSocket.last as FakeWebSocket).closed).toBe(true);
  });

  it("rejects on a socket error event", async () => {
    const client = new BridgeClient();
    const p = client.connect({ host: "127.0.0.1", port: 9323, timeoutMs: 5000 });
    const ws = FakeWebSocket.last as FakeWebSocket;
    const rejection = expect(p).rejects.toThrow(/WebSocket error connecting.*boom/);
    ws.emit("error", { message: "boom" });
    await rejection;
  });

  it("rejects when the WebSocket constructor throws", async () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          throw new Error("no socket for you");
        }
      }
    );
    const client = new BridgeClient();
    await expect(
      client.connect({ host: "127.0.0.1", port: 9323, timeoutMs: 100 })
    ).rejects.toThrow(/Failed to construct WebSocket/);
  });
});

describe("BridgeClient.send — request/response correlation", () => {
  it("resolves each request with the reply carrying ITS id, regardless of order", async () => {
    const { client, ws } = await connectedClient("t");
    const pA = client.send("list_windows", {}, 1000);
    const pB = client.send("execute_js", { script: "1" }, 1000);
    expect(sentRequest(ws, 0)).toEqual({ id: "t-1", command: "list_windows", args: {} });
    expect(sentRequest(ws, 1)).toEqual({
      id: "t-2",
      command: "execute_js",
      args: { script: "1" },
    });

    // Reply out of order: B first, then A.
    ws.emit("message", { data: JSON.stringify({ id: "t-2", success: true, data: "B" }) });
    ws.emit("message", { data: JSON.stringify({ id: "t-1", success: true, data: "A" }) });
    await expect(pB).resolves.toMatchObject({ id: "t-2", data: "B" });
    await expect(pA).resolves.toMatchObject({ id: "t-1", data: "A" });
  });

  it("ignores unsolicited replies (unknown id) and non-JSON broadcast noise", async () => {
    const { client, ws } = await connectedClient("t");
    const p = client.send("list_windows", {}, 1000);
    ws.emit("message", { data: "this is not json {" });
    ws.emit("message", { data: JSON.stringify({ id: "someone-else", success: true }) });
    ws.emit("message", { data: JSON.stringify({ success: true }) }); // no id at all
    ws.emit("message", { data: JSON.stringify({ id: "t-1", success: true, data: 42 }) });
    await expect(p).resolves.toMatchObject({ id: "t-1", data: 42 });
  });

  it("rejects on timeout and ignores a LATE reply for the timed-out id", async () => {
    const { client, ws } = await connectedClient("t");
    const p = client.send("execute_js", { script: "1" }, 500);
    const rejection = expect(p).rejects.toThrow(/"execute_js" timed out after 500ms/);
    await vi.advanceTimersByTimeAsync(600);
    await rejection;
    // The late reply must be dropped, not crash or resolve anything.
    ws.emit("message", { data: JSON.stringify({ id: "t-1", success: true, data: "late" }) });
  });

  it("rejects all in-flight requests when the connection closes", async () => {
    const { client, ws } = await connectedClient("t");
    const pA = client.send("list_windows", {}, 1000);
    const pB = client.send("execute_js", { script: "1" }, 1000);
    const rejections = Promise.all([
      expect(pA).rejects.toThrow(/connection closed mid-request/),
      expect(pB).rejects.toThrow(/connection closed mid-request/),
    ]);
    ws.emit("close", {});
    await rejections;
  });

  it("rejects immediately when the underlying send throws", async () => {
    const { client, ws } = await connectedClient("t");
    ws.closed = true; // makes FakeWebSocket.send throw
    await expect(client.send("list_windows", {}, 1000)).rejects.toThrow(
      /Failed to send "list_windows"/
    );
  });

  it("close() is safe before connect and after close", async () => {
    const fresh = new BridgeClient();
    expect(() => fresh.close()).not.toThrow();
    const { client } = await connectedClient();
    client.close();
    expect(() => client.close()).not.toThrow();
  });
});

describe("expectSuccess", () => {
  it("returns .data for a successful reply", () => {
    expect(expectSuccess({ success: true, data: [1, 2] }, "cmd")).toEqual([1, 2]);
  });

  it("throws with the bridge error for failures and malformed replies", () => {
    expect(() => expectSuccess({ success: false, error: "denied" }, "cmd")).toThrow(
      /cmd — bridge returned failure: denied/
    );
    expect(() => expectSuccess(undefined, "cmd")).toThrow(/bridge returned failure/);
  });
});

describe("evalJs", () => {
  it("sends execute_js and returns the evaluated data", async () => {
    const { client, ws } = await connectedClient("t");
    const p = evalJs(client, "1 + 1", 1000);
    const req = sentRequest(ws, 0);
    expect(req.command).toBe("execute_js");
    expect(req.args).toEqual({ script: "1 + 1" });
    ws.emit("message", { data: JSON.stringify({ id: req.id, success: true, data: 2 }) });
    await expect(p).resolves.toBe(2);
  });

  it("throws with the bridge error when execution fails", async () => {
    const { client, ws } = await connectedClient("t");
    const p = evalJs(client, "boom()", 1000);
    const rejection = expect(p).rejects.toThrow(/execute_js failed: ReferenceError/);
    const req = sentRequest(ws, 0);
    ws.emit("message", {
      data: JSON.stringify({ id: req.id, success: false, error: "ReferenceError: boom" }),
    });
    await rejection;
  });
});
