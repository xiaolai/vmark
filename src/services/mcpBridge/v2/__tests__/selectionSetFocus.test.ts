// @vitest-environment jsdom
// vmark.selection.set is view-state: the edit must still be on the focused tab when its prepare answers, whether the request named the tab or not. A focus switch during the held prepare aborts it (selection) with the editor and the store untouched; with focus kept, a request naming the focused tab applies.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/services/agentJournal/journalTransport", () =>
  import("@/test/agentJournalWireFake").then((m) => m.journalTransportModule()),
);

import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { respond } from "@/services/mcpBridge/utils";
import { handleSelectionSet } from "@/services/mcpBridge/v2/selection";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

let view: CMView | null = null;

function tab(id: string): DocumentTab {
  return { kind: "document", id, filePath: null, title: id, isPinned: false, formatId: "markdown" };
}

function seedTwoTabs(): CMView {
  useTabStore.setState({ tabs: { main: [tab("a"), tab("b")] }, activeTabId: { main: "a" }, untitledCounter: 0 });
  useDocumentStore.getState().initDocument("a", "hello world", null);
  useDocumentStore.getState().initDocument("b", "other", null);
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new CMView({ state: CMState.create({ doc: "hello world", selection: { anchor: 6, head: 11 } }), parent });
  useUIStore.setState({ sourceMode: true });
  useEditorStore.getState().setActiveSourceView(view, "a");
  return view;
}

function reply(requestId: string) {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  return call[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
});

afterEach(() => {
  useEditorStore.getState().setActiveSourceView(null);
  useUIStore.setState({ sourceMode: false });
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = null;
});

describe("selection.set — focus during the prepare", () => {
  it.each([
    ["names the tab", { tabId: "a" }],
    ["names no tab", {}],
  ])("a focus switch during the held prepare is ABORTED (selection) when the request %s", async (_label, target) => {
    const live = seedTwoTabs();
    const before = useRevisionStore.getState().getRevision("a");
    fake.holdNextPrepare();
    const pending = handleSelectionSet("f1", { ...target, content: "X" }, TEST_WRITE_CONTEXT);
    await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalledTimes(1));
    useTabStore.getState().setActiveTab("main", "b");
    fake.release();
    await pending;

    expect(JSON.parse(reply("f1").error ?? "null")).toMatchObject({ error: "ABORTED", reason: "selection" });
    expect(live.state.doc.toString()).toBe("hello world");
    expect(useDocumentStore.getState().documents.a?.content).toBe("hello world");
    expect(useRevisionStore.getState().getRevision("a")).toBe(before);
    expect(fake.log.filter((e) => e.op === "commit")).toEqual([]);
  });

  it("with focus kept, a request naming the focused tab applies", async () => {
    const live = seedTwoTabs();
    await handleSelectionSet("f2", { tabId: "a", content: "世界" }, TEST_WRITE_CONTEXT);
    expect(reply("f2")).toMatchObject({ success: true, data: { applied: true } });
    expect(live.state.doc.toString()).toBe("hello 世界");
  });
});
