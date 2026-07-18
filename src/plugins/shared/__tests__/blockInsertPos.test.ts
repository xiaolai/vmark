/**
 * Tests for blockInsertPos — shared insert-position calculation used by the
 * alertBlock and detailsBlock insert commands (Codex audit finding 1).
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { AllSelection, EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { blockInsertPos } from "../blockInsertPos";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    horizontalRule: { group: "block" },
    text: { inline: true },
  },
});

function para(text: string) {
  return schema.node("paragraph", null, text ? [schema.text(text)] : []);
}

describe("blockInsertPos", () => {
  it("returns the position after the current block for a text selection", () => {
    const doc = schema.node("doc", null, [para("hello")]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
    });
    // paragraph content ends at 6; +1 crosses the closing token → 7
    expect(blockInsertPos(state.selection)).toBe(7);
  });

  it("returns the selection end for an AllSelection (depth 0)", () => {
    const doc = schema.node("doc", null, [para("hello")]);
    const state = EditorState.create({ doc, selection: new AllSelection(doc) });
    expect(blockInsertPos(state.selection)).toBe(doc.content.size);
  });

  it("returns the position after the node for a top-level NodeSelection", () => {
    const doc = schema.node("doc", null, [para("hello"), schema.node("horizontalRule")]);
    const hrPos = doc.child(0).nodeSize;
    const state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, hrPos),
    });
    expect(blockInsertPos(state.selection)).toBe(hrPos + 1);
  });

  it("never exceeds doc.content.size for depth-0 selections", () => {
    const doc = schema.node("doc", null, [para("a"), para("b")]);
    const state = EditorState.create({ doc, selection: new AllSelection(doc) });
    expect(blockInsertPos(state.selection)).toBeLessThanOrEqual(doc.content.size);
  });

  it("uses the block containing the selection HEAD ($from) for multi-block text selections", () => {
    const doc = schema.node("doc", null, [para("ab"), para("cd")]);
    const state = EditorState.create({
      doc,
      // from inside first paragraph, to inside second
      selection: TextSelection.create(doc, 2, 6),
    });
    // First paragraph content ends at 3; +1 → 4 (after the first block)
    expect(blockInsertPos(state.selection)).toBe(4);
  });
});
