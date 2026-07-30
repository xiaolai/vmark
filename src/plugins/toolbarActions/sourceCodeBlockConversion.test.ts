/**
 * Source-mode code-block CONVERSION.
 *
 * The action is a block toggle: its public id is `codeBlock`, the command
 * registry routes it here, and the user guide promises "Convert to code". Source
 * used to open an empty fence and leave the paragraph untouched, contradicting
 * all three while WYSIWYG converted. These cases pin the converted behavior.
 *
 * They live in their own file because `sourceAdapter.test.ts` is already at its
 * frozen 1218-line cap and the size gate ratchets down only.
 *
 * @coordinates-with sourceInsertActions.ts — insertCodeBlock
 * @module plugins/toolbarActions/sourceCodeBlockConversion.test
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { performSourceToolbarAction } from "./sourceAdapter";
import type { MultiSelectionContext } from "./types";

vi.mock("@/plugins/sourcePopup/sourcePopupUtils", () => ({
  getAnchorRectFromRange: vi.fn(() => ({ top: 0, bottom: 20, left: 0, right: 100 })),
  getEditorBounds: vi.fn(() => ({ horizontal: { left: 0, right: 800 }, vertical: { top: 0, bottom: 600 } })),
  toHostCoordsForDom: vi.fn((_: unknown, pos: unknown) => pos),
}));

const views: EditorView[] = [];

function createView(doc: string, from: number, to = from): EditorView {
  const parent = document.createElement("div");
  const view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.create([EditorSelection.range(from, to)]) }),
    parent,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  views.forEach((v) => {
    try {
      v.destroy();
    } catch {
      /* already destroyed */
    }
  });
  views.length = 0;
});

const singleSelection: MultiSelectionContext = {
  enabled: false,
  reason: "none",
  inCodeBlock: false,
  inTable: false,
  inList: false,
  inBlockquote: false,
  inHeading: false,
  inLink: false,
  inInlineMath: false,
  inFootnote: false,
  inImage: false,
  inTextblock: true,
  sameBlockParent: true,
  blockParentType: "paragraph",
};

function convert(view: EditorView): boolean {
  return performSourceToolbarAction("insertCodeBlock", {
    surface: "source",
    view,
    context: null,
    multiSelection: singleSelection,
  });
}

describe("source code-block conversion", () => {
  it("converts the current block rather than inserting an empty fence", () => {
    const view = createView("The quick brown fox", 10);
    expect(convert(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("```plaintext\nThe quick brown fox\n```");
  });

  it("converts every line of a multi-line paragraph, not just the caret's line", () => {
    const view = createView("first line\nsecond line\n\nother para", 3);
    convert(view);
    expect(view.state.doc.toString()).toBe("```plaintext\nfirst line\nsecond line\n```\n\nother para");
  });

  it("stops at the blank line that ends the paragraph", () => {
    const view = createView("before\n\ntarget para\n\nafter", 10);
    convert(view);
    expect(view.state.doc.toString()).toBe("before\n\n```plaintext\ntarget para\n```\n\nafter");
  });

  it("converts the selected lines when there is a selection", () => {
    const view = createView("keep\nalpha\nbeta\nkeep too", 5, 15);
    convert(view);
    expect(view.state.doc.toString()).toBe("keep\n```plaintext\nalpha\nbeta\n```\nkeep too");
  });

  it("expands a partial selection to whole lines", () => {
    const view = createView("alpha\nbeta", 2, 7);
    convert(view);
    expect(view.state.doc.toString()).toBe("```plaintext\nalpha\nbeta\n```");
  });

  it("leaves the caret inside the converted content", () => {
    const view = createView("hello", 0);
    convert(view);
    expect(view.state.selection.main.from).toBe("```plaintext\n".length);
  });

  it("handles CJK content without splitting characters", () => {
    const view = createView("中文段落内容", 3);
    convert(view);
    expect(view.state.doc.toString()).toBe("```plaintext\n中文段落内容\n```");
  });
});
