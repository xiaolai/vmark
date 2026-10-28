// WI-AL3.2 — reading the reader's selection for a comment from the live editor: no editor for the tab, or one still mounting (a WYSIWYG editor before its content load, either editor before its caret restore), reads nothing; Source offsets are the Markdown's own; a WYSIWYG selection is mapped onto the document's Markdown exactly, so a repeated run picks the selected occurrence and a slice whose own Markdown occurs elsewhere (a part of a bold run) is not sent as that other place; a selection at a mark's edge quotes the selected text inside the marks (a bold-italic word quotes the word), and a caret at a run's edge maps between the runs; a quote never splits a link's destination: a selection inside a link's text stays inside it, and one crossing a link's edge covers the whole link; a selection that cannot be mapped is a guess — the occurrence nearest a proportional estimate, never exact
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { markContentApplied } from "@/services/editor/contentApplied";
import { beginCaretRestore } from "@/services/editor/caretRestorePending";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { getSerializeOptions } from "@/plugins/toolbarActions/wysiwygAdapterUtils";
import { readCommentSelection } from "../commentCreate";
import { locateSelection, type EditorSelection } from "../commentSelection";

const TAB = "t-1";
let tiptap: Editor | null = null;
let view: CMView | null = null;

function source(text: string, from: number, to: number): CMView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new CMView({ state: CMState.create({ doc: text, selection: { anchor: from, head: to } }), parent });
  useEditorStore.getState().setActiveSourceView(view, TAB);
  return view;
}

/** A mounted WYSIWYG editor of the tab holding `html`; `applied: false` is one still mounting. */
function wysiwyg(html: string, applied = true): Editor {
  tiptap = new Editor({ extensions: [StarterKit], content: html });
  if (applied) markContentApplied(tiptap);
  useEditorStore.getState().setActiveWysiwygEditor(tiptap, TAB);
  return tiptap;
}

/** The PM range of the `nth` (0-based) occurrence of `needle` in the editor's text nodes. */
function rangeOf(editor: Editor, needle: string, nth = 0): { from: number; to: number } {
  const found: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? "";
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) found.push(pos + i);
  });
  const from = found[nth];
  if (from === undefined) throw new Error(`no occurrence ${nth} of ${needle}`);
  return { from, to: from + needle.length };
}

/** Where `sel` lands in the text the editor serializes to. */
function landed(sel: EditorSelection | null, text: string) {
  if (!sel) throw new Error("no selection read");
  const at = locateSelection(text, sel);
  return { ...at, quote: text.slice(at.start, at.end) };
}

/** The editor's Markdown, serialized as the selection surface serializes it. */
const serialized = (editor: Editor) => serializeMarkdown(editor.state.schema, editor.state.doc, getSerializeOptions());

/** The selection read, which must be mapped onto the editor's Markdown exactly. */
function mapped(editor: Editor) {
  const sel = readCommentSelection(TAB);
  if (sel?.mode !== "markdown") throw new Error(`expected an exactly mapped selection, got ${JSON.stringify(sel)}`);
  expect(sel.text).toBe(serialized(editor));
  return { sel, text: sel.text };
}

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

describe("readCommentSelection — nothing to read", () => {
  it("reads nothing when no editor is registered for the tab", () => {
    expect(readCommentSelection(TAB)).toBeNull();
  });

  it("reads nothing from an editor registered for another tab", () => {
    tiptap = new Editor({ extensions: [StarterKit], content: "<p>hello</p>" });
    markContentApplied(tiptap);
    useEditorStore.getState().setActiveWysiwygEditor(tiptap, "other");
    expect(readCommentSelection(TAB)).toBeNull();
  });

  it("reads nothing from a WYSIWYG editor whose content load has not run", () => {
    const editor = wysiwyg("<p>hello world</p>", false);
    editor.commands.setTextSelection(rangeOf(editor, "world"));
    expect(readCommentSelection(TAB)).toBeNull();
  });

  it("reads nothing from a Source editor whose caret restore has not run", () => {
    const v = source("hello world\n", 6, 11);
    const settle = beginCaretRestore(v);
    expect(readCommentSelection(TAB)).toBeNull();
    settle();
    expect(readCommentSelection(TAB)).toMatchObject({ mode: "markdown", from: 6, to: 11, selected: "world" });
  });
});

describe("readCommentSelection — Source", () => {
  it("keeps the editor's offsets in the text it holds, exact", () => {
    const text = "hello world\n\nhello again\n";
    const at = text.lastIndexOf("hello");
    source(text, at, at + 5);
    const sel = readCommentSelection(TAB);
    expect(sel).toEqual({ mode: "markdown", from: at, to: at + 5, selected: "hello", text });
    expect(landed(sel, text)).toMatchObject({ start: at, end: at + 5, precision: "exact" });
  });
});

describe("readCommentSelection — WYSIWYG mapped exactly", () => {
  it("picks the selected one of a repeated run, exact", () => {
    const editor = wysiwyg("<p>hello world</p><p>hello again</p><p>hello there</p>");
    editor.commands.setTextSelection(rangeOf(editor, "hello", 1));
    const { sel, text } = mapped(editor);
    expect(landed(sel, text)).toEqual({ start: text.indexOf("hello again"), end: text.indexOf("hello again") + 5, precision: "exact", quote: "hello" });
  });

  it("maps part of a bold run onto its own place, not onto a run whose Markdown the slice serializes to", () => {
    const editor = wysiwyg("<p><strong>bold</strong> then <strong>ol</strong></p>");
    editor.commands.setTextSelection(rangeOf(editor, "ol", 0));
    const { sel, text } = mapped(editor);
    const inBold = text.indexOf("bold") + 1;
    expect(landed(sel, text)).toEqual({ start: inBold, end: inBold + 2, precision: "exact", quote: "ol" });
  });

  it("maps a caret to its Markdown offset", () => {
    const editor = wysiwyg("<p>hello</p><p>world</p>");
    editor.commands.setTextSelection(rangeOf(editor, "rld").from);
    const { sel, text } = mapped(editor);
    expect(sel).toMatchObject({ selected: "" });
    expect(landed(sel, text)).toMatchObject({ start: text.indexOf("rld"), end: text.indexOf("rld"), precision: "exact" });
  });
});

describe("readCommentSelection — WYSIWYG at mark and link edges", () => {
  const LINK = "<p>see <a href=\"http://x\">link</a> here</p>";
  /** The quote stored for the selection from `first`'s start to `last`'s end (default `first`'s) in `html`. */
  function quoteOf(html: string, first: string, last = first): string {
    const editor = wysiwyg(html);
    editor.commands.setTextSelection({ from: rangeOf(editor, first).from, to: rangeOf(editor, last).to });
    const { sel, text } = mapped(editor);
    return landed(sel, text).quote;
  }

  it("quotes a bold-italic word as the word, inside its markers", () => {
    expect(quoteOf("<p><strong><em>x</em></strong></p>", "x")).toBe("x");
  });

  it("quotes text inside a link's text as that text, with no part of the destination", () => {
    expect(quoteOf(LINK, "ink")).toBe("ink");
    expect(quoteOf(LINK, "link")).toBe("link");
  });

  it("covers the whole link when the selection ends inside it", () => {
    expect(quoteOf(LINK, "see ", "li")).toBe("see [link](http://x)");
  });

  it("covers the whole link when the selection starts inside it", () => {
    expect(quoteOf(LINK, "nk", " he")).toBe("[link](http://x) he");
  });

  it("maps a caret at the end of a bold run between the runs", () => {
    const editor = wysiwyg("<p><strong>a</strong>b</p>");
    editor.commands.setTextSelection(rangeOf(editor, "b").from);
    const { sel, text } = mapped(editor);
    const at = text.indexOf("b");
    expect(landed(sel, text)).toMatchObject({ start: at, end: at, precision: "exact" });
  });
});

describe("readCommentSelection — WYSIWYG that cannot be mapped", () => {
  /** Select the `nth` horizontal rule: a node selection between blocks has no text position to map. */
  function selectRule(editor: Editor, nth: number): void {
    const rules: number[] = [];
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "horizontalRule") rules.push(offset);
    });
    const at = rules[nth];
    if (at === undefined) throw new Error(`no rule ${nth}`);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at)));
  }

  it("guesses the repeat nearest its proportional place, approximate", () => {
    const editor = wysiwyg("<p>a</p><hr><p>b</p><hr><p>c</p><hr><p>d</p>");
    selectRule(editor, 1);
    const sel = readCommentSelection(TAB);
    expect(sel?.mode).toBe("wysiwyg");
    const text = serialized(editor);
    const rule = sel?.selected ?? "";
    expect(rule.length).toBeGreaterThan(0);
    const second = text.indexOf(rule, text.indexOf(rule) + 1);
    expect(landed(sel, text)).toMatchObject({ start: second, end: second + rule.length, precision: "approximate" });
  });

  it("never sends a guess as exact, even where its Markdown occurs once", () => {
    const editor = wysiwyg("<p>a</p><hr><p>b</p>");
    selectRule(editor, 0);
    const sel = readCommentSelection(TAB);
    expect(sel?.mode).toBe("wysiwyg");
    expect(landed(sel, serialized(editor)).precision).toBe("approximate");
  });
});
