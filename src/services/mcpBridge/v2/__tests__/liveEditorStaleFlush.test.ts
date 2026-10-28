// @vitest-environment node
// A bridge read or write of a tab whose live editor cannot hand its pending
// keystrokes to the store is REFUSED: the store trails the editor, so a read
// would report stale text and a write would replace typing it never saw. A
// failing flusher of ANOTHER tab does not block the target tab; a read of
// every tab (session state) is refused when any editor failed.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { registerWysiwygFlusher } from "@/utils/wysiwygFlush";
import { respond } from "@/services/mcpBridge/utils";
import { handleDocumentRead, handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { flushLiveEditors } from "@/services/mcpBridge/v2/liveEditor";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const TAB = "w1";
const OTHER = "w2";

function seed(): void {
  const tab = (id: string) => ({ kind: "document" as const, id, filePath: `/notes/${id}.md`, title: id, isPinned: false, formatId: "markdown" });
  useTabStore.setState({ tabs: { main: [tab(TAB), tab(OTHER)] }, activeTabId: { main: TAB }, untitledCounter: 0 });
  useDocumentStore.getState().initDocument(TAB, "stored\n", `/notes/${TAB}.md`);
  useDocumentStore.getState().initDocument(OTHER, "other\n", `/notes/${OTHER}.md`);
}

const crash = () => {
  throw new Error("serializer crashed");
};

function reply(requestId: string) {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  return call[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  seed();
});

afterEach(() => {
  registerWysiwygFlusher(TAB, null);
  registerWysiwygFlusher(OTHER, null);
});

describe("a target tab whose flush fails", () => {
  it("document.read is refused rather than answered with the stale store", async () => {
    registerWysiwygFlusher(TAB, crash);
    await handleDocumentRead("r1", { tabId: TAB }, TEST_WRITE_CONTEXT);
    const r = reply("r1");
    expect(r.success).toBe(false);
    expect(r.data).toBeUndefined();
  });

  it("document.write is refused and changes nothing", async () => {
    registerWysiwygFlusher(TAB, crash);
    await handleDocumentWrite("r2", { tabId: TAB, content: "new\n", save: false }, TEST_WRITE_CONTEXT);
    expect(reply("r2").success).toBe(false);
    expect(useDocumentStore.getState().documents[TAB]?.content).toBe("stored\n");
    expect(fake.log.filter((e) => e.op === "commit")).toEqual([]);
  });
});

describe("another tab whose flush fails", () => {
  it("does not block a read of the target tab", async () => {
    registerWysiwygFlusher(OTHER, crash);
    await handleDocumentRead("r3", { tabId: TAB }, TEST_WRITE_CONTEXT);
    expect(reply("r3").success).toBe(true);
  });

  it("refuses an untargeted flush, which every tab's state depends on", () => {
    registerWysiwygFlusher(OTHER, crash);
    expect(() => flushLiveEditors()).toThrow(/w2/);
    expect(() => flushLiveEditors(TAB)).not.toThrow();
  });
});
