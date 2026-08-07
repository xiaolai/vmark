// @vitest-environment node
/**
 * commands.bounds.test.ts
 *
 * Covers the two branches in selectNextOccurrence (line 104) and
 * selectAllOccurrences (line 180) where getWordAtCursor returns a word
 * that straddles or is outside the current code block bounds.
 *
 * These branches are unreachable with a real editor (a word at cursor is
 * always inside the node that contains the cursor), so we mock getWordAtCursor
 * to return out-of-bounds positions.
 */

import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";

// Mock textSearch BEFORE importing commands so hoisting works correctly.
vi.mock("../textSearch", () => ({
  getWordAtCursor: vi.fn(),
  getSelectionText: vi.fn(() => ""),
  findAllOccurrences: vi.fn(() => []),
}));

import { selectNextOccurrence, selectAllOccurrences } from "../commands";
import { getWordAtCursor } from "../textSearch";
import { multiCursorPlugin } from "../multiCursorPlugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    codeBlock: { content: "text*", group: "block" },
    text: { inline: true },
  },
});

function createCodeBlockState(code: string, cursorPos: number): EditorState {
  const doc = schema.node("doc", null, [
    schema.node("codeBlock", null, code ? [schema.text(code)] : []),
  ]);
  return EditorState.create({
    doc,
    schema,
    plugins: [multiCursorPlugin()],
    selection: TextSelection.create(doc, cursorPos),
  });
}

describe("commands — word outside code block bounds branches", () => {
  describe("selectNextOccurrence — line 104: word straddles code block boundary", () => {
    it("returns null when getWordAtCursor word.from is before code block bounds.from", () => {
      // Code block content starts at pos 1. Mock word.from = 0 (outside).
      vi.mocked(getWordAtCursor).mockReturnValue({ from: 0, to: 5, text: "hello" });

      // Cursor at pos 3 inside "hello world" code block
      const state = createCodeBlockState("hello world", 3);
      const result = selectNextOccurrence(state);

      // bounds.from = 1, word.from = 0 < 1 → returns null (line 104)
      expect(result).toBeNull();
    });

    it("returns null when getWordAtCursor word.to is after code block bounds.to", () => {
      // Code block "hello" spans pos 1-6. Mock word.to beyond bounds.to.
      vi.mocked(getWordAtCursor).mockReturnValue({ from: 1, to: 100, text: "hello" });

      const state = createCodeBlockState("hello", 2);
      const result = selectNextOccurrence(state);

      // bounds.to = 6, word.to = 100 > 6 → returns null (line 104)
      expect(result).toBeNull();
    });
  });

  describe("selectAllOccurrences — line 180: word straddles code block boundary", () => {
    it("returns null when getWordAtCursor word.from is before code block bounds.from", () => {
      vi.mocked(getWordAtCursor).mockReturnValue({ from: 0, to: 5, text: "hello" });

      const state = createCodeBlockState("hello world", 3);
      const result = selectAllOccurrences(state);

      // bounds.from = 1, word.from = 0 < 1 → returns null (line 180)
      expect(result).toBeNull();
    });

    it("returns null when getWordAtCursor word.to is after code block bounds.to", () => {
      vi.mocked(getWordAtCursor).mockReturnValue({ from: 1, to: 100, text: "hello" });

      const state = createCodeBlockState("hello", 2);
      const result = selectAllOccurrences(state);

      // bounds.to = 6, word.to = 100 > 6 → returns null (line 180)
      expect(result).toBeNull();
    });
  });
});
