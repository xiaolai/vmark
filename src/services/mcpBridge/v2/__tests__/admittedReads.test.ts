// @vitest-environment jsdom
// An MCP edit consumes the reads its client made BEFORE the request was
// admitted: a read made while the edit's prepare is held belongs to the
// client's next write, whether or not the edit saves (document.write with
// save false, document.transform, selection.set); an applied edit that does
// not save never hands its reads on to a later write; a saving write hands
// the save exactly the batch it was admitted with; and an edit that applied
// nothing — refused by its guards, by the journal, or aborted — gives its
// reads back for the next write. The saving case runs against the real save
// pipeline in admittedReadsSave.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/services/agentJournal/journalTransport", () =>
  import("@/test/agentJournalWireFake").then((m) => m.journalTransportModule()),
);

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { respond } from "@/services/mcpBridge/utils";
import { handleDocumentTransform, handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { handleSelectionSet } from "@/services/mcpBridge/v2/selection";
import { detachMcpReads, dropAllMcpConnectionReads, recordMcpRead, type McpReadBatch } from "@/services/coherence/mcpCapture";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_ATTRIBUTION, TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const ROOT = "/ws";
const TAB = "a";
const TEXT = "hello world\n";
const CONN = TEST_ATTRIBUTION.connectionId;
let view: CMView | null = null;

function seed(filePath: string | null = null, text = TEXT): void {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath, title: TAB, isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, text, filePath);
}

/** A Source editor showing the tab, "world" selected. */
function source(): void {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new CMView({ state: CMState.create({ doc: TEXT, selection: { anchor: 6, head: 11 } }), parent });
  useUIStore.setState({ sourceMode: true });
  useEditorStore.getState().setActiveSourceView(view, TAB);
}

const read = (name: string) => recordMcpRead(CONN, `${ROOT}/${name}`, name);
const pathsOf = (batch: unknown) => (batch as McpReadBatch).reads.map(([path]) => path);
/** The reads the connection still holds for its next write. */
const remaining = () => pathsOf(detachMcpReads(CONN));
function reply(requestId: string) {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  return call[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  dropAllMcpConnectionReads();
  useWorkspaceStore.setState({ rootPath: ROOT });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
});

afterEach(() => {
  dropAllMcpConnectionReads();
  useEditorStore.getState().setActiveSourceView(null);
  useUIStore.setState({ sourceMode: false });
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = null;
});

const EDITS: Array<[string, () => void, (id: string) => Promise<void>]> = [
  ["document.write (save: false)", () => seed("/ws/doc.md"), (id) => handleDocumentWrite(id, { tabId: TAB, content: "new\n", save: false }, TEST_WRITE_CONTEXT)],
  ["document.write to an untitled tab", () => seed(), (id) => handleDocumentWrite(id, { tabId: TAB, content: "new\n" }, TEST_WRITE_CONTEXT)],
  ["document.transform", () => seed(null, "中文abc\n"), (id) => handleDocumentTransform(id, { tabId: TAB, kind: "cjk-spacing" }, TEST_WRITE_CONTEXT)],
  ["selection.set", () => (seed(), source()), (id) => handleSelectionSet(id, { content: "there" }, TEST_WRITE_CONTEXT)],
];

describe.each(EDITS)("%s", (_label, mount, edit) => {
  it("consumes the reads made before it, and leaves a read made during its prepare for the next write", async () => {
    mount();
    read("before.md");
    fake.holdNextPrepare();
    const running = edit("w1");
    await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalled());
    read("during.md");
    fake.release();
    await running;
    expect(reply("w1").success).toBe(true);
    expect(remaining()).toEqual([`${ROOT}/during.md`]);
  });

  it("gives its reads back when the journal refuses it", async () => {
    mount();
    read("before.md");
    fake.refuseNextPrepares("STALE_PARENT");
    await edit("w1");
    expect(reply("w1").success).toBe(false);
    expect(remaining()).toEqual([`${ROOT}/before.md`]);
  });
});

it("an edit refused by its guards gives its reads back", async () => {
  seed();
  read("before.md");
  await handleDocumentWrite("w1", { tabId: TAB, content: "new\n", expected_revision: "stale" }, TEST_WRITE_CONTEXT);
  expect(reply("w1").success).toBe(false);
  expect(remaining()).toEqual([`${ROOT}/before.md`]);
});

it("an edit the user's edit aborts gives its reads back, including one made during its prepare", async () => {
  seed();
  read("before.md");
  fake.holdNextPrepare();
  const running = handleDocumentWrite("w1", { tabId: TAB, content: "new\n", save: false }, TEST_WRITE_CONTEXT);
  await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalled());
  read("during.md");
  useDocumentStore.getState().setEditorContent(TAB, "user typed\n");
  fake.release();
  await running;
  expect(reply("w1").success).toBe(false);
  expect(remaining().sort()).toEqual([`${ROOT}/before.md`, `${ROOT}/during.md`]);
});
