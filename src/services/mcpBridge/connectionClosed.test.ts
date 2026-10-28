// @vitest-environment node
// WI-AL1.5 — when the bridge says a connection closed, its read set is
// dropped (no leak), and only its: the other client's reads survive. The
// payload crosses IPC, so a malformed one is refused, never trusted, and never
// drops anybody's reads. A stopped bridge drops every connection's reads.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readInputsOf } from "@/test/mcpReadInputs";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null), // coherence_head: unpinned reads still count
}));

type Capture = typeof import("@/services/coherence/mcpCapture");
type Closed = typeof import("./connectionClosed");
let capture: Capture;
let handleMcpBridgeStopped: Closed["handleMcpBridgeStopped"];
let handleMcpConnectionClosed: Closed["handleMcpConnectionClosed"];

const CLIENT_A = "00000000-0000-4000-8000-000000a10000";
const CLIENT_B = "00000000-0000-4000-8000-000000b10000";

function readCount(connectionId: string): number {
  return readInputsOf(capture.detachMcpReads(connectionId), "/ws").length;
}

// Fresh modules per test: a close is remembered (a closed id never reads
// again), so one test's close must not reach the next.
beforeEach(async () => {
  vi.resetModules();
  capture = await import("@/services/coherence/mcpCapture");
  ({ handleMcpBridgeStopped, handleMcpConnectionClosed } = await import("./connectionClosed"));
  const { useWorkspaceStore } = await import("@/stores/workspaceStore");
  useWorkspaceStore.setState({ rootPath: "/ws" });
  capture.recordMcpRead(CLIENT_A, "/ws/a.md");
  capture.recordMcpRead(CLIENT_B, "/ws/b.md");
});

describe("handleMcpConnectionClosed", () => {
  it("drops the closed connection's reads and keeps the other client's", () => {
    expect(handleMcpConnectionClosed({ connectionId: CLIENT_A })).toBe(true);
    expect(readCount(CLIENT_A)).toBe(0);
    expect(readCount(CLIENT_B)).toBe(1);
  });

  it("accepts a close for a connection that never read anything", () => {
    expect(handleMcpConnectionClosed({ connectionId: "00000000-0000-4000-8000-0000000c0000" })).toBe(true);
    expect(readCount(CLIENT_A)).toBe(1);
  });

  it.each([
    ["null", null],
    ["a string", CLIENT_A],
    ["an array", [CLIENT_A]],
    ["no connectionId", {}],
    ["a numeric id", { connectionId: 7 }],
    ["a non-UUID id", { connectionId: "client-1" }],
    ["an upper-case UUID", { connectionId: CLIENT_A.toUpperCase().replace(/^0/, "A") }],
    ["an inherited id", Object.create({ connectionId: CLIENT_A }) as unknown],
  ])("refuses %s and drops nothing", (_name, payload) => {
    expect(handleMcpConnectionClosed(payload)).toBe(false);
    expect(readCount(CLIENT_A)).toBe(1);
    expect(readCount(CLIENT_B)).toBe(1);
  });
});

describe("handleMcpBridgeStopped", () => {
  it("drops every connection's reads", () => {
    handleMcpBridgeStopped();
    expect(readCount(CLIENT_A)).toBe(0);
    expect(readCount(CLIENT_B)).toBe(0);
  });
});
