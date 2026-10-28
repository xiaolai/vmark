// WI-RA14C.5 — Tier-0 MCP `document.write` flow, from the wire to the disk.
//
// An AI client's write arrives as a raw `mcp-bridge:request` event carrying
// `args_json`. This flow enters through that door — the real `useMcpBridge`
// listener, request dedup, the read-only guard, the v2 dispatcher, the
// `document.write` handler, the real stores and the real save pipeline — and
// asserts what a user would find afterwards: the BYTES on disk (the file's
// CRLF line endings and BOM kept), a clean document, and a revision the
// client can use for its next write. `@tauri-apps/*` is the only faked
// boundary: the stateful in-memory disk, and an event bus that hands the
// listener to the test.
//
// The in-memory disk decodes `readTextFile` as the real plugin does (dropping
// a leading U+FEFF), so the BOM assertions below hold only because the open
// reads the file's bytes (services/files/readDocumentText). The real-file
// check is e2e/journeys/41-mcp-document-write.mjs.
//
// The handler-level suite (services/mcpBridge/v2/__tests__/mcpSavePipeline)
// keeps the per-handler branch coverage; this is the composition.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const bus = vi.hoisted(() => ({ listeners: new Map<string, Listener>() }));

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("@/services/mcpBridge/v2/__tests__/bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("@/services/mcpBridge/v2/__tests__/bridgeWriteGate")).gatedCoreModule(),
);
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
}));
// The bridge listens on its own window: Rust sends each request to one window.
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn((event: string, handler: Listener) => {
      bus.listeners.set(event, handler);
      return Promise.resolve(() => bus.listeners.delete(event));
    }),
  }),
}));

import { statefulFs } from "@/test/statefulFsFake";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useMcpBridge } from "@/hooks/useMcpBridge";
import {
  resetBridge,
  responseTo,
  structuredErrorOf,
} from "@/services/mcpBridge/v2/__tests__/bridgeDiskHarness";
import { ROOT, doc, editDoc, openDocInTab } from "./harness";
import envelopeFixture from "@/test/fixtures/mcpRequestEnvelope.json";

/** The attribution Rust attaches to every request (provider-state envelope). */
const attribution = envelopeFixture.envelopes.provider.attribution;

const DOC = `${ROOT}/notes.md`;
const BOM = "\u{FEFF}";
/** A CRLF file with a BOM and CJK text, as a Windows editor would leave it. */
const ON_DISK_BEFORE = `${BOM}# 标题\r\n\r\n正文\r\n`;
/** What an MCP client sends: LF-only, BOM-free. */
const CLIENT_TEXT = "# 标题\n\n正文\n新增一行\n";
const ON_DISK_AFTER = `${BOM}# 标题\r\n\r\n正文\r\n新增一行\r\n`;

interface WriteData {
  revision: string;
  saved: boolean;
  save_skipped?: string;
  save_error?: string;
}

let seq = 0;

/** Deliver one request exactly as Rust emits it, and wait for its reply. */
async function request(type: string, args: Record<string, unknown>, id = `req-${++seq}`) {
  const deliver = bus.listeners.get("mcp-bridge:request");
  if (!deliver) throw new Error("the MCP bridge listener was never registered");
  deliver({ payload: { id, type, args_json: JSON.stringify(args), attribution } });
  return vi.waitFor(() => responseTo(id));
}

async function write(args: Record<string, unknown>, id?: string): Promise<WriteData> {
  const reply = await request("vmark.document.write", args, id);
  expect(reply.error).toBeUndefined();
  expect(reply.success).toBe(true);
  return reply.data as WriteData;
}

const revisionOf = (tabId: string) => useRevisionStore.getState().getRevision(tabId);

beforeEach(async () => {
  bus.listeners.clear();
  resetBridge();
  // The bridge's liveness ping and its checkpoint history are not what this flow is about.
  statefulFs.stubCommand("mcp_bridge_heartbeat", () => undefined);
  renderHook(() => useMcpBridge());
  await vi.waitFor(() => expect(bus.listeners.has("mcp-bridge:request")).toBe(true));
});

afterEach(() => {
  cleanup();
});

describe("Tier-0 MCP document.write, from the wire to the disk", () => {
  it("keeps the file's CRLF and BOM on disk, leaves the document clean, and returns its revision", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK_BEFORE);

    const data = await write({ tabId, content: CLIENT_TEXT });

    expect(statefulFs.read(DOC)).toBe(ON_DISK_AFTER);
    expect(data.saved).toBe(true);
    expect(doc(tabId).content).toBe(CLIENT_TEXT);
    expect(doc(tabId).isDirty).toBe(false);
    expect(data.revision).toBe(revisionOf(tabId));
  });

  it("the returned revision is accepted by the next write, and the one before it is refused as stale", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK_BEFORE);
    const first = await write({ tabId, content: CLIENT_TEXT });

    const second = await write({
      tabId,
      content: `${CLIENT_TEXT}再一行\n`,
      expected_revision: first.revision,
    });
    expect(second.saved).toBe(true);
    expect(second.revision).not.toBe(first.revision);
    expect(statefulFs.read(DOC)).toBe(`${ON_DISK_AFTER}再一行\r\n`);

    const stale = await request("vmark.document.write", {
      tabId,
      content: "overwrite from a stale snapshot\n",
      expected_revision: first.revision,
    });
    expect(stale.success).toBe(false);
    expect(structuredErrorOf(stale)).toMatchObject({ error: "STALE", current_revision: second.revision });
    expect(statefulFs.read(DOC)).toBe(`${ON_DISK_AFTER}再一行\r\n`);
    expect(doc(tabId).content).toBe(`${CLIENT_TEXT}再一行\n`);
  });

  it("save:false changes the document only: the disk is untouched and the tab is dirty", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK_BEFORE);

    const data = await write({ tabId, content: CLIENT_TEXT, save: false });

    expect(data.saved).toBe(false);
    expect(statefulFs.read(DOC)).toBe(ON_DISK_BEFORE);
    expect(doc(tabId).content).toBe(CLIENT_TEXT);
    expect(doc(tabId).isDirty).toBe(true);
    expect(data.revision).toBe(revisionOf(tabId));
  });

  it("a redelivered request (same id) is executed once and answered from the first run", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK_BEFORE);
    await write({ tabId, content: CLIENT_TEXT }, "req-redelivered");
    const writesAfterFirst = statefulFs.writesTo(DOC).length;
    // The human keeps typing; a replay of the old request must not undo it.
    editDoc(tabId, `${CLIENT_TEXT}typed after the write\n`);

    const deliver = bus.listeners.get("mcp-bridge:request");
    deliver?.({
      payload: {
        id: "req-redelivered",
        type: "vmark.document.write",
        args_json: JSON.stringify({ tabId, content: CLIENT_TEXT }),
        attribution,
      },
    });
    await vi.waitFor(() => expect(() => responseTo("req-redelivered")).toThrow(/got 2/));

    expect(statefulFs.writesTo(DOC)).toHaveLength(writesAfterFirst);
    expect(doc(tabId).content).toBe(`${CLIENT_TEXT}typed after the write\n`);
  });

  it("a read-only document refuses the write before anything changes", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK_BEFORE);
    const before = doc(tabId).content;
    useDocumentStore.getState().setReadOnly(tabId, true);

    const reply = await request("vmark.document.write", { tabId, content: CLIENT_TEXT });

    expect(reply.success).toBe(false);
    expect(structuredErrorOf(reply)?.error).toBe("READ_ONLY");
    expect(statefulFs.read(DOC)).toBe(ON_DISK_BEFORE);
    expect(doc(tabId).content).toBe(before);
  });

  it("args that are not JSON are answered with an error and write nothing", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK_BEFORE);
    const deliver = bus.listeners.get("mcp-bridge:request");

    deliver?.({
      payload: { id: "req-bad-json", type: "vmark.document.write", args_json: "{not json", attribution },
    });
    const reply = await vi.waitFor(() => responseTo("req-bad-json"));

    expect(reply.success).toBe(false);
    expect(reply.error).toBe("Invalid JSON in request args");
    expect(statefulFs.read(DOC)).toBe(ON_DISK_BEFORE);
    expect(doc(tabId).isDirty).toBe(false);
  });

  it("an empty document is a real write: the file keeps only its BOM", async () => {
    const tabId = await openDocInTab(DOC, ON_DISK_BEFORE);

    const data = await write({ tabId, content: "" });

    expect(data.saved).toBe(true);
    expect(statefulFs.read(DOC)).toBe(BOM);
    expect(doc(tabId).isDirty).toBe(false);
  });
});
