// WI-AL2.2g — the selection re-verify compares only a selection the write saw. A write accepted while no live editor showed the tab (a freshly loaded page whose editor has not mounted yet, or a tab the user was not looking at) is not ABORTED when an editor appears with its initial cursor, or the user switches to the tab, before the apply; a selection the write did see still aborts when it moves, or when its editor goes away while the tab stays focused; an explicit-target write whose tab the user switched away from still goes ahead.
//
// Native finding: a reloaded document window answers drivable about a second
// before its editor mounts, and the first agent write in that second was
// refused "the user moved the selection" with nobody at the keyboard.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { markContentApplied } from "@/services/editor/contentApplied";
import { captureWriteTarget, reverifyWriteTarget, type WriteTarget } from "@/services/mcpBridge/v2/writeTarget";

let editor: Editor | null = null;

function tab(id: string): DocumentTab {
  return { kind: "document", id, filePath: `/notes/${id}.md`, title: id, isPinned: false, formatId: "markdown" };
}

function seed(ids: string[], focused: string): void {
  useTabStore.setState({ tabs: { main: ids.map(tab) }, activeTabId: { main: focused }, untitledCounter: 0 });
  for (const id of ids) useDocumentStore.getState().initDocument(id, "old document\n", `/notes/${id}.md`);
}

/** A settled editor on `tabId`: its content load has run and no caret restore is pending. */
function mountLive(tabId: string, cursor = 1): Editor {
  editor = new Editor({ extensions: [StarterKit], content: "<p>old document</p>" });
  markContentApplied(editor);
  editor.commands.setTextSelection({ from: cursor, to: cursor });
  useEditorStore.getState().setTiptapEditor(editor);
  useEditorStore.getState().setActiveWysiwygEditor(editor, tabId);
  return editor;
}

function unmountLive(): void {
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useEditorStore.getState().setTiptapEditor(null);
  editor?.destroy();
  editor = null;
}

function capture(tabId: string, requireFocus = false): WriteTarget {
  const t = captureWriteTarget(
    { tabId, revision: useRevisionStore.getState().getRevision(tabId), filePath: `/notes/${tabId}.md` },
    requireFocus,
    "old document\n",
  );
  if ("refused" in t) throw new Error(`capture refused: ${t.refused}`);
  return t;
}

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useUIStore.setState({ sourceMode: false });
});

afterEach(() => unmountLive());

describe("reverifyWriteTarget — a selection the write never saw", () => {
  it("an editor mounting on the focused tab after the capture does not abort", () => {
    seed(["t1"], "t1");
    const target = capture("t1");
    expect(target.selection).toBeNull();
    mountLive("t1", 5);
    expect(reverifyWriteTarget(target)).toBeNull();
  });

  it("the user switching to an explicit target's tab after the capture does not abort", () => {
    seed(["t1", "t2"], "t2");
    mountLive("t1", 3);
    const target = capture("t1");
    expect(target.selection).toBeNull();
    useTabStore.setState({ activeTabId: { main: "t1" } });
    expect(reverifyWriteTarget(target)).toBeNull();
  });
});

describe("reverifyWriteTarget — a selection the write saw", () => {
  it("moving it aborts (selection)", () => {
    seed(["t1"], "t1");
    const live = mountLive("t1", 1);
    const target = capture("t1");
    expect(target.selection).not.toBeNull();
    live.commands.setTextSelection({ from: 5, to: 5 });
    expect(reverifyWriteTarget(target)).toBe("selection");
  });

  it("its editor going away while the tab stays focused aborts (selection)", () => {
    seed(["t1"], "t1");
    mountLive("t1", 1);
    const target = capture("t1");
    unmountLive();
    expect(reverifyWriteTarget(target)).toBe("selection");
  });

  it("unchanged, it goes ahead", () => {
    seed(["t1"], "t1");
    mountLive("t1", 2);
    expect(reverifyWriteTarget(capture("t1"))).toBeNull();
  });

  it("the user switching away from an explicit target's tab goes ahead", () => {
    seed(["t1", "t2"], "t1");
    mountLive("t1", 2);
    const target = capture("t1");
    expect(target.selection).not.toBeNull();
    useTabStore.setState({ activeTabId: { main: "t2" } });
    expect(reverifyWriteTarget(target)).toBeNull();
  });

  it("a write that requires focus still aborts when the focused tab changes", () => {
    seed(["t1", "t2"], "t1");
    const target = capture("t1", true);
    useTabStore.setState({ activeTabId: { main: "t2" } });
    expect(reverifyWriteTarget(target)).toBe("selection");
  });
});
