/**
 * AI Suggestion position remapping tests (audit H8).
 *
 * Suggestions store absolute from/to positions. When the user edits the
 * document while suggestions are pending, those positions must be remapped
 * through the transaction mapping — otherwise accept/decorations target the
 * wrong text. Suggestions whose range content is directly edited are
 * dismissed instead of remapped.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { AiSuggestion } from "../types";
import { computeSuggestionRemap } from "../tiptap";
import { useAiSuggestionStore, resetAiSuggestionStore } from "@/stores/aiStore";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

function createState(text: string): EditorState {
  return EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, text ? [schema.text(text)] : []),
    ]),
  });
}

function makeSuggestion(overrides: Partial<AiSuggestion> = {}): AiSuggestion {
  return {
    id: "s-1",
    tabId: "tab-1",
    type: "replace",
    from: 7,
    to: 12,
    newContent: "there",
    createdAt: 0,
    ...overrides,
  };
}

function remapOne(suggestion: AiSuggestion, tr: Transaction) {
  const updates = computeSuggestionRemap([suggestion], tr.mapping);
  expect(updates).toHaveLength(1);
  return updates[0];
}

describe("computeSuggestionRemap", () => {
  // Doc: <p>hello world</p> — "hello world" occupies positions 1..12,
  // "world" is [7, 12).
  it("shifts a range when text is inserted before it", () => {
    const state = createState("hello world");
    const tr = state.tr.insertText("big ", 7);
    const update = remapOne(makeSuggestion(), tr);
    expect(update.range).toEqual({ from: 11, to: 16 });
  });

  it("shifts a range when text is deleted before it", () => {
    const state = createState("hello world");
    const tr = state.tr.delete(1, 4); // delete "hel"
    const update = remapOne(makeSuggestion(), tr);
    expect(update.range).toEqual({ from: 4, to: 9 });
  });

  it("dismisses when an edit lands inside the range", () => {
    const state = createState("hello world");
    const tr = state.tr.insertText("X", 9); // inside "world"
    const update = remapOne(makeSuggestion(), tr);
    expect(update.range).toBeNull();
  });

  it("dismisses when a deletion covers the range", () => {
    const state = createState("hello world");
    const tr = state.tr.delete(5, 12); // deletes " world"
    const update = remapOne(makeSuggestion(), tr);
    expect(update.range).toBeNull();
  });

  it("keeps a range untouched by edits after it", () => {
    const state = createState("hello world");
    const tr = state.tr.insertText("!", 12); // after "world"... at boundary
    const update = remapOne(makeSuggestion({ from: 1, to: 6 }), tr);
    expect(update.range).toEqual({ from: 1, to: 6 });
  });

  it("shifts an insert-point suggestion when typing before it", () => {
    const state = createState("hello world");
    const tr = state.tr.insertText("abc", 2);
    const update = remapOne(makeSuggestion({ type: "insert", from: 7, to: 7 }), tr);
    expect(update.range).toEqual({ from: 10, to: 10 });
  });

  it("keeps an insert-point suggestion when typing exactly at it", () => {
    const state = createState("hello world");
    const tr = state.tr.insertText("xy", 7);
    const update = remapOne(makeSuggestion({ type: "insert", from: 7, to: 7 }), tr);
    // Point survives; lands after the typed text.
    expect(update.range).toEqual({ from: 9, to: 9 });
  });

  it("dismisses an insert-point suggestion inside a deleted region", () => {
    const state = createState("hello world");
    const tr = state.tr.delete(5, 10); // point 7 is inside
    const update = remapOne(makeSuggestion({ type: "insert", from: 7, to: 7 }), tr);
    expect(update.range).toBeNull();
  });

  it("whole-document replace (wholeDoc flag) survives edits and tracks `to`", () => {
    const state = createState("hello world");
    const docSize = state.doc.content.size;
    const tr = state.tr.insertText("more ", 7);
    const update = remapOne(
      makeSuggestion({ wholeDoc: true, from: 0, to: docSize, newContent: "rewrite" }),
      tr
    );
    expect(update.range).not.toBeNull();
    expect(update.range?.from).toBe(0);
    expect(update.range?.to).toBe(docSize + 5);
  });

  it("a first-block suggestion at from=0 WITHOUT wholeDoc is dismissed when edited (cross-model review)", () => {
    // from===0 is not a whole-doc sentinel — a block suggestion can start
    // at 0; editing inside it must dismiss it like any other range.
    const state = createState("hello world");
    const tr = state.tr.insertText("X", 3); // inside [0, 6)
    const update = remapOne(makeSuggestion({ from: 0, to: 6 }), tr);
    expect(update.range).toBeNull();
  });

  it("remaps through multi-step transactions", () => {
    const state = createState("hello world");
    const tr = state.tr.insertText("A", 1).insertText("B", 3);
    // Both insertions before "world" [7,12) -> shifted by 2.
    const update = remapOne(makeSuggestion(), tr);
    expect(update.range).toEqual({ from: 9, to: 14 });
  });
});

describe("useAiSuggestionStore.updateSuggestionRanges", () => {
  beforeEach(() => {
    resetAiSuggestionStore();
  });

  function addSuggestion(from: number, to: number): string {
    return useAiSuggestionStore.getState().addSuggestion({
      tabId: "tab-1",
      type: "replace",
      from,
      to,
      newContent: "x",
    });
  }

  it("moves suggestion ranges", () => {
    const id = addSuggestion(7, 12);
    useAiSuggestionStore
      .getState()
      .updateSuggestionRanges([{ id, range: { from: 11, to: 16 } }]);
    const s = useAiSuggestionStore.getState().getSuggestion(id);
    expect(s?.from).toBe(11);
    expect(s?.to).toBe(16);
  });

  it("dismisses suggestions with null ranges and refocuses", () => {
    const id1 = addSuggestion(7, 12);
    const id2 = addSuggestion(20, 25);
    // id1 was auto-focused on add.
    expect(useAiSuggestionStore.getState().focusedSuggestionId).toBe(id1);
    useAiSuggestionStore
      .getState()
      .updateSuggestionRanges([{ id: id1, range: null }]);
    const state = useAiSuggestionStore.getState();
    expect(state.getSuggestion(id1)).toBeUndefined();
    expect(state.getSuggestion(id2)).toBeDefined();
    expect(state.focusedSuggestionId).toBe(id2);
  });

  it("ignores updates for unknown ids", () => {
    const id = addSuggestion(7, 12);
    useAiSuggestionStore
      .getState()
      .updateSuggestionRanges([{ id: "missing", range: null }]);
    expect(useAiSuggestionStore.getState().getSuggestion(id)).toBeDefined();
  });

  it("no-ops when nothing changed", () => {
    const id = addSuggestion(7, 12);
    const before = useAiSuggestionStore.getState().suggestions;
    useAiSuggestionStore
      .getState()
      .updateSuggestionRanges([{ id, range: { from: 7, to: 12 } }]);
    expect(useAiSuggestionStore.getState().suggestions).toBe(before);
  });
});

describe("accept after edit (integration)", () => {
  beforeEach(() => {
    resetAiSuggestionStore();
  });

  it("applies the suggestion to the intended text after typing before it", async () => {
    const { applySuggestionToTr } = await import("../tiptap");
    let state = createState("hello world");
    const suggestion = makeSuggestion(); // replace "world" [7,12) with "there"

    // User types "big " before "world" while the suggestion is pending.
    const editTr = state.tr.insertText("big ", 7);
    const [update] = computeSuggestionRemap([suggestion], editTr.mapping);
    state = state.apply(editTr);
    expect(state.doc.textContent).toBe("hello big world");

    expect(update.range).not.toBeNull();
    const moved = { ...suggestion, ...update.range! };
    const acceptTr = applySuggestionToTr(state, state.tr, moved);
    const finalState = state.apply(acceptTr);
    expect(finalState.doc.textContent).toBe("hello big there");
  });
});
