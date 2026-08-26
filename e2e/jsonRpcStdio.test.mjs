// The JSON-RPC framing under the VMark MCP harness.
//
// This code decides what a journey is TOLD when the sidecar misbehaves, and
// every one of its failure modes used to be silent: a malformed frame and a
// silent sidecar both produced a bare timeout, a crashed sidecar produced an
// EPIPE instead of the stderr that explained it, and a reply for an unknown id
// vanished. None of that needs a real process to reach — the channel wants an
// object with stdin/stdout/stderr, so it is driven directly here.

import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import { createStdioChannel } from "./lib/jsonRpcStdio.mjs";

/** A child process stand-in: three streams and an `exit` event. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.written = [];
  child.stdin = {
    write: (chunk) => child.written.push(chunk),
    end: vi.fn(),
  };
  child.kill = vi.fn();
  /** Deliver one protocol frame. */
  child.reply = (msg) => child.stdout.emit("data", `${JSON.stringify(msg)}\n`);
  /** Deliver a raw string on stdout, framing and all. */
  child.raw = (text) => child.stdout.emit("data", text);
  child.die = (code = 1) => child.emit("exit", code);
  return child;
}

/** The frames the channel wrote, parsed. */
function sent(child) {
  return child.written.map((line) => JSON.parse(line));
}

describe("json-rpc stdio channel", () => {
  it("matches a reply to its request by id", async () => {
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 1000 });

    const first = channel.send("a", {});
    const second = channel.send("b", {});
    const ids = sent(child).map((f) => f.id);
    expect(new Set(ids).size).toBe(2);

    // Answered out of order, on purpose: id matching is the only thing that
    // makes concurrent requests safe.
    child.reply({ id: ids[1], result: "second" });
    child.reply({ id: ids[0], result: "first" });

    expect((await first).result).toBe("first");
    expect((await second).result).toBe("second");
  });

  it("reassembles a frame split across chunks", async () => {
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 1000 });
    const pending = channel.send("a", {});
    const id = sent(child)[0].id;

    // TCP-style fragmentation: the newline is what delimits a frame, and it
    // can arrive in a later chunk than the object it terminates.
    const frame = JSON.stringify({ id, result: "ok" });
    child.raw(frame.slice(0, 5));
    child.raw(`${frame.slice(5)}\n`);

    expect((await pending).result).toBe("ok");
  });

  it("delivers two frames arriving in one chunk", async () => {
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 1000 });
    const first = channel.send("a", {});
    const second = channel.send("b", {});
    const ids = sent(child).map((f) => f.id);

    child.raw(
      `${JSON.stringify({ id: ids[0], result: 1 })}\n${JSON.stringify({ id: ids[1], result: 2 })}\n`,
    );

    expect((await first).result).toBe(1);
    expect((await second).result).toBe(2);
  });

  it("keeps unparseable stdout instead of discarding it", async () => {
    // A malformed protocol frame and ordinary log noise look identical here.
    // Both used to be dropped, so a framing bug surfaced as a bare timeout
    // with nothing to go on.
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 50 });
    const pending = channel.send("a", {});
    child.raw("{not json\n");

    await expect(pending).rejects.toThrow(/unmatched stdout[\s\S]*not json/);
    expect(channel.noise()).toContain("{not json");
  });

  it("keeps a reply whose id nobody is waiting for", async () => {
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 1000 });
    child.reply({ id: 999, result: "stray" });
    expect(channel.noise().join("")).toContain("stray");
  });

  it("rejects in-flight requests when the sidecar dies, with its stderr", async () => {
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 5000 });
    const pending = channel.send("a", {});
    child.stderr.emit("data", "Error: bridge refused\n");
    child.die(3);

    await expect(pending).rejects.toThrow(/code 3[\s\S]*bridge refused/);
  });

  it("refuses to send to a dead sidecar rather than writing to a broken pipe", async () => {
    // `write()` on a dead process's stdin raises EPIPE asynchronously, which
    // loses both the exit code and the stderr that explain why it died.
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 5000 });
    child.stderr.emit("data", "fatal: no port file\n");
    child.die(2);
    await new Promise((r) => setImmediate(r));

    const before = child.written.length;
    await expect(channel.send("a", {})).rejects.toThrow(/not running[\s\S]*no port file/);
    expect(child.written.length, "nothing was written to the dead pipe").toBe(before);
  });

  it("drops notifications to a dead sidecar silently", async () => {
    // A notification has no reply to reject, and nobody is waiting on it.
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 5000 });
    child.die(0);
    await new Promise((r) => setImmediate(r));

    expect(() => channel.notify("notifications/initialized", {})).not.toThrow();
    expect(child.written).toHaveLength(0);
  });

  it("names the method and the stderr on a timeout", async () => {
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 30 });
    child.stderr.emit("data", "connecting...\n");
    await expect(channel.send("tools/call", {})).rejects.toThrow(
      /tools\/call timed out after 30ms[\s\S]*connecting/,
    );
  });

  it("stops waiting on a timed-out request", async () => {
    // The entry must be removed, or a later reply for that id resolves a
    // promise that has already rejected.
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 30 });
    const pending = channel.send("a", {});
    await expect(pending).rejects.toThrow(/timed out/);

    const id = sent(child)[0].id;
    child.reply({ id, result: "late" });
    expect(channel.noise().join("")).toContain("late");
  });

  it("kills a sidecar that will not exit on its own", async () => {
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 1000 });
    const closing = channel.close({ killAfterMs: 10 });
    await new Promise((r) => setTimeout(r, 40));
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.die(137);
    await closing;
  });

  it("does not kill a sidecar that exits promptly", async () => {
    const child = fakeChild();
    const channel = createStdioChannel(child, { timeoutMs: 1000 });
    const closing = channel.close({ killAfterMs: 5000 });
    child.die(0);
    await closing;
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();
  });
});
