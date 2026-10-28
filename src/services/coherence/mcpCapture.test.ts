// @vitest-environment node
// WI-1.6 — MCP session-read tracking under concurrency: every read pins the
// revision it was served (coherence_head), and a write consumes exactly the
// reads that preceded it. Pins are deferred here so completion order, timeouts,
// overlapping writes, capacity and workspace switches are all driven
// explicitly — the funnel tests resolve coherence_head immediately and so
// cannot see any of these.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readInputsOf } from "@/test/mcpReadInputs";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";

/** Every read here is one client's; partitioning is pinned in mcpCapture.connections.test.ts. */
const CONN = TEST_ATTRIBUTION.connectionId;

type Head = { object: string; revision: string | null } | null;
interface Deferred {
  path: string;
  root: string;
  resolve: (head: Head) => void;
  reject: (error: unknown) => void;
}

const heads: Deferred[] = [];
const mockInvoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
  if (cmd === "coherence_head") {
    return new Promise<Head>((resolve, reject) => {
      heads.push({ path: args.path as string, root: args.workspaceRoot as string, resolve, reject });
    });
  }
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
let setRoot: (root: string | null) => void;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  mockInvoke.mockClear();
  heads.length = 0;
  mod = await import("./mcpCapture");
  const { useWorkspaceStore } = await import("@/stores/workspaceStore");
  setRoot = (rootPath) => useWorkspaceStore.setState({ rootPath });
  setRoot("/ws");
});

afterEach(() => {
  vi.useRealTimers();
});

/** How long a pin may hold its in-flight slot (mirrors mcpReads.ts). */
const PIN_TIMEOUT_MS = 10_000;

const rev = (n: number) => `rev1:${String(n).padStart(64, "0")}`;

function headCalls(): number {
  return mockInvoke.mock.calls.filter((c) => c[0] === "coherence_head").length;
}

function captureInputs(nth = 0): Array<{ path: string; revision?: string }> {
  const calls = mockInvoke.mock.calls.filter((c) => c[0] === "coherence_capture");
  const req = (calls[nth]?.[1] as { request: { inputs: [] } } | undefined)?.request;
  return req?.inputs ?? [];
}

function write(path = "/ws/out.md") {
  return mod.captureMcpWrite({ absolutePath: path, content: "c", toolName: "document.write", actor: TEST_ATTRIBUTION });
}

describe("read-time revision pins", () => {
  it("sends the served content so the kernel pins the revision that was read (#133)", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md", "served v1\n");
    const call = mockInvoke.mock.calls.find((c) => c[0] === "coherence_head");
    expect(call?.[1]).toEqual({ workspaceRoot: "/ws", path: "a.md", content: "served v1\n" });
  });

  it("a re-read's pin carries the NEWER served content", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md", "v1");
    mod.recordMcpRead(CONN, "/ws/a.md", "v2"); // coalesces behind the in-flight pin
    heads[0].resolve({ object: "A", revision: rev(1) });
    await vi.waitFor(() => expect(headCalls()).toBe(2));
    const second = mockInvoke.mock.calls.filter((c) => c[0] === "coherence_head")[1];
    expect((second[1] as { content?: string }).content).toBe("v2");
  });

  it("a resolved pin becomes the input's revision", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md");
    heads[0].resolve({ object: "A", revision: rev(1) });
    await write();
    expect(captureInputs()).toEqual([{ path: "a.md", revision: rev(1), role: "direct" }]);
  });

  it("an older pin completing late never overwrites a newer read of the same path", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md"); // read #1
    mod.recordMcpRead(CONN, "/ws/a.md"); // read #2 supersedes it
    // Worst order: the newest pin in flight answers first, every older one after.
    const inFlight = [...heads];
    inFlight[inFlight.length - 1].resolve({ object: "A", revision: rev(2) });
    await vi.advanceTimersByTimeAsync(0);
    for (const h of inFlight.slice(0, -1).reverse()) h.resolve({ object: "A", revision: rev(1) });
    await vi.advanceTimersByTimeAsync(0);
    // Any pin issued since (a re-pin for the newest read) sees the new head.
    for (const h of heads.slice(inFlight.length)) h.resolve({ object: "A", revision: rev(2) });
    await write();
    expect(captureInputs()[0].revision).toBe(rev(2));
  });

  it("a pin that resolves after its write timed out cannot touch a later read", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md");
    const first = write();
    await vi.advanceTimersByTimeAsync(500); // bounded wait expires
    await first;
    // Unpinned, the kernel would resolve it to the head at write time — a
    // revision the client may never have seen — so the read is left out.
    expect(captureInputs(0)).toEqual([]);

    mod.recordMcpRead(CONN, "/ws/a.md"); // a fresh read of the same path
    expect(heads).toHaveLength(2);
    heads[1].resolve({ object: "A", revision: rev(9) }); // the fresh pin
    await vi.advanceTimersByTimeAsync(0);
    heads[0].resolve({ object: "A", revision: rev(1) }); // the old pin, late
    await vi.advanceTimersByTimeAsync(0);
    await write();
    expect(captureInputs(1)[0].revision).toBe(rev(9));
  });
});

describe("a read without a pinned revision is never an input", () => {
  it("a rejected pin leaves the read out", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md");
    mod.recordMcpRead(CONN, "/ws/b.md");
    heads[0].reject(new Error("kernel unavailable"));
    heads[1].resolve({ object: "B", revision: rev(2) });
    await write();
    expect(captureInputs()).toEqual([{ path: "b.md", revision: rev(2), role: "direct" }]);
  });

  it("a null answer (object unknown to the kernel) leaves the read out", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md");
    mod.recordMcpRead(CONN, "/ws/b.md");
    heads[0].resolve(null);
    heads[1].resolve({ object: "B", revision: rev(2) });
    await write();
    expect(captureInputs()).toEqual([{ path: "b.md", revision: rev(2), role: "direct" }]);
  });

  it("a read whose pin cap stays saturated through its write is left out", async () => {
    for (let i = 0; i < 256; i++) mod.recordMcpRead("conn-other", `/ws/other${i}.md`, `o${i}`);
    mod.recordMcpRead(CONN, "/ws/a.md", "served"); // over the cap: no pin
    const w = write(); // asks again, still refused: the other pins never answer
    await vi.advanceTimersByTimeAsync(600);
    await w;
    expect(heads.some((h) => h.path === "a.md")).toBe(false);
    expect(captureInputs()).toEqual([]);
  });

  it("a superseded generation's answer never pins the newer read", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md", "v1");
    mod.recordMcpRead(CONN, "/ws/a.md", "v2"); // coalesces: one pin, for v1
    heads[0].resolve({ object: "A", revision: rev(1) }); // v1's answer: stale
    await vi.advanceTimersByTimeAsync(0);
    expect(heads).toHaveLength(2); // the re-pin for v2, never answered
    const w = write();
    await vi.advanceTimersByTimeAsync(500);
    await w;
    expect(captureInputs()).toEqual([]);
  });
});

describe("overlapping reads and writes", () => {
  it("a write consumes only the reads that preceded it", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md");
    const w1 = write("/ws/out1.md"); // awaiting a.md's pin
    mod.recordMcpRead(CONN, "/ws/b.md"); // arrives while w1 waits
    heads[0].resolve({ object: "A", revision: rev(1) });
    await w1;
    expect(captureInputs(0)).toEqual([{ path: "a.md", revision: rev(1), role: "direct" }]);

    heads[1].resolve({ object: "B", revision: rev(2) });
    await write("/ws/out2.md");
    expect(captureInputs(1)).toEqual([{ path: "b.md", revision: rev(2), role: "direct" }]);
  });

  it("two concurrent writes never share a read", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md");
    const w1 = write("/ws/out1.md");
    const w2 = write("/ws/out2.md");
    heads[0].resolve({ object: "A", revision: rev(1) });
    await Promise.all([w1, w2]);
    const all = [...captureInputs(0), ...captureInputs(1)].map((i) => i.path);
    expect(all).toEqual(["a.md"]);
  });
});

describe("bounds", () => {
  it("repeated reads of one path keep at most one pin in flight", async () => {
    for (let i = 0; i < 1000; i++) mod.recordMcpRead(CONN, "/ws/a.md");
    expect(headCalls()).toBe(1);
  });

  it("pins in flight are capped across distinct paths", async () => {
    for (let i = 0; i < 1000; i++) mod.recordMcpRead(CONN, `/ws/doc${i}.md`);
    expect(headCalls()).toBeLessThanOrEqual(256);
  });

  it("a read left unpinned by a saturated pin cap is pinned by its write once capacity frees", async () => {
    // Another client fills every pin slot.
    for (let i = 0; i < 256; i++) mod.recordMcpRead("conn-other", `/ws/other${i}.md`, `o${i}`);
    mod.recordMcpRead(CONN, "/ws/a.md", "served"); // over the cap: no pin yet
    expect(headCalls()).toBe(256);
    for (const h of heads) h.resolve({ object: "O", revision: rev(0) });
    await vi.advanceTimersByTimeAsync(0);
    const w = write();
    await vi.advanceTimersByTimeAsync(0);
    const pin = heads.find((h) => h.path === "a.md");
    expect(pin).toBeDefined();
    pin?.resolve({ object: "A", revision: rev(7) });
    await w;
    expect(captureInputs()).toEqual([{ path: "a.md", revision: rev(7), role: "direct" }]);
  });

  it("256 pins that never settle do not starve later reads forever", async () => {
    for (let i = 0; i < 256; i++) mod.recordMcpRead("conn-hung", `/ws/hung${i}.md`, `h${i}`);
    expect(headCalls()).toBe(256);
    await vi.advanceTimersByTimeAsync(PIN_TIMEOUT_MS);
    mod.recordMcpRead(CONN, "/ws/a.md", "served");
    expect(headCalls()).toBe(257);
    heads.find((h) => h.path === "a.md")?.resolve({ object: "A", revision: rev(3) });
    await vi.advanceTimersByTimeAsync(0);
    await write();
    expect(captureInputs()).toEqual([{ path: "a.md", revision: rev(3), role: "direct" }]);
  });

  it("a timed-out pin's late answer is ignored and frees no second slot", async () => {
    mod.recordMcpRead(CONN, "/ws/late.md", "x");
    await vi.advanceTimersByTimeAsync(PIN_TIMEOUT_MS);
    heads[0]?.resolve({ object: "L", revision: rev(1) }); // after its slot was released
    await vi.advanceTimersByTimeAsync(0);
    // The timed-out read keeps no pinned revision, so no write takes it as an input.
    expect(readInputsOf(mod.detachMcpReads(CONN), "/ws")).toEqual([{ path: "late.md", revision: undefined }]);
    // Exactly 256 slots remain: the late answer did not release one twice.
    for (let i = 0; i < 300; i++) mod.recordMcpRead("conn-fill", `/ws/fill${i}.md`);
    expect(headCalls()).toBe(1 + 256);
  });

  it("keeps the 256 most recent reads, a re-read counting as recent", async () => {
    mod.recordMcpRead(CONN, "/ws/keep.md");
    for (let i = 0; i < 255; i++) mod.recordMcpRead(CONN, `/ws/doc${i}.md`);
    mod.recordMcpRead(CONN, "/ws/keep.md"); // refresh: now the newest
    mod.recordMcpRead(CONN, "/ws/doc-extra.md"); // evicts the oldest, doc0
    const paths = readInputsOf(mod.detachMcpReads(CONN), "/ws").map((i) => i.path);
    expect(paths).toHaveLength(256);
    expect(paths).toContain("keep.md");
    expect(paths).not.toContain("doc0.md");
  });
});

describe("workspace switches", () => {
  it("reads served under another workspace root never reach this one's capture", async () => {
    mod.recordMcpRead(CONN, "/ws/sub/a.md"); // pinned against the /ws kernel
    heads[0].resolve({ object: "A", revision: rev(1) });
    await vi.advanceTimersByTimeAsync(0);
    setRoot("/ws/sub"); // nested root: the path is still "inside"
    await write("/ws/sub/out.md");
    expect(captureInputs()).toEqual([]);
  });
});

describe("unmatched content is never pinned to a revision the client did not see (#133)", () => {
  it("a dirty read sends its saved base so the kernel can pin the revision it descends from", async () => {
    const { useDocumentStore } = await import("@/stores/documentStore");
    useDocumentStore.getState().initDocument("t1", "dirty edit", "/ws/a.md", {
      savedContent: "saved base",
    });
    mod.recordMcpRead(CONN, "/ws/a.md", "dirty edit", "t1");
    const call = mockInvoke.mock.calls.find((c) => c[0] === "coherence_head");
    expect(call?.[1]).toMatchObject({ content: "dirty edit", baseContent: "saved base" });
  });

  it("a clean read sends no separate base", async () => {
    const { useDocumentStore } = await import("@/stores/documentStore");
    useDocumentStore.getState().initDocument("t2", "same", "/ws/b.md", { savedContent: "same" });
    mod.recordMcpRead(CONN, "/ws/b.md", "same", "t2");
    const call = mockInvoke.mock.calls.find((c) => c[0] === "coherence_head");
    expect((call?.[1] as { baseContent?: string }).baseContent).toBeUndefined();
  });

  it("a known object with no provable revision is left out of the write's inputs", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md", "unsaved");
    mod.recordMcpRead(CONN, "/ws/b.md", "saved");
    heads[0].resolve({ object: "A", revision: null }); // known, unprovable
    heads[1].resolve({ object: "B", revision: rev(2) });
    await write();
    expect(captureInputs()).toEqual([{ path: "b.md", revision: rev(2), role: "direct" }]);
  });
});

describe("capture order follows write order (#135)", () => {
  function capturedPaths(): string[] {
    return mockInvoke.mock.calls
      .filter((c) => c[0] === "coherence_capture")
      .map((c) => (c[1] as { request: { path: string } }).request.path);
  }

  it("a later write with nothing to wait for never overtakes an earlier one waiting on pins", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md");
    const first = write("/ws/first.md"); // waits on a.md's pin
    const second = write("/ws/second.md"); // no reads: nothing to wait for
    await vi.advanceTimersByTimeAsync(10);
    expect(capturedPaths()).toEqual([]); // the second write did not jump the queue
    heads[0].resolve({ object: "A", revision: rev(1) });
    await Promise.all([first, second]);
    expect(capturedPaths()).toEqual(["first.md", "second.md"]);
  });

  it("an in-app save issued after an MCP write is captured after it", async () => {
    const { captureWrite } = await import("./captureFunnel");
    mod.recordMcpRead(CONN, "/ws/a.md");
    const mcp = write("/ws/doc.md");
    const human = captureWrite({
      absolutePath: "/ws/doc.md",
      content: "human",
      agent: { type: "human" },
      intent: { kind: "editor-save", summary: "save" },
    });
    await vi.advanceTimersByTimeAsync(10);
    heads[0].resolve({ object: "A", revision: rev(1) });
    await Promise.all([mcp, human]);
    expect(capturedPaths()).toEqual(["doc.md", "doc.md"]);
    const contents = mockInvoke.mock.calls
      .filter((c) => c[0] === "coherence_capture")
      .map((c) => (c[1] as { request: { content: string } }).request.content);
    expect(contents).toEqual(["c", "human"]);
  });

  it("a write whose pins time out still keeps its place", async () => {
    mod.recordMcpRead(CONN, "/ws/a.md"); // never resolves
    const first = write("/ws/first.md");
    const second = write("/ws/second.md");
    await vi.advanceTimersByTimeAsync(600);
    await Promise.all([first, second]);
    expect(capturedPaths()).toEqual(["first.md", "second.md"]);
  });
});
