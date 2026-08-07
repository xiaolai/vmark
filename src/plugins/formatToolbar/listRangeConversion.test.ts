// @vitest-environment node
/**
 * Range-aware list conversion — toggle-off across separate lists, wrapping
 * at nested depths, normalize-or-abort for unwrappable blocks, and deep
 * unlisting (remove-list semantics). Separate file from
 * nodeActions.tiptap.test.ts, which is size-baselined.
 */
import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { convertRangeToListType, unlistCoveredLists } from "./listRangeConversion";
import { handleToBulletList, handleRemoveList } from "./nodeActions.tiptap";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    blockquote: { group: "block", content: "block+" },
    bulletList: { group: "block", content: "listItem+" },
    orderedList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph block*", attrs: { checked: { default: null } } },
    text: { group: "inline" },
  },
});

function p(text: string) {
  return schema.node("paragraph", null, [schema.text(text)]);
}
function li(text: string) {
  return schema.node("listItem", null, [p(text)]);
}
function bl(...items: ReturnType<typeof li>[]) {
  return schema.node("bulletList", null, items);
}

function liveView(doc: ReturnType<typeof schema.node>, from: number, to: number) {
  const state = EditorState.create({ doc, schema });
  let currentState = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  const dispatch = vi.fn((tr: Transaction) => {
    currentState = currentState.apply(tr);
  });
  const view = {
    get state() {
      return currentState;
    },
    focus: vi.fn(),
    dispatch,
    current: () => currentState,
  };
  return view as unknown as EditorView & { current: () => EditorState; dispatch: typeof dispatch };
}

function findText(doc: ReturnType<typeof schema.node>, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text);
      return false;
    }
    return true;
  });
  expect(found).toBeGreaterThanOrEqual(0);
  return found;
}

function shape(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.forEach((child) => out.push(`${child.type.name}(${child.childCount})`));
  return out;
}

describe("range toggle-off across separate lists", () => {
  it("unlists BOTH covered bullet lists, not only the first", () => {
    // Two SEPARATE adjacent bullet lists — everything covered is already the
    // target type, so the toggle must turn it all off in one transaction.
    const doc = schema.node("doc", null, [bl(li("alpha"), li("beta")), bl(li("omega"))]);
    const view = liveView(doc, findText(doc, "alpha"), findText(doc, "omega") + 5);

    expect(handleToBulletList(view)).toBe(true);

    expect(shape(view.current())).toEqual(["paragraph(1)", "paragraph(1)", "paragraph(1)"]);
    expect(view.current().doc.textContent).toBe("alphabetaomega");
    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  it("converts (not toggles off) when a bare paragraph sits between the lists", () => {
    const doc = schema.node("doc", null, [bl(li("alpha")), p("mid"), bl(li("omega"))]);
    const view = liveView(doc, findText(doc, "alpha"), findText(doc, "omega") + 5);

    expect(handleToBulletList(view)).toBe(true);

    // "Make everything a bullet list": the paragraph wraps and the three
    // lists join into one.
    expect(shape(view.current())).toEqual(["bulletList(3)"]);
    expect(view.current().doc.textContent).toBe("alphamidomega");
  });

  it("keeps uncovered head/tail items as residual lists", () => {
    const doc = schema.node("doc", null, [bl(li("one"), li("two"), li("three"))]);
    const view = liveView(doc, findText(doc, "two"), findText(doc, "two") + 3);

    expect(handleToBulletList(view)).toBe(true);

    expect(shape(view.current())).toEqual(["bulletList(1)", "paragraph(1)", "bulletList(1)"]);
    expect(view.current().doc.textContent).toBe("onetwothree");
  });
});

describe("handleRemoveList across separate lists", () => {
  it("unlists every covered list and flattens nested levels", () => {
    const nested = schema.node("listItem", null, [p("outer"), bl(li("inner"))]);
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [nested]),
      p("mid"),
      schema.node("orderedList", null, [li("last")]),
    ]);
    const view = liveView(doc, findText(doc, "outer"), findText(doc, "last") + 4);

    expect(handleRemoveList(view)).toBe(true);

    expect(shape(view.current())).toEqual([
      "paragraph(1)",
      "paragraph(1)",
      "paragraph(1)",
      "paragraph(1)",
    ]);
    expect(view.current().doc.textContent).toBe("outerinnermidlast");
  });

  it("returns false for a range with no lists", () => {
    const doc = schema.node("doc", null, [p("aa"), p("bb")]);
    const view = liveView(doc, findText(doc, "aa"), findText(doc, "bb") + 2);
    expect(unlistCoveredLists(view, true)).toBe(false);
  });
});

describe("wrapping at nested depths", () => {
  it("wraps a covered paragraph INSIDE a blockquote, not only top-level ones", () => {
    const doc = schema.node("doc", null, [
      p("top"),
      schema.node("blockquote", null, [p("quoted")]),
    ]);
    const view = liveView(doc, findText(doc, "top"), findText(doc, "quoted") + 6);

    expect(convertRangeToListType(view, "bulletList")).toBe(true);

    const after = view.current();
    let listsFound = 0;
    let quotedInList = false;
    after.doc.descendants((node, _pos, parent) => {
      if (node.type.name === "bulletList") listsFound++;
      if (node.isText && node.text === "quoted" && parent?.type.name === "paragraph") {
        // paragraph's own parent chain must include a listItem inside the quote
        quotedInList = true;
      }
      return true;
    });
    expect(listsFound).toBe(2); // one at doc level, one inside the quote
    expect(quotedInList).toBe(true);
    expect(after.doc.firstChild!.type.name).toBe("bulletList");
  });

  it("normalizes a heading to a paragraph and wraps it", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 2 }, [schema.text("title")]),
      p("body"),
    ]);
    const view = liveView(doc, findText(doc, "title"), findText(doc, "body") + 4);

    expect(convertRangeToListType(view, "bulletList")).toBe(true);

    const after = view.current();
    expect(shape(after)).toEqual(["bulletList(2)"]);
    let headings = 0;
    after.doc.descendants((node) => {
      if (node.type.name === "heading") headings++;
      return true;
    });
    expect(headings).toBe(0);
  });
});

describe("all-or-nothing abort", () => {
  it("aborts the WHOLE conversion when one block cannot wrap (no partial dispatch)", () => {
    // A schema whose list items cannot hold paragraphs: normalization cannot
    // help, so the conversion must refuse entirely.
    const strict = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { group: "block", content: "inline*" },
        heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
        bulletList: { group: "block", content: "listItem+" },
        orderedList: { group: "block", content: "listItem+" },
        listItem: { content: "heading block*", attrs: { checked: { default: null } } },
        text: { group: "inline" },
      },
    });
    const doc = strict.node("doc", null, [
      strict.node("paragraph", null, [strict.text("aa")]),
      strict.node("paragraph", null, [strict.text("bb")]),
    ]);
    const state = EditorState.create({ doc, schema: strict });
    let currentState = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 7)));
    const dispatch = vi.fn((tr: Transaction) => {
      currentState = currentState.apply(tr);
    });
    const view = {
      get state() {
        return currentState;
      },
      focus: vi.fn(),
      dispatch,
    } as unknown as EditorView;

    expect(convertRangeToListType(view, "bulletList")).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
