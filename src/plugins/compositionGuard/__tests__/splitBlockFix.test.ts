// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { fixCompositionSplitBlock } from "../splitBlockFix";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    heading: {
      content: "text*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    paragraph: { content: "text*", group: "block" },
    text: { inline: true },
  },
});

/** Create a state with heading (pinyin) + paragraph (composed text), cursor in paragraph */
function createSplitState(
  headingText: string,
  paragraphText: string,
  cursorInParagraph = true,
) {
  const doc = schema.node("doc", null, [
    schema.node("heading", { level: 1 }, headingText ? [schema.text(headingText)] : []),
    schema.node("paragraph", null, paragraphText ? [schema.text(paragraphText)] : []),
  ]);

  const headingEnd = 1 + headingText.length;
  const paragraphContentStart = headingEnd + 2;
  const paragraphContentEnd = paragraphContentStart + paragraphText.length;

  const cursorPos = cursorInParagraph ? paragraphContentEnd : headingEnd;
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, cursorPos),
  });
}

describe("fixCompositionSplitBlock", () => {
  it("fixes split: heading with pinyin + paragraph with composed text", () => {
    const state = createSplitState("wo kj kj", "\u6211\u770B\u770B");
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "wo kj kj");

    expect(tr).not.toBeNull();
    const result = tr!.doc;

    expect(result.childCount).toBe(1);
    expect(result.child(0).type.name).toBe("heading");
    expect(result.child(0).textContent).toBe("\u6211\u770B\u770B");
    expect(tr!.selection.from).toBe(1 + "\u6211\u770B\u770B".length);
  });

  it("fixes split but leaves preedit when pinyin doesn't match exactly", () => {
    // Abbreviated pinyin: heading has "ch qi" but compositionPinyin was "chang qi"
    // Pinyin mismatch → preedit stays (safe: no data loss risk)
    const state = createSplitState("ch qi", "\u957F\u671F");
    const tr = fixCompositionSplitBlock(state, 1, "\u957F\u671F", "chang qi");

    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(result.childCount).toBe(1);
    expect(result.child(0).type.name).toBe("heading");
    // Composed text inserted at startPos, preedit "ch qi" remains after it
    expect(result.child(0).textContent).toBe("\u957F\u671Fch qi");
  });

  it("fixes split when browser already cleared heading preedit", () => {
    // Browser removed pinyin from heading, leaving it empty
    const state = createSplitState("", "\u6211\u770B\u770B");
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "wo kj kj");

    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(result.childCount).toBe(1);
    expect(result.child(0).type.name).toBe("heading");
    expect(result.child(0).textContent).toBe("\u6211\u770B\u770B");
  });

  it("preserves heading text before composition start", () => {
    const state = createSplitState("Chapter 1: wo kj kj", "\u6211\u770B\u770B");
    const compositionStartPos = 1 + "Chapter 1: ".length;
    const tr = fixCompositionSplitBlock(state, compositionStartPos, "\u6211\u770B\u770B", "wo kj kj");

    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(result.childCount).toBe(1);
    expect(result.child(0).textContent).toBe("Chapter 1: \u6211\u770B\u770B");
    expect(tr!.selection.from).toBe(compositionStartPos + "\u6211\u770B\u770B".length);
  });

  it("preserves CJK suffix after preedit in heading", () => {
    // Heading: "wo kj kj已有内容" — "已有内容" existed before composition
    const state = createSplitState("wo kj kj\u5DF2\u6709\u5185\u5BB9", "\u6211\u770B\u770B");
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "wo kj kj");

    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(result.childCount).toBe(1);
    expect(result.child(0).textContent).toBe("\u6211\u770B\u770B\u5DF2\u6709\u5185\u5BB9");
  });

  it("leaves preedit residue when pinyin doesn't match exactly (safe fallback)", () => {
    // Abbreviated pinyin "ch qi" in heading, but compositionPinyin was "chang qi"
    // Pinyin doesn't match → preedit not deleted (safe: no data loss)
    const state = createSplitState("ch qi", "\u957F\u671F");
    const tr = fixCompositionSplitBlock(state, 1, "\u957F\u671F", "chang qi");

    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(result.childCount).toBe(1);
    // Paragraph deleted, composed text inserted, but preedit "ch qi" remains
    // (filterTransaction prevents this case in practice, this is the rAF fallback)
    expect(result.child(0).textContent).toBe("\u957F\u671Fch qi");
  });

  it("preserves English content in mixed-language heading", () => {
    // "Chapter wo kj kj" — "Chapter " is user content, "wo kj kj" is preedit
    const state = createSplitState("Chapter wo kj kj", "\u6211\u770B\u770B");
    const compositionStartPos = 1 + "Chapter ".length;
    const tr = fixCompositionSplitBlock(state, compositionStartPos, "\u6211\u770B\u770B", "wo kj kj");

    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(result.childCount).toBe(1);
    expect(result.child(0).textContent).toBe("Chapter \u6211\u770B\u770B");
  });

  it("returns null when cursor is in the same block (no split)", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("\u6211\u770B\u770B")]),
      schema.node("paragraph", null, [schema.text("other")]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1 + "\u6211\u770B\u770B".length),
    });
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "wo kj kj");
    expect(tr).toBeNull();
  });

  it("returns null when original block is not a heading", () => {
    // Paragraph split — not a heading, should not fix
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("wo kj kj")]),
      schema.node("paragraph", null, [schema.text("\u6211\u770B\u770B")]),
    ]);
    const cursorPos = 1 + "wo kj kj".length + 2 + "\u6211\u770B\u770B".length;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, cursorPos),
    });
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "wo kj kj");
    expect(tr).toBeNull();
  });

  it("returns null when cursor block text does not match composed text", () => {
    const state = createSplitState("wo kj kj", "something else");
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "wo kj kj");
    expect(tr).toBeNull();
  });

  it("returns null for empty compositionData", () => {
    const state = createSplitState("wo kj kj", "\u6211\u770B\u770B");
    const tr = fixCompositionSplitBlock(state, 1, "", "wo kj kj");
    expect(tr).toBeNull();
  });

  it("returns null when cursor block is not a paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("wo kj kj")]),
      schema.node("heading", { level: 2 }, [schema.text("\u6211\u770B\u770B")]),
    ]);
    const cursorPos = 1 + "wo kj kj".length + 2 + "\u6211\u770B\u770B".length;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, cursorPos),
    });
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "wo kj kj");
    expect(tr).toBeNull();
  });

  it("returns null when cursor block is not the immediate next sibling", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("wo kj kj")]),
      schema.node("paragraph", null, [schema.text("unrelated")]),
      schema.node("paragraph", null, [schema.text("\u6211\u770B\u770B")]),
    ]);
    const pos = 1 + "wo kj kj".length + 2 + "unrelated".length + 2 + "\u6211\u770B\u770B".length;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, pos),
    });
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "wo kj kj");
    expect(tr).toBeNull();
  });

  it("returns null when compositionStartPos is out of bounds", () => {
    const state = createSplitState("wo kj kj", "\u6211\u770B\u770B");
    const tr = fixCompositionSplitBlock(state, 999, "\u6211\u770B\u770B", "wo kj kj");
    expect(tr).toBeNull();
  });

  it("sets composition-cleanup uiEvent meta", () => {
    const state = createSplitState("wo kj kj", "\u6211\u770B\u770B");
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "wo kj kj");
    expect(tr).not.toBeNull();
    expect(tr!.getMeta("uiEvent")).toBe("composition-cleanup");
  });
});
