/**
 * runEditorAction → real stores → real WYSIWYG dispatch → real CJK formatter.
 *
 * Purpose: the executor tests mock the adapter, and the adapter tests call it
 * directly; this closes the seam between them, where a dispatch that never
 * reaches the handler is silent (dev-only log, no toast).
 *
 * @module services/editor/runEditorAction.cjk.integration.test
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createTiptapExtensions } from "@/services/assembly/createTiptapExtensions";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { runEditorAction } from "./runEditorAction";

/**
 * jsdom lacks `getClientRects` on Range/Text; ProseMirror's selection
 * re-resolution calls it. Same stub the parity harness installs.
 */
function installLayoutStubs(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  const zeroRect = (): DOMRect =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  for (const proto of [globalThis.Range?.prototype, globalThis.Text?.prototype, globalThis.Element?.prototype]) {
    if (!proto) continue;
    const target = proto as unknown as Record<string, unknown>;
    if (!target.getClientRects) target.getClientRects = () => emptyList;
    if (!target.getBoundingClientRect) target.getBoundingClientRect = zeroRect;
  }
}

const TAB = "tab-a";
const MARKDOWN = "中文Word考试";

let editor: Editor;
let element: HTMLElement;

function registerActiveTab(): void {
  const tab: DocumentTab = {
    id: TAB,
    kind: "document",
    title: "test.md",
    isPinned: false,
    filePath: "/tmp/test.md",
    formatId: "markdown",
  };
  useTabStore.setState({ tabs: { main: [tab] }, activeTabId: { main: TAB } });
  useUIStore.setState({ sourceMode: false, markdownSplitView: false });
  useEditorStore.getState().setActiveWysiwygEditor(editor, TAB);
}

beforeAll(() => {
  installLayoutStubs();
  element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: createTiptapExtensions({ tabId: TAB }),
    content: "",
  });
});

afterAll(async () => {
  editor.destroy();
  element.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

beforeEach(() => {
  registerActiveTab();
  editor.commands.setContent(parseMarkdown(editor.schema, MARKDOWN).toJSON());
});

describe("formatCJK through the executor", () => {
  it("spaces CJK and Latin text from a text selection", () => {
    editor.commands.setTextSelection({ from: 1, to: 1 + MARKDOWN.length });
    runEditorAction("formatCJK", { windowLabel: "main" });
    expect(editor.getText()).toBe("中文 Word 考试");
  });

  it("spaces CJK and Latin text from a collapsed caret", () => {
    editor.commands.setTextSelection({ from: 1, to: 1 });
    runEditorAction("formatCJK", { windowLabel: "main" });
    expect(editor.getText()).toBe("中文 Word 考试");
  });
});

describe("formatCJK through the executor, Source mode", () => {
  let view: EditorView;

  beforeEach(() => {
    const parent = document.createElement("div");
    view = new EditorView({
      state: EditorState.create({ doc: MARKDOWN }),
      parent,
    });
    useUIStore.setState({ sourceMode: true, markdownSplitView: false });
    useEditorStore.getState().setActiveSourceView(view, TAB);
  });

  afterEach(() => {
    view.destroy();
    useEditorStore.getState().setActiveSourceView(null, null);
    useUIStore.setState({ sourceMode: false, markdownSplitView: false });
  });

  it("spaces CJK and Latin text from a collapsed caret", () => {
    runEditorAction("formatCJK", { windowLabel: "main" });
    expect(view.state.doc.toString()).toBe("中文 Word 考试");
  });

  it("spaces CJK and Latin text from a selection", () => {
    view.dispatch({ selection: { anchor: 0, head: MARKDOWN.length } });
    runEditorAction("formatCJK", { windowLabel: "main" });
    expect(view.state.doc.toString()).toBe("中文 Word 考试");
  });
});
