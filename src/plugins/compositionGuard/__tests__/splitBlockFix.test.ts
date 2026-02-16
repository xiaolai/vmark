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

  // Position cursor at end of paragraph text if cursorInParagraph,
  // otherwise at end of heading text
  const headingEnd = 1 + headingText.length; // end of heading content
  const paragraphContentStart = headingEnd + 2; // +1 heading close, +1 paragraph open
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

    // Should have a single heading with composed text, no paragraph
    expect(result.childCount).toBe(1);
    expect(result.child(0).type.name).toBe("heading");
    expect(result.child(0).textContent).toBe("\u6211\u770B\u770B");

    // Cursor should be at end of composed text
    expect(tr!.selection.from).toBe(1 + "\u6211\u770B\u770B".length);
  });

  it("preserves heading text before composition start", () => {
    // "Chapter 1: wo kj kj" — composition started after "Chapter 1: "
    const state = createSplitState("Chapter 1: wo kj kj", "\u6211\u770B\u770B");
    const compositionStartPos = 1 + "Chapter 1: ".length; // after prefix
    const tr = fixCompositionSplitBlock(state, compositionStartPos, "\u6211\u770B\u770B", "wo kj kj");

    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(result.childCount).toBe(1);
    expect(result.child(0).textContent).toBe("Chapter 1: \u6211\u770B\u770B");
    expect(tr!.selection.from).toBe(compositionStartPos + "\u6211\u770B\u770B".length);
  });

  it("returns null when cursor is in the same block (no split)", () => {
    // Heading-only doc, cursor in heading — no fix needed
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

  it("returns null when cursor block text does not match composed text", () => {
    const state = createSplitState("wo kj kj", "something else");
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "wo kj kj");
    expect(tr).toBeNull();
  });

  it("returns null when pinyin does not match at expected position", () => {
    // Heading has different text than expected pinyin
    const state = createSplitState("different text", "\u6211\u770B\u770B");
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "wo kj kj");
    expect(tr).toBeNull();
  });

  it("returns null for empty compositionData", () => {
    const state = createSplitState("wo kj kj", "\u6211\u770B\u770B");
    const tr = fixCompositionSplitBlock(state, 1, "", "wo kj kj");
    expect(tr).toBeNull();
  });

  it("returns null for empty compositionPinyin", () => {
    const state = createSplitState("wo kj kj", "\u6211\u770B\u770B");
    const tr = fixCompositionSplitBlock(state, 1, "\u6211\u770B\u770B", "");
    expect(tr).toBeNull();
  });

  it("returns null when cursor block is not a paragraph", () => {
    // Two headings — cursor in second heading, not a paragraph
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
    // Heading, paragraph (unrelated), paragraph (composed text)
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("wo kj kj")]),
      schema.node("paragraph", null, [schema.text("unrelated")]),
      schema.node("paragraph", null, [schema.text("\u6211\u770B\u770B")]),
    ]);
    // Cursor at end of third block
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
