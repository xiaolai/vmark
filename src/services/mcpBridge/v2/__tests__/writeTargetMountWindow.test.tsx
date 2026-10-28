// WI-AL2.2g — a write captured while the focused editor is still mounting (WYSIWYG: before its content load, or after it but before the deferred caret restore; Source: before the deferred restore) is not ABORTED "selection" when that restore moves the caret; once the editor has settled, a selection the reader moves still aborts.
//
// Native finding: right after a reload the rapid-reloads journey's first write
// was refused "selection" with nobody at the keyboard — the restore that puts
// the caret back where the reader left it ran between the capture and the
// re-verify.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { markContentApplied } from "@/services/editor/contentApplied";
import { scheduleTiptapFocusAndRestore } from "@/services/editor/tiptapFocus";
import { scheduleSourceFocusRestore } from "@/components/Editor/sourceFocusRestore";
import { captureWriteTarget, reverifyWriteTarget, type WriteTarget } from "@/services/mcpBridge/v2/writeTarget";

const TAB = "t1";
let editor: Editor | null = null;
let view: EditorView | null = null;
let frames: FrameRequestCallback[] = [];

function seed(): void {
  const tab: DocumentTab = { kind: "document", id: TAB, filePath: `/notes/${TAB}.md`, title: TAB, isPinned: false, formatId: "markdown" };
  useTabStore.setState({ tabs: { main: [tab] }, activeTabId: { main: TAB }, untitledCounter: 0 });
  useDocumentStore.getState().initDocument(TAB, "old document\n", `/notes/${TAB}.md`);
}

function capture(): WriteTarget {
  const t = captureWriteTarget(
    { tabId: TAB, revision: useRevisionStore.getState().getRevision(TAB), filePath: `/notes/${TAB}.md` },
    false,
    "old document\n",
  );
  if ("refused" in t) throw new Error(`capture refused: ${t.refused}`);
  return t;
}

/** A WYSIWYG editor registered for the focused tab, caret at `cursor`, its content load not yet run. */
function mountWysiwyg(cursor: number): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: [StarterKit], content: "<p>old document</p>" });
  editor.commands.setTextSelection({ from: cursor, to: cursor });
  useEditorStore.getState().setTiptapEditor(editor);
  useEditorStore.getState().setActiveWysiwygEditor(editor, TAB);
  return editor;
}

/** The mount restore with no remembered cursor: it puts the caret at the start of the document. */
function scheduleWysiwygRestore(live: Editor): void {
  scheduleTiptapFocusAndRestore(live, () => null, vi.fn(), TAB);
}

function runFrames(): void {
  const due = frames;
  frames = [];
  for (const cb of due) cb(0);
}

/** A Source view registered for the focused tab, caret at `cursor`. */
function mountSource(cursor: number): EditorView {
  useUIStore.setState({ sourceMode: true });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({ state: EditorState.create({ doc: "old document\n", selection: { anchor: cursor } }), parent });
  useEditorStore.getState().setActiveSourceView(view, TAB);
  return view;
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useUIStore.setState({ sourceMode: false });
  seed();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useEditorStore.getState().setTiptapEditor(null);
  if (view) useEditorStore.getState().clearSourceViewIfMatch(view);
  editor?.destroy();
  view?.destroy();
  editor = null;
  view = null;
  document.body.replaceChildren();
});

describe("WYSIWYG — a write captured while the editor mounts", () => {
  it("before its content load: the load and the restore moving the caret do not abort", () => {
    const live = mountWysiwyg(5);
    const target = capture();
    expect(target.selection).toBeNull();
    markContentApplied(live);
    scheduleWysiwygRestore(live);
    runFrames();
    expect(live.state.selection.from).toBe(1);
    expect(reverifyWriteTarget(target)).toBeNull();
  });

  it("after its content load, before the deferred restore: the restore moving the caret does not abort", () => {
    const live = mountWysiwyg(5);
    markContentApplied(live);
    scheduleWysiwygRestore(live);
    const target = capture();
    expect(target.selection).toBeNull();
    runFrames();
    expect(live.state.selection.from).toBe(1);
    expect(reverifyWriteTarget(target)).toBeNull();
  });

  it("once settled, the reader moving the selection aborts (selection)", () => {
    const live = mountWysiwyg(5);
    markContentApplied(live);
    scheduleWysiwygRestore(live);
    runFrames();
    const target = capture();
    expect(target.selection).not.toBeNull();
    live.commands.setTextSelection({ from: 4, to: 4 });
    expect(reverifyWriteTarget(target)).toBe("selection");
  });
});

describe("Source — a write captured while the view mounts or is shown", () => {
  it("before the deferred restore: the restore moving the caret does not abort", () => {
    vi.useFakeTimers();
    const live = mountSource(0);
    scheduleSourceFocusRestore(live, () => live.dispatch({ selection: { anchor: 7 } }));
    const target = capture();
    expect(target.selection).toBeNull();
    vi.runAllTimers();
    expect(live.state.selection.main.head).toBe(7);
    expect(reverifyWriteTarget(target)).toBeNull();
  });

  it("once settled, the reader moving the selection aborts (selection)", () => {
    vi.useFakeTimers();
    const live = mountSource(0);
    scheduleSourceFocusRestore(live, () => live.dispatch({ selection: { anchor: 7 } }));
    vi.runAllTimers();
    const target = capture();
    expect(target.selection).not.toBeNull();
    live.dispatch({ selection: { anchor: 3 } });
    expect(reverifyWriteTarget(target)).toBe("selection");
  });
});
