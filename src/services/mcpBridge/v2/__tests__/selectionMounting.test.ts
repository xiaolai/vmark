// @vitest-environment jsdom
// vmark.selection.{get, set} on an editor that is still mounting — a WYSIWYG
// editor before its initial content load, or either editor before its caret
// restore has run — are refused BUSY: its selection is a placeholder the user
// never placed, so it is neither reported nor edited. A caret restore that
// begins while the prepare is held aborts the set (selection), editor and store
// untouched.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
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
import { respond } from "@/services/mcpBridge/utils";
import { handleSelectionGet, handleSelectionSet } from "@/services/mcpBridge/v2/selection";
import { beginCaretRestore } from "@/services/editor/caretRestorePending";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const TAB = "a";
const TEXT = "hello world";
let view: CMView | null = null;
let tiptap: Editor | null = null;

function seed(): void {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: null, title: TAB, isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, TEXT, null);
}

function source(): CMView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new CMView({ state: CMState.create({ doc: TEXT, selection: { anchor: 6, head: 11 } }), parent });
  useUIStore.setState({ sourceMode: true });
  useEditorStore.getState().setActiveSourceView(view, TAB);
  return view;
}

/** A WYSIWYG editor whose initial content load has NOT run. */
function unloadedWysiwyg(): Editor {
  tiptap = new Editor({ extensions: [StarterKit], content: "<p></p>" });
  useEditorStore.getState().setActiveWysiwygEditor(tiptap, TAB);
  return tiptap;
}

function reply(requestId: string) {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  return call[0];
}
const errorOf = (requestId: string) => JSON.parse(reply(requestId).error ?? "null") as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  seed();
});

afterEach(() => {
  useEditorStore.getState().setActiveSourceView(null);
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useUIStore.setState({ sourceMode: false });
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = null;
  tiptap?.destroy();
  tiptap = null;
});

describe.each([
  ["a WYSIWYG editor before its initial load", () => unloadedWysiwyg()],
  ["a Source editor before its caret restore", () => beginCaretRestore(source()) && undefined],
])("%s", (_label, mount) => {
  it("selection.get is refused BUSY", async () => {
    mount();
    await handleSelectionGet("g1", {});
    expect(reply("g1").success).toBe(false);
    expect(errorOf("g1")).toMatchObject({ error: "BUSY" });
  });

  it("selection.set is refused BUSY and changes nothing", async () => {
    mount();
    await handleSelectionSet("s1", { content: "X" }, TEST_WRITE_CONTEXT);
    expect(errorOf("s1")).toMatchObject({ error: "BUSY" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents[TAB]?.content).toBe(TEXT);
  });
});

it("a caret restore that begins during the held prepare aborts the set (selection)", async () => {
  const live = source();
  fake.holdNextPrepare();
  const pending = handleSelectionSet("s2", { content: "X" }, TEST_WRITE_CONTEXT);
  await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalledTimes(1));
  const settle = beginCaretRestore(live);
  fake.release();
  await pending;
  settle();

  expect(errorOf("s2")).toMatchObject({ error: "ABORTED", reason: "selection" });
  expect(live.state.doc.toString()).toBe(TEXT);
  expect(useDocumentStore.getState().documents[TAB]?.content).toBe(TEXT);
});
