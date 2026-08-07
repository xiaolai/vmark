// @vitest-environment node
/**
 * Multi-Cursor Tab Escape Tests
 *
 * Tests Tab escape behavior with multiple cursors in WYSIWYG mode.
 * This is a critical interaction that requires special handling.
 */

import { describe, it, expect } from "vitest";
import { Schema, Node } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { canTabEscape } from "./tabEscape";
import { MultiSelection } from "@/plugins/multiCursor/MultiSelection";

// Minimal schema for testing
const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    code: {},
    link: { attrs: { href: { default: "" }, title: { default: null } } },
  },
});

function createState(doc: Node, ranges: SelectionRange[], primaryIndex = 0): EditorState {
  const state = EditorState.create({ doc, schema: testSchema });
  const multiSel = new MultiSelection(ranges, primaryIndex);
  return state.apply(state.tr.setSelection(multiSel));
}

function doc(...children: Node[]): Node {
  return testSchema.node("doc", null, children);
}

function p(...content: (Node | string)[]): Node {
  const children = content
    .filter((c) => c !== "")
    .map((c) => (typeof c === "string" ? testSchema.text(c) : c));
  return testSchema.node("paragraph", null, children.length > 0 ? children : undefined);
}

function boldText(text: string): Node {
  return testSchema.text(text, [testSchema.mark("bold")]);
}

function linkedText(text: string, href: string): Node {
  return testSchema.text(text, [testSchema.mark("link", { href })]);
}

describe("Tab Escape with Multi-Cursor", () => {
  describe("Multi-cursor escape behavior", () => {
    it("returns MultiSelection with updated cursor positions", () => {
      const document = doc(p("hello ", boldText("bold"), " world"));

      // Create multi-cursor with two positions
      const state = EditorState.create({ doc: document, schema: testSchema });
      const range1 = new SelectionRange(
        state.doc.resolve(9), // Inside "bold"
        state.doc.resolve(9)
      );
      const range2 = new SelectionRange(
        state.doc.resolve(15), // In "world"
        state.doc.resolve(15)
      );

      const multiState = createState(document, [range1, range2]);

      const result = canTabEscape(multiState);

      // Should return a MultiSelection with first cursor escaped
      expect(result).toBeInstanceOf(MultiSelection);
      expect((result as MultiSelection).ranges).toHaveLength(2);
      // First cursor should move to end of bold (position 11)
      expect((result as MultiSelection).ranges[0].$from.pos).toBe(11);
      // Second cursor should stay in place (can't escape)
      expect((result as MultiSelection).ranges[1].$from.pos).toBe(15);
    });

    it("cursor in mark escapes, cursor in plain text stays", () => {
      const document = doc(p("hello ", boldText("bold"), " world"));

      const state = EditorState.create({ doc: document, schema: testSchema });

      // Primary in bold, secondary in plain
      const range1 = new SelectionRange(
        state.doc.resolve(9), // Inside "bold"
        state.doc.resolve(9)
      );
      const range2 = new SelectionRange(
        state.doc.resolve(15), // In "world"
        state.doc.resolve(15)
      );

      const multiState = createState(document, [range1, range2], 0);

      const result = canTabEscape(multiState);

      expect(result).toBeInstanceOf(MultiSelection);
      const multiResult = result as MultiSelection;
      // First cursor escaped
      expect(multiResult.ranges[0].$from.pos).toBe(11);
      // Second cursor stayed
      expect(multiResult.ranges[1].$from.pos).toBe(15);
    });

    it("both cursors in marks both escape", () => {
      const document = doc(
        p(boldText("first"), " and ", boldText("second"))
      );

      const state = EditorState.create({ doc: document, schema: testSchema });

      // Both cursors inside bold text
      const range1 = new SelectionRange(
        state.doc.resolve(3), // Inside "first"
        state.doc.resolve(3)
      );
      const range2 = new SelectionRange(
        state.doc.resolve(15), // Inside "second"
        state.doc.resolve(15)
      );

      const multiState = createState(document, [range1, range2]);

      const result = canTabEscape(multiState);

      expect(result).toBeInstanceOf(MultiSelection);
      const multiResult = result as MultiSelection;
      // Both cursors should escape to end of their respective marks
      expect(multiResult.ranges[0].$from.pos).toBe(6);
      expect(multiResult.ranges[1].$from.pos).toBe(17);
    });

    it("multiple cursors in same link both escape (and merge)", () => {
      const document = doc(
        p("text ", linkedText("long link text", "url"), " more")
      );

      const state = EditorState.create({ doc: document, schema: testSchema });

      // Two cursors at different positions in same link
      const range1 = new SelectionRange(
        state.doc.resolve(8), // "long"
        state.doc.resolve(8)
      );
      const range2 = new SelectionRange(
        state.doc.resolve(12), // "link"
        state.doc.resolve(12)
      );

      const multiState = createState(document, [range1, range2]);

      const result = canTabEscape(multiState);

      expect(result).toBeInstanceOf(MultiSelection);
      const multiResult = result as MultiSelection;
      // When both cursors end up at the same position, MultiSelection normalizes/merges them
      // So we might end up with only one range
      expect(multiResult.ranges.length).toBeGreaterThanOrEqual(1);
      // All ranges should be at the end of link (position 20)
      multiResult.ranges.forEach(range => {
        expect(range.$from.pos).toBe(20);
      });
    });

    it("cursors in different mark types both escape", () => {
      const document = doc(
        p(boldText("bold"), " ", linkedText("link", "url"))
      );

      const state = EditorState.create({ doc: document, schema: testSchema });

      // One in bold, one in link
      const range1 = new SelectionRange(
        state.doc.resolve(3), // Inside "bold"
        state.doc.resolve(3)
      );
      const range2 = new SelectionRange(
        state.doc.resolve(8), // Inside "link"
        state.doc.resolve(8)
      );

      const multiState = createState(document, [range1, range2]);

      const result = canTabEscape(multiState);

      expect(result).toBeInstanceOf(MultiSelection);
      const multiResult = result as MultiSelection;
      // Bold cursor escapes to end of bold node
      expect(multiResult.ranges[0].$from.pos).toBe(5);
      // Link cursor escapes to end of link node
      expect(multiResult.ranges[1].$from.pos).toBe(10);
    });
  });

  describe("Edge cases with selection ranges", () => {
    it("one cursor, one selection (cursor escapes, selection unchanged)", () => {
      const document = doc(p("hello ", boldText("bold"), " world"));

      const state = EditorState.create({ doc: document, schema: testSchema });

      // Range 1: cursor in bold
      const range1 = new SelectionRange(
        state.doc.resolve(9),
        state.doc.resolve(9)
      );

      // Range 2: selection in "world"
      const range2 = new SelectionRange(
        state.doc.resolve(13),
        state.doc.resolve(17)
      );

      const multiState = createState(document, [range1, range2]);

      const result = canTabEscape(multiState);

      expect(result).toBeInstanceOf(MultiSelection);
      const multiResult = result as MultiSelection;
      // Cursor escapes
      expect(multiResult.ranges[0].$from.pos).toBe(11);
      // Selection stays unchanged
      expect(multiResult.ranges[1].$from.pos).toBe(13);
      expect(multiResult.ranges[1].$to.pos).toBe(17);
    });

    it("all selections (no cursors) returns null", () => {
      const document = doc(p("hello ", boldText("bold"), " world"));

      const state = EditorState.create({ doc: document, schema: testSchema });

      // Two selections (no cursor-only ranges)
      const range1 = new SelectionRange(
        state.doc.resolve(7),
        state.doc.resolve(11) // Select "bold"
      );

      const range2 = new SelectionRange(
        state.doc.resolve(13),
        state.doc.resolve(17) // Select "worl"
      );

      const multiState = createState(document, [range1, range2]);

      const result = canTabEscape(multiState);

      // No cursors to escape, only selections
      expect(result).toBeNull();
    });
  });

  describe("Integration with tabIndent handler", () => {
    it("documents current fallback behavior", () => {
      // When canTabEscape returns null for MultiSelection,
      // tabIndent falls through to space insertion
      //
      // Expected behavior for multi-cursor Tab:
      // 1. Insert spaces at each cursor position
      // 2. Replace each selection with spaces
      //
      // This is handled by the fallback code in tabIndent/tiptap.ts:
      //   if (!selection.empty) {
      //     tr.replaceSelectionWith(spaces);
      //   } else {
      //     tr.insertText(spaces);
      //   }
      //
      // BUT: This code doesn't know about MultiSelection!
      // It only handles selection.empty (single selection check)
    });
  });
});

describe("Recommended behavior for multi-cursor Tab escape", () => {
  describe("Design proposal", () => {
    it("Option 1: Escape ALL cursors in escapable contexts", () => {
      // For each cursor in MultiSelection:
      // - If cursor in escapable mark/link: jump to end
      // - If cursor in plain text: keep cursor position
      //
      // Example:
      // Cursor 1 in **bold** → jumps to end of bold
      // Cursor 2 in plain → stays in place
      // Cursor 3 in [link](url) → jumps to end of link
      //
      // Result: Cursors that CAN escape DO escape, others don't move
    });

    it("Option 2: Only escape if ALL cursors can escape", () => {
      // Check if all cursors are in escapable contexts
      // - If YES: escape all cursors
      // - If NO: do nothing (fall through to space insertion)
      //
      // This is more conservative but may be confusing UX
    });

    it("Option 3: Escape primary cursor only, keep others", () => {
      // Only check primary cursor for escape
      // - If can escape: move primary, keep others unchanged
      // - If cannot: fall through to space insertion for all
      //
      // This is simplest but asymmetric behavior
    });

    it("Option 4: Disable Tab escape for multi-cursor (current)", () => {
      // When MultiSelection detected: always fall through to spaces
      // Tab escape only works with single cursor
      //
      // This is current behavior (by accident, not design)
      // Clear and predictable, but limits power users
    });
  });

  describe("Preferred: Option 1 - Escape each cursor independently", () => {
    it("example: two cursors, one in mark", () => {
      // Input:
      //   hello **bo|ld** wo|rld
      //            ^1      ^2
      //
      // After Tab:
      //   hello **bold**| wo|rld
      //                ^1   ^2
      //
      // Cursor 1 escaped bold, cursor 2 stayed in place
    });

    it("example: both in marks", () => {
      // Input:
      //   **bo|ld** and *ita|lic*
      //       ^1          ^2
      //
      // After Tab:
      //   **bold**| and *italic*|
      //           ^1            ^2
    });

    it("example: link takes priority over mark", () => {
      // Input:
      //   **[bo|ld link](url)**
      //         ^cursor
      //
      // After Tab:
      //   **[bold link](url)**|
      //                       ^cursor
      //
      // Link escape takes priority over bold escape
    });
  });
});
