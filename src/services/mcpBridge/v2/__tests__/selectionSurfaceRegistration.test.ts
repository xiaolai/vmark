// @vitest-environment jsdom
// The selection surface is chosen from the editor REGISTERED for the focused
// tab, not from the window's sourceMode flag. A YAML SourcePane and the source
// pane of a Markdown split register a CodeMirror view while sourceMode is
// false; the WYSIWYG pane of a split registers while it may be true. Each is
// found. Both registered for the tab (a pane hand-over): sourceMode decides.
// Nothing registered for the tab, an editor registered for ANOTHER tab, or a
// destroyed WYSIWYG editor: NO_EDITOR.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { resolveSelectionSurface } from "../selectionSurface";

let tiptap: Editor | null = null;
let view: CMView | null = null;

function registerSource(tabId: string, text = "name: ci\n", from = 0, to = 4): void {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new CMView({ state: CMState.create({ doc: text, selection: { anchor: from, head: to } }), parent });
  useEditorStore.getState().setActiveSourceView(view, tabId);
}

function registerWysiwyg(tabId: string): Editor {
  tiptap = new Editor({ extensions: [StarterKit], content: "<p>你好 world</p>" });
  tiptap.commands.setTextSelection({ from: 1, to: 3 });
  useEditorStore.getState().setActiveWysiwygEditor(tiptap, tabId);
  return tiptap;
}

const modeOf = (tabId: string) => {
  const surface = resolveSelectionSurface(tabId);
  return "error" in surface ? surface.error : surface.mode;
};

beforeEach(() => {
  useUIStore.setState({ sourceMode: false });
});

afterEach(() => {
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useEditorStore.getState().setActiveSourceView(null);
  tiptap?.destroy();
  tiptap = null;
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = null;
  useUIStore.setState({ sourceMode: false });
});

describe("the surface is the editor registered for the focused tab", () => {
  it("a YAML SourcePane, with sourceMode false, is the source surface", () => {
    registerSource("yaml-tab");
    const surface = resolveSelectionSurface("yaml-tab");
    expect("error" in surface ? surface : surface.selectedText()).toBe("name");
  });

  it("the focused source pane of a Markdown split, with sourceMode false, is the source surface", () => {
    registerSource("md-tab", "# 标题\n");
    expect(modeOf("md-tab")).toBe("source");
  });

  it("the focused WYSIWYG pane of a Markdown split, with sourceMode true, is the WYSIWYG surface", () => {
    useUIStore.setState({ sourceMode: true });
    registerWysiwyg("md-tab");
    expect(modeOf("md-tab")).toBe("wysiwyg");
  });

  it.each([
    [true, "source"],
    [false, "wysiwyg"],
  ])("both registered for the tab: sourceMode %s picks %s", (sourceMode, mode) => {
    useUIStore.setState({ sourceMode });
    registerSource("md-tab");
    registerWysiwyg("md-tab");
    expect(modeOf("md-tab")).toBe(mode);
  });

  it("an editor registered for another tab is NO_EDITOR", () => {
    registerSource("other");
    registerWysiwyg("other");
    expect(modeOf("md-tab")).toBe("NO_EDITOR");
  });

  it("nothing registered is NO_EDITOR", () => {
    expect(modeOf("md-tab")).toBe("NO_EDITOR");
  });

  it("a destroyed WYSIWYG editor is NO_EDITOR (source registered elsewhere)", () => {
    registerSource("other");
    registerWysiwyg("md-tab").destroy();
    expect(modeOf("md-tab")).toBe("NO_EDITOR");
  });
});
