// @vitest-environment node
// WI-AL1.5 — MCP read tracking is partitioned by connection. Two clients each
// get their own read set: client B's write never consumes a read client A
// made (even of the same path, even when both are the same provider), each
// write is recorded under the actor that made it, a closed connection's reads
// are dropped, and the number of partitions stays bounded if a close is lost.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readInputsOf } from "@/test/mcpReadInputs";
import { FIXTURE_ATTRIBUTIONS, onConnection } from "@/test/mcpAttributionFixture";
import type { McpAttribution } from "@/services/mcpBridge/types";

const mockInvoke = vi.fn(async (cmd: string, _args: Record<string, unknown>) => {
  if (cmd === "coherence_head") return { object: "o", revision: `rev1:${"0".repeat(64)}` };
  return { object: "o", revision: "r", entry_id: "e", content_with_identity: null };
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => mockInvoke(cmd, args),
}));
vi.mock("@/utils/pendingSaves", () => ({
  registerPendingSave: () => 1,
  clearPendingSave: () => undefined,
}));

type Mod = typeof import("./mcpCapture");
let mod: Mod;
let agentOf: typeof import("./mcpActor").mcpCoherenceAgent;

/** The partition cap: twice the bridge's 32 concurrent connections. */
const MAX_READ_CONNECTIONS = 64;

const clientA = FIXTURE_ATTRIBUTIONS.provider;
const clientB = FIXTURE_ATTRIBUTIONS.anonymous;
/** The same provider as client A, on a second connection. */
const clientA2 = onConnection(clientA, "00000000-0000-4000-8000-0000000a2000");

function connection(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

beforeEach(async () => {
  vi.resetModules();
  mockInvoke.mockClear();
  mod = await import("./mcpCapture");
  agentOf = (await import("./mcpActor")).mcpCoherenceAgent;
  const { useWorkspaceStore } = await import("@/stores/workspaceStore");
  useWorkspaceStore.setState({ rootPath: "/ws" });
});

interface CaptureRequest {
  inputs: Array<{ path: string }>;
  agent: { type: string; id?: string };
}

function captureRequests(): CaptureRequest[] {
  return mockInvoke.mock.calls
    .filter((c) => c[0] === "coherence_capture")
    .map((c) => (c[1] as { request: CaptureRequest }).request);
}

async function write(actor: McpAttribution, path = "/ws/out.md"): Promise<CaptureRequest> {
  const before = captureRequests().length;
  await mod.captureMcpWrite({ absolutePath: path, content: "c", toolName: "document.write", actor });
  const requests = captureRequests();
  expect(requests).toHaveLength(before + 1);
  return requests[before];
}

const paths = (req: CaptureRequest) => req.inputs.map((i) => i.path).sort();

describe("two-client read isolation", () => {
  it("client B's write never consumes client A's reads", async () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    mod.recordMcpRead(clientB.connectionId, "/ws/b.md");

    expect(paths(await write(clientB))).toEqual(["b.md"]);
    expect(paths(await write(clientA))).toEqual(["a.md"]);
  });

  it("the same path read by two clients is an input of each client's write once", async () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/shared.md");
    mod.recordMcpRead(clientB.connectionId, "/ws/shared.md");

    expect(paths(await write(clientA))).toEqual(["shared.md"]);
    expect(paths(await write(clientA))).toEqual([]); // consumed by A's first write
    expect(paths(await write(clientB))).toEqual(["shared.md"]); // B's read untouched
  });

  it("a client that read nothing writes with no inputs while the other client's reads wait", async () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    expect(paths(await write(clientB))).toEqual([]);
    expect(readInputsOf(mod.detachMcpReads(clientA.connectionId), "/ws").map((i) => i.path)).toEqual(["a.md"]);
  });

  it("isolates two connections of the same provider", async () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    mod.recordMcpRead(clientA2.connectionId, "/ws/a2.md");

    const second = await write(clientA2);
    expect(paths(second)).toEqual(["a2.md"]);
    expect(second.agent).toEqual(agentOf(clientA2));
    const first = await write(clientA);
    expect(paths(first)).toEqual(["a.md"]);
    expect(first.agent).toEqual(agentOf(clientA));
    expect(first.agent.id).not.toBe(second.agent.id);
  });

  it("detaching consumes only the named connection's reads", () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    mod.recordMcpRead(clientB.connectionId, "/ws/b.md");
    expect(readInputsOf(mod.detachMcpReads(clientB.connectionId), "/ws").map((i) => i.path)).toEqual(["b.md"]);
    expect(readInputsOf(mod.detachMcpReads(clientB.connectionId), "/ws")).toEqual([]);
    expect(readInputsOf(mod.detachMcpReads(clientA.connectionId), "/ws").map((i) => i.path)).toEqual(["a.md"]);
  });

  it("concurrent writes by two clients each take their own reads", async () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    mod.recordMcpRead(clientB.connectionId, "/ws/b.md");
    await Promise.all([
      mod.captureMcpWrite({ absolutePath: "/ws/x.md", content: "x", toolName: "document.write", actor: clientA }),
      mod.captureMcpWrite({ absolutePath: "/ws/y.md", content: "y", toolName: "document.write", actor: clientB }),
    ]);
    const byActor = new Map(captureRequests().map((r) => [r.agent.id, paths(r)]));
    expect(byActor.get(agentOf(clientA).id)).toEqual(["a.md"]);
    expect(byActor.get(agentOf(clientB).id)).toEqual(["b.md"]);
  });
});

describe("the write is recorded under the actor that made it", () => {
  it.each(Object.keys(FIXTURE_ATTRIBUTIONS) as Array<keyof typeof FIXTURE_ATTRIBUTIONS>)(
    "principal state %s",
    async (state) => {
      const actor = FIXTURE_ATTRIBUTIONS[state];
      const req = await write(actor);
      expect(req.agent).toEqual(agentOf(actor));
      expect(req.agent.id).toContain(`principal=${state}`);
      expect(req.agent.id).toContain(`connection=${actor.connectionId}`);
      expect(req.agent.id).not.toContain("mcp-client");
    },
  );
});

describe("connection close", () => {
  it("drops the closed connection's reads and only those", async () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    mod.recordMcpRead(clientB.connectionId, "/ws/b.md");

    mod.dropMcpConnectionReads(clientA.connectionId);

    expect(paths(await write(clientA))).toEqual([]);
    expect(paths(await write(clientB))).toEqual(["b.md"]);
  });

  it("dropping an unknown or already-dropped connection is a no-op", () => {
    mod.recordMcpRead(clientB.connectionId, "/ws/b.md");
    mod.dropMcpConnectionReads(clientA.connectionId);
    mod.dropMcpConnectionReads(clientA.connectionId);
    expect(readInputsOf(mod.detachMcpReads(clientB.connectionId), "/ws")).toHaveLength(1);
  });

  it("a pin answering after the drop does not bring the reads back", async () => {
    let answer: (head: { object: string; revision: string }) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((resolve) => { answer = resolve; }) as never,
    );
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    mod.dropMcpConnectionReads(clientA.connectionId);
    answer({ object: "o", revision: `rev1:${"1".repeat(64)}` });
    await Promise.resolve();
    expect(readInputsOf(mod.detachMcpReads(clientA.connectionId), "/ws")).toEqual([]);
  });

  it("a batch given back after its connection closed does not recreate the partition", () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    const batch = mod.detachMcpReads(clientA.connectionId); // a save in flight
    mod.dropMcpConnectionReads(clientA.connectionId);
    mod.restoreMcpReads(batch); // that save failed
    expect(readInputsOf(mod.detachMcpReads(clientA.connectionId), "/ws")).toEqual([]);
  });

  it("a batch given back after the bridge stopped does not recreate the partition", () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    const batch = mod.detachMcpReads(clientA.connectionId);
    mod.dropAllMcpConnectionReads();
    mod.restoreMcpReads(batch);
    expect(readInputsOf(mod.detachMcpReads(clientA.connectionId), "/ws")).toEqual([]);
  });

  it("a read arriving after its connection closed is not recorded", () => {
    mod.dropMcpConnectionReads(clientA.connectionId);
    mod.recordMcpRead(clientA.connectionId, "/ws/late.md");
    expect(readInputsOf(mod.detachMcpReads(clientA.connectionId), "/ws")).toEqual([]);
  });

  it("a read whose request began before the bridge stopped is not recorded, nor its partition recreated", () => {
    const lifetime = mod.mcpRequestLifetime(clientA.connectionId); // the request arrives
    mod.dropAllMcpConnectionReads(); // the bridge stops before the handler records
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md", "a\n", undefined, lifetime);
    expect(mockInvoke.mock.calls.filter((c) => c[0] === "coherence_head")).toEqual([]);
    expect(mod.detachMcpReads(clientA.connectionId).reads).toEqual([]);
  });

  it("a read whose request began before its connection closed is not recorded", () => {
    const lifetime = mod.mcpRequestLifetime(clientA.connectionId);
    mod.dropMcpConnectionReads(clientA.connectionId);
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md", "a\n", undefined, lifetime);
    expect(mod.detachMcpReads(clientA.connectionId).reads).toEqual([]);
  });

  it("a batch given back while its connection is open is restored", () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    const batch = mod.detachMcpReads(clientA.connectionId);
    mod.dropMcpConnectionReads(clientB.connectionId); // another client's close
    mod.restoreMcpReads(batch);
    expect(readInputsOf(mod.detachMcpReads(clientA.connectionId), "/ws")).toHaveLength(1);
  });

  it("a batch given back after its connection closed stays refused however many closes follow", () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    const batch = mod.detachMcpReads(clientA.connectionId); // a save in flight
    mod.dropMcpConnectionReads(clientA.connectionId);
    // More closes than the tombstone list holds: A's own tombstone is evicted.
    for (let n = 1; n <= 1100; n += 1) mod.dropMcpConnectionReads(connection(n));
    mod.restoreMcpReads(batch); // that save failed
    expect(readInputsOf(mod.detachMcpReads(clientA.connectionId), "/ws")).toEqual([]);
  });

  it("a connection first seen after the bridge stopped reads and restores normally", () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    mod.dropAllMcpConnectionReads();
    mod.recordMcpRead(clientB.connectionId, "/ws/b.md");
    const batch = mod.detachMcpReads(clientB.connectionId);
    mod.restoreMcpReads(batch);
    expect(readInputsOf(mod.detachMcpReads(clientB.connectionId), "/ws")).toHaveLength(1);
  });

  it("dropAllMcpConnectionReads clears every connection (bridge stopped)", () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    mod.recordMcpRead(clientB.connectionId, "/ws/b.md");
    mod.dropAllMcpConnectionReads();
    expect(readInputsOf(mod.detachMcpReads(clientA.connectionId), "/ws")).toEqual([]);
    expect(readInputsOf(mod.detachMcpReads(clientB.connectionId), "/ws")).toEqual([]);
  });
});

describe("partitions stay bounded if a close is never heard", () => {
  it(`keeps at most ${MAX_READ_CONNECTIONS} connections, evicting the least recently reading`, () => {
    for (let n = 0; n <= MAX_READ_CONNECTIONS; n++) mod.recordMcpRead(connection(n), `/ws/doc${n}.md`);
    expect(readInputsOf(mod.detachMcpReads(connection(0)), "/ws")).toEqual([]); // evicted
    expect(readInputsOf(mod.detachMcpReads(connection(1)), "/ws")).toHaveLength(1);
    expect(readInputsOf(mod.detachMcpReads(connection(MAX_READ_CONNECTIONS)), "/ws")).toHaveLength(1);
  });

  it("a fresh read refreshes a connection so an idle one is evicted first", () => {
    for (let n = 0; n < MAX_READ_CONNECTIONS; n++) mod.recordMcpRead(connection(n), `/ws/doc${n}.md`);
    mod.recordMcpRead(connection(0), "/ws/again.md"); // connection 0 is now the newest
    mod.recordMcpRead(connection(MAX_READ_CONNECTIONS), "/ws/new.md"); // evicts connection 1
    expect(readInputsOf(mod.detachMcpReads(connection(1)), "/ws")).toEqual([]);
    expect(readInputsOf(mod.detachMcpReads(connection(0)), "/ws")).toHaveLength(2);
  });

  it("a write empties its partition, so it no longer counts against the cap", async () => {
    mod.recordMcpRead(clientA.connectionId, "/ws/a.md");
    await write(clientA);
    for (let n = 0; n < MAX_READ_CONNECTIONS; n++) mod.recordMcpRead(connection(n), `/ws/doc${n}.md`);
    // Had A's emptied partition been kept, connection 0 would have been evicted.
    expect(readInputsOf(mod.detachMcpReads(connection(0)), "/ws")).toHaveLength(1);
  });
});
