// @vitest-environment node
/**
 * #1418 — select all occurrences within the CURRENT BLOCK.
 *
 * The document-wide command reaches the whole file, which is what makes
 * multi-cursor editing risky in a long document: a word matched in the
 * paragraph you are reading also places cursors in paragraphs you cannot see.
 * This sibling scopes to the enclosing block, the way the code-block path has
 * always scoped to its fence.
 *
 * Real schema and real text search here, deliberately — `commands.bounds.test.ts`
 * mocks `textSearch` to reach two otherwise-unreachable guard branches, which is
 * the wrong instrument for asserting what the user actually gets.
 */
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { selectAllOccurrences, selectAllOccurrencesInBlock } from "../commands";
import { multiCursorPlugin } from "../multiCursorPlugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    codeBlock: { content: "text*", group: "block", code: true },
    text: { inline: true },
  },
});

/** Two paragraphs, each containing the word "target" twice. */
function twoParagraphState(cursorPos: number): EditorState {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("target one target")]),
    schema.node("paragraph", null, [schema.text("target two target")]),
  ]);
  return EditorState.create({
    doc,
    plugins: [multiCursorPlugin()],
    selection: TextSelection.create(doc, cursorPos),
  });
}

/** How many ranges the resulting selection carries. */
function rangeCount(tr: Transaction | null): number {
  expect(tr).not.toBeNull();
  return tr!.selection.ranges.length;
}

describe("selectAllOccurrencesInBlock (#1418)", () => {
  it("selects only the matches inside the caret's paragraph", () => {
    // Caret inside the first "target" of paragraph one.
    const state = twoParagraphState(2);
    expect(rangeCount(selectAllOccurrencesInBlock(state))).toBe(2);
  });

  it("the document-wide command still reaches both paragraphs", () => {
    const state = twoParagraphState(2);
    expect(rangeCount(selectAllOccurrences(state))).toBe(4);
  });

  it("scopes to the SECOND paragraph when the caret is there", () => {
    const state = twoParagraphState(22);
    const tr = selectAllOccurrencesInBlock(state);
    expect(rangeCount(tr)).toBe(2);
    // Every range must sit past the first paragraph's end.
    const firstParaEnd = state.doc.content.firstChild!.nodeSize;
    for (const r of tr!.selection.ranges) {
      expect(r.$from.pos).toBeGreaterThan(firstParaEnd);
    }
  });

  it("works from an explicit selection, not just a bare caret", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("aa bb aa")]),
      schema.node("paragraph", null, [schema.text("aa cc aa")]),
    ]);
    const state = EditorState.create({
      doc,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 1, 3), // the first "aa"
    });
    expect(rangeCount(selectAllOccurrencesInBlock(state))).toBe(2);
  });

  /**
   * A code block IS a textblock, so the block-scoped command degrades to the
   * fence behaviour rather than competing with it.
   */
  it("stays inside a code fence, matching the existing code-block scoping", () => {
    const doc = schema.node("doc", null, [
      schema.node("codeBlock", null, [schema.text("let val = val")]),
      schema.node("paragraph", null, [schema.text("val outside val")]),
    ]);
    // Caret INSIDE the first "val" (content starts at 1; "val" spans 5..8).
    const state = EditorState.create({
      doc,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 6),
    });
    const inBlock = selectAllOccurrencesInBlock(state);
    const codeScoped = selectAllOccurrences(state);
    expect(rangeCount(inBlock)).toBe(rangeCount(codeScoped));
  });

  /**
   * Declining beats silently widening: if there is no enclosing textblock there
   * is no block to scope to, and falling back to the whole document would be
   * the precise surprise this command exists to remove.
   */
  it("returns null rather than widening when no textblock encloses the caret", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("x")])]);
    const state = EditorState.create({
      doc,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 1),
    });
    // A doc-level resolve has depth 0 — force it by asking at position 0.
    const atDocLevel = Object.create(state) as EditorState;
    Object.defineProperty(atDocLevel, "selection", {
      value: { from: 0, to: 0, ranges: [] },
    });
    expect(selectAllOccurrencesInBlock(atDocLevel)).toBeNull();
  });

  it("returns null for an empty block with no word under the caret", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [])]);
    const state = EditorState.create({
      doc,
      plugins: [multiCursorPlugin()],
      selection: TextSelection.create(doc, 1),
    });
    expect(selectAllOccurrencesInBlock(state)).toBeNull();
  });
});
