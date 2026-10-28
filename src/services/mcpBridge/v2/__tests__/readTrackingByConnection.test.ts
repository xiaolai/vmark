// WI-AL1.5 — read tracking is partitioned by connection end to end: a
// document.read made by client A is an input of client A's next save and
// never of client B's (the two-client case), and every MCP save is captured
// under the actor of the request that made it — not a shared "mcp-client".
//
// Only the Tauri boundary is mocked: the handlers, the save pipeline and the
// capture chain are real, and "captured" is read at the kernel boundary.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("./bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./bridgeWriteGate")).gatedCoreModule(),
);

import { ROOT, editDoc, openDocInTab, settle } from "@/test/tier0/harness";
import { FIXTURE_ATTRIBUTIONS, contextFor, onConnection } from "@/test/mcpAttributionFixture";
import { handleDocumentRead, handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { handleWorkspaceSave } from "@/services/mcpBridge/v2/workspaceSave";
import { handleWorkspaceSaveAs } from "@/services/mcpBridge/v2/workspaceSaveAs";
import { detachMcpReads, dropAllMcpConnectionReads } from "@/services/coherence/mcpCapture";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { mcpCoherenceAgent } from "@/services/coherence/mcpActor";
import { statefulFs } from "@/test/statefulFsFake";
import { captures, resetBridge, responseTo } from "./bridgeDiskHarness";

const CHAPTER = `${ROOT}/story/ch1.md`;
const NOTES = `${ROOT}/story/notes.md`;

const clientA = FIXTURE_ATTRIBUTIONS.provider;
const clientB = FIXTURE_ATTRIBUTIONS.anonymous;

function inputPaths(n: number): string[] {
  const request = captures[n].request as unknown as { inputs: Array<{ path: string }> };
  return request.inputs.map((i) => i.path);
}

beforeEach(() => {
  resetBridge();
  // A read is an input only once its revision is pinned (mcpCapture.test.ts).
  statefulFs.stubCommand("coherence_head", () => ({ object: "o", revision: `rev1:${"0".repeat(64)}` }));
  dropAllMcpConnectionReads();
});

describe("document.read is tracked per connection", () => {
  it("client A's read is an input of A's save and never of client B's", async () => {
    const notes = await openDocInTab(NOTES, "notes\n");
    const chapter = await openDocInTab(CHAPTER, "v1\n");

    await handleDocumentRead("r-a", { tabId: notes }, contextFor(clientA, "vmark.document.read"));
    expect(responseTo("r-a").success).toBe(true);

    editDoc(chapter, "by B\n");
    await handleWorkspaceSave("s-b", { tabId: chapter }, contextFor(clientB, "vmark.workspace.save"));
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0].request.agent).toEqual(mcpCoherenceAgent(clientB));
    expect(inputPaths(0)).toEqual([]);

    editDoc(chapter, "by A\n");
    await handleWorkspaceSave("s-a", { tabId: chapter }, contextFor(clientA, "vmark.workspace.save"));
    await vi.waitFor(() => expect(captures).toHaveLength(2));
    expect(captures[1].request.agent).toEqual(mcpCoherenceAgent(clientA));
    expect(inputPaths(1)).toEqual(["story/notes.md"]);
  });

  it("isolates two connections of the same provider", async () => {
    const clientA2 = onConnection(clientA, "00000000-0000-4000-8000-0000000a2000");
    const notes = await openDocInTab(NOTES, "notes\n");
    const chapter = await openDocInTab(CHAPTER, "v1\n");

    await handleDocumentRead("r-a", { tabId: notes }, contextFor(clientA, "vmark.document.read"));
    await handleDocumentWrite("w-a2", { tabId: chapter, content: "by A2\n" }, contextFor(clientA2));
    expect(responseTo("w-a2").success).toBe(true);
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0].request.agent).toEqual(mcpCoherenceAgent(clientA2));
    expect(inputPaths(0)).toEqual([]);
  });
});

describe("every MCP save is captured under its own actor", () => {
  it.each(Object.keys(FIXTURE_ATTRIBUTIONS) as Array<keyof typeof FIXTURE_ATTRIBUTIONS>)(
    "document.write by principal state %s",
    async (state) => {
      const actor = FIXTURE_ATTRIBUTIONS[state];
      const chapter = await openDocInTab(CHAPTER, "v1\n");
      await handleDocumentWrite("w", { tabId: chapter, content: `by ${state}\n` }, contextFor(actor));
      await vi.waitFor(() => expect(captures).toHaveLength(1));
      expect(captures[0].request.agent).toEqual(mcpCoherenceAgent(actor));
      expect(captures[0].request.agent.id).toContain(`principal=${state}`);
    },
  );

  it("workspace.save_as by client B", async () => {
    const chapter = await openDocInTab(CHAPTER, "v1\n");
    editDoc(chapter, "moved\n");
    await handleWorkspaceSaveAs(
      "as-b",
      { tabId: chapter, filePath: `${ROOT}/story/ch1-copy.md` },
      contextFor(clientB, "vmark.workspace.save_as"),
    );
    expect(responseTo("as-b").success).toBe(true);
    await settle();
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0].request.agent).toEqual(mcpCoherenceAgent(clientB));
  });
});

describe("a read is recorded as it was served, not after the response went out", () => {
  /** Run `during` while the read's response is being sent; collect every pin request. */
  function duringResponse(during: () => void): Array<Record<string, unknown>> {
    const pins: Array<Record<string, unknown>> = [];
    statefulFs.stubCommand("coherence_head", (args) => {
      pins.push(args);
      return { object: "o", revision: `rev1:${"0".repeat(64)}` };
    });
    statefulFs.stubCommand("mcp_bridge_respond", during);
    return pins;
  }

  it("pins under the workspace root the read was served from, though the workspace switched meanwhile", async () => {
    const notes = await openDocInTab(NOTES, "notes\n");
    const pins = duringResponse(() => useWorkspaceStore.setState({ rootPath: "/elsewhere" }));

    await handleDocumentRead("r-a", { tabId: notes }, contextFor(clientA, "vmark.document.read"));

    expect(pins).toEqual([
      { workspaceRoot: ROOT, path: "story/notes.md", content: "notes\n", baseContent: undefined },
    ]);
  });

  it("pins a dirty read against the saved base it was served from, though a save landed meanwhile", async () => {
    const notes = await openDocInTab(NOTES, "notes\n");
    editDoc(notes, "notes, edited\n");
    const pins = duringResponse(() => {
      const docs = useDocumentStore.getState().documents;
      const doc = docs[notes];
      useDocumentStore.setState({
        documents: { ...docs, [notes]: { ...doc, savedContent: doc.content, isDirty: false } },
      });
    });

    await handleDocumentRead("r-a", { tabId: notes }, contextFor(clientA, "vmark.document.read"));

    expect(pins).toEqual([
      { workspaceRoot: ROOT, path: "story/notes.md", content: "notes, edited\n", baseContent: "notes\n" },
    ]);
  });

  it("a read whose response was in flight when the bridge stopped holds no reads afterwards", async () => {
    const notes = await openDocInTab(NOTES, "notes\n");
    duringResponse(() => dropAllMcpConnectionReads());

    await handleDocumentRead("r-a", { tabId: notes }, contextFor(clientA, "vmark.document.read"));

    expect(detachMcpReads(clientA.connectionId).reads).toEqual([]);
  });
});

// A microtask queued before the handler is called runs after the handler's
// synchronous start (which snapshots the tab) and before any continuation of
// an await inside it: the window in which a save, a root switch or a bridge
// stop can land between the snapshot and the read's record.
describe("a read is recorded atomically with the snapshot it serves", () => {
  function pinRequests(): Array<Record<string, unknown>> {
    const pins: Array<Record<string, unknown>> = [];
    statefulFs.stubCommand("coherence_head", (args) => {
      pins.push(args);
      return { object: "o", revision: `rev1:${"0".repeat(64)}` };
    });
    return pins;
  }

  it("a workspace switch right after the snapshot does not change the root the read is pinned under", async () => {
    const notes = await openDocInTab(NOTES, "notes\n");
    const pins = pinRequests();

    queueMicrotask(() => useWorkspaceStore.setState({ rootPath: "/elsewhere" }));
    await handleDocumentRead("r-a", { tabId: notes }, contextFor(clientA, "vmark.document.read"));

    expect(pins).toEqual([
      { workspaceRoot: ROOT, path: "story/notes.md", content: "notes\n", baseContent: undefined },
    ]);
  });

  it("a save right after the snapshot does not change the saved base the read is pinned against", async () => {
    const notes = await openDocInTab(NOTES, "notes\n");
    editDoc(notes, "notes, edited\n");
    const pins = pinRequests();

    queueMicrotask(() => {
      const docs = useDocumentStore.getState().documents;
      const doc = docs[notes];
      useDocumentStore.setState({
        documents: { ...docs, [notes]: { ...doc, savedContent: doc.content, isDirty: false } },
      });
    });
    await handleDocumentRead("r-a", { tabId: notes }, contextFor(clientA, "vmark.document.read"));

    expect(pins).toEqual([
      { workspaceRoot: ROOT, path: "story/notes.md", content: "notes, edited\n", baseContent: "notes\n" },
    ]);
  });

  it("a bridge stop right after the handler starts leaves no read and recreates no partition", async () => {
    const notes = await openDocInTab(NOTES, "notes\n");

    queueMicrotask(() => dropAllMcpConnectionReads());
    await handleDocumentRead("r-a", { tabId: notes }, contextFor(clientA, "vmark.document.read"));

    expect(responseTo("r-a").success).toBe(true);
    expect(detachMcpReads(clientA.connectionId).reads).toEqual([]);
  });
});
