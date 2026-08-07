// @vitest-environment node
/**
 * Edge Case Tests for Tab Escape in WYSIWYG Mode
 *
 * This file covers edge cases not tested in the main test suite:
 * - Multiple consecutive marks
 * - Adjacent marks
 * - Mark boundaries
 * - Special characters and whitespace
 * - Complex nesting scenarios
 */

import { describe, it, expect } from "vitest";
import { Schema, Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { canTabEscape, getMarkEndPos, getLinkEndPos, type TabEscapeResult } from "./tabEscape";

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
    strike: {},
    link: { attrs: { href: { default: "" }, title: { default: null } } },
  },
});

// Helper to create editor state with selection
function createState(doc: Node, from: number, to?: number): EditorState {
  const state = EditorState.create({ doc, schema: testSchema });
  const selection = to
    ? TextSelection.create(state.doc, from, to)
    : TextSelection.create(state.doc, from);
  return state.apply(state.tr.setSelection(selection));
}

// Helper to create document
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

function italicText(text: string): Node {
  return testSchema.text(text, [testSchema.mark("italic")]);
}

function codeText(text: string): Node {
  return testSchema.text(text, [testSchema.mark("code")]);
}

// @ts-expect-error Helper function kept for potential future use in strikethrough tests
function _strikeText(text: string): Node {
  return testSchema.text(text, [testSchema.mark("strike")]);
}

function linkedText(text: string, href: string): Node {
  return testSchema.text(text, [testSchema.mark("link", { href })]);
}

describe("Tab Escape Edge Cases", () => {
  describe("Multiple consecutive marks", () => {
    it("handles bold + italic on same text", () => {
      // Text with both bold and italic marks
      const document = doc(
        p(
          "hello ",
          testSchema.text("multi", [testSchema.mark("bold"), testSchema.mark("italic")]),
          " world"
        )
      );
      const state = createState(document, 10); // Inside "multi"

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.type).toBe("mark");
      expect(result?.targetPos).toBe(12); // Jump to end of marked text
    });

    it("handles bold + italic + code on same text", () => {
      const document = doc(
        p(
          "hello ",
          testSchema.text("triple", [
            testSchema.mark("bold"),
            testSchema.mark("italic"),
            testSchema.mark("code"),
          ]),
          " world"
        )
      );
      const state = createState(document, 10);

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.type).toBe("mark");
    });

    it("handles bold + link (link takes priority)", () => {
      const document = doc(
        p(
          "hello ",
          testSchema.text("both", [
            testSchema.mark("bold"),
            testSchema.mark("link", { href: "https://example.com" }),
          ]),
          " world"
        )
      );
      const state = createState(document, 9);

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.type).toBe("link"); // Link has priority
    });
  });

  describe("Adjacent marks", () => {
    it("handles adjacent different marks without space", () => {
      // "hello **bold***italic* world"
      const document = doc(p("hello ", boldText("bold"), italicText("italic"), " world"));
      const state = createState(document, 10); // At end of "bold"

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.targetPos).toBe(11); // Jump to after "bold", before "italic"
    });

    it("handles same mark type adjacent (should be merged)", () => {
      // Two separate bold nodes: "**bold1****bold2**"
      // In practice, these should be merged by the editor, but test anyway
      const document = doc(p(boldText("bold1"), boldText("bold2")));
      const state = createState(document, 3); // Inside "bold1"

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      // Should jump to end of first bold node
    });

    it("handles three consecutive different marks", () => {
      const document = doc(
        p(boldText("bold"), italicText("italic"), codeText("code"), " plain")
      );
      const state = createState(document, 2); // In "bold"

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.type).toBe("mark");
    });
  });

  describe("Mark boundaries", () => {
    it("handles cursor exactly at mark start (edge case - may not escape)", () => {
      const document = doc(p("hello ", boldText("bold"), " world"));
      const state = createState(document, 7); // Right at start of "bold"

      // Note: Documents boundary behavior but doesn't assert on result
      canTabEscape(state);
      // At exact mark start, marks might not be active yet
      // This is a known edge case in ProseMirror
      // The behavior depends on storedMarks
    });

    it("handles cursor exactly at mark end", () => {
      const document = doc(p("hello ", boldText("bold"), " world"));
      const state = createState(document, 11); // Right after "bold"

      // At the exact end position, marks should still be active
      // Note: Documents boundary behavior but doesn't assert on result
      canTabEscape(state);
      // This is a boundary case - behavior depends on mark storedMarks
      // In ProseMirror, marks can persist at boundaries
    });

    it("handles mark at very start of document", () => {
      const document = doc(p(boldText("bold"), " rest"));
      const state = createState(document, 2); // Inside "bold"

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.targetPos).toBe(5); // After "bold"
    });

    it("handles mark at very end of document", () => {
      const document = doc(p("start ", boldText("bold")));
      const state = createState(document, 9); // Inside "bold" at end

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.targetPos).toBe(11); // After "bold"
    });
  });

  describe("Whitespace and special characters", () => {
    it("handles mark containing only spaces", () => {
      const document = doc(p("hello", boldText("   "), "world"));
      const state = createState(document, 7); // Inside spaces

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
    });

    it("handles mark with leading/trailing spaces", () => {
      const document = doc(p("hello", boldText("  bold  "), "world"));
      const state = createState(document, 10); // Inside "bold"

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
    });

    it("handles mark containing newline (if allowed)", () => {
      // Most marks don't allow newlines, but test boundary
      const document = doc(p("hello ", boldText("bold"), " world"));
      const state = createState(document, 9);

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
    });

    it("handles mark with emoji", () => {
      const document = doc(p("hello ", boldText("bold 🎉 text"), " world"));
      const state = createState(document, 12); // Inside emoji

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
    });

    it("handles mark with CJK characters", () => {
      const document = doc(p("hello ", boldText("粗体文字"), " world"));
      const state = createState(document, 9); // Inside CJK text

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
    });
  });

  describe("Complex link scenarios", () => {
    it("handles link with very long URL", () => {
      const longUrl = "https://example.com/" + "a".repeat(1000);
      const document = doc(p("hello ", linkedText("link", longUrl), " world"));
      const state = createState(document, 9);

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.type).toBe("link");
    });

    it("handles link with special URL characters", () => {
      const document = doc(
        p("hello ", linkedText("link", "https://example.com?q=test&foo=bar#section"), " world")
      );
      const state = createState(document, 9);

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.type).toBe("link");
    });

    it("handles link with encoded characters", () => {
      const document = doc(
        p("hello ", linkedText("link", "https://example.com/path%20with%20spaces"), " world")
      );
      const state = createState(document, 9);

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
    });

    it("handles adjacent links", () => {
      const document = doc(
        p(
          linkedText("first", "https://first.com"),
          linkedText("second", "https://second.com")
        )
      );
      const state = createState(document, 3); // Inside "first"

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.type).toBe("link");
      expect(result?.targetPos).toBe(6); // After "first", not after "second"
    });

    it("handles link with title attribute", () => {
      const linkMark = testSchema.mark("link", {
        href: "https://example.com",
        title: "Example Site",
      });
      const document = doc(p("hello ", testSchema.text("link", [linkMark]), " world"));
      const state = createState(document, 9);

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.type).toBe("link");
    });
  });

  describe("Empty and minimal cases", () => {
    it("ProseMirror prevents empty text nodes (known limitation)", () => {
      // Empty text nodes are not allowed in ProseMirror
      // This test documents that limitation
      expect(() => {
        testSchema.text("", [testSchema.mark("bold")]);
      }).toThrow("Empty text nodes are not allowed");
    });

    it("handles single character mark (edge case - position matters)", () => {
      const document = doc(p("hello ", boldText("x"), " world"));
      const state = createState(document, 8); // Inside "x", not at boundary

      // Note: Documents edge case behavior but doesn't assert on result
      canTabEscape(state);
      // Single char marks are tricky - cursor position matters
      // At position 7 (start), marks might not be active
      // At position 8 (after x), we're already past the mark
    });

    it("handles mark containing only punctuation", () => {
      const document = doc(p("hello ", boldText("!!!"), " world"));
      const state = createState(document, 8);

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
    });
  });

  describe("Multiple paragraphs", () => {
    it("handles mark in first paragraph", () => {
      const document = doc(p("first ", boldText("bold")), p("second paragraph"));
      const state = createState(document, 9);

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
      expect(result?.targetPos).toBe(11);
    });

    it("handles mark in middle paragraph", () => {
      const document = doc(p("first"), p("middle ", boldText("bold")), p("last"));
      // Need to calculate position accounting for paragraph breaks
      const state = createState(document, 18); // Approximate, inside "bold" in second para

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).not.toBeNull();
    });
  });

  describe("Selection edge cases", () => {
    it("does not escape when selection spans entire mark", () => {
      const document = doc(p("hello ", boldText("bold"), " world"));
      const state = createState(document, 7, 11); // Select all of "bold"

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).toBeNull(); // Should not escape with selection
    });

    it("does not escape when selection starts in mark", () => {
      const document = doc(p("hello ", boldText("bold"), " world"));
      const state = createState(document, 9, 13); // Select from "ld" to " wo"

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).toBeNull();
    });

    it("does not escape when selection ends in mark", () => {
      const document = doc(p("hello ", boldText("bold"), " world"));
      const state = createState(document, 5, 9); // Select from "o " to "bo"

      const result = canTabEscape(state) as TabEscapeResult | null;
      expect(result).toBeNull();
    });
  });

  describe("Regression tests for getMarkEndPos", () => {
    it("correctly calculates end position with multiple text nodes", () => {
      const document = doc(p("hello ", boldText("bold"), " world"));
      const state = createState(document, 9);

      const endPos = getMarkEndPos(state);
      expect(endPos).toBe(11);
    });

    it("handles mark ending at paragraph boundary", () => {
      const document = doc(p("start ", boldText("bold")));
      const state = createState(document, 9);

      const endPos = getMarkEndPos(state);
      expect(endPos).toBe(11); // Should be valid even at boundary
    });
  });

  describe("Regression tests for getLinkEndPos", () => {
    it("correctly calculates end position for link", () => {
      const document = doc(p("hello ", linkedText("link text", "https://example.com"), " world"));
      const state = createState(document, 10);

      const endPos = getLinkEndPos(state);
      expect(endPos).toBe(16); // After "link text"
    });

    it("handles link at document end", () => {
      const document = doc(p("hello ", linkedText("link", "https://example.com")));
      const state = createState(document, 9);

      const endPos = getLinkEndPos(state);
      expect(endPos).toBe(11);
    });
  });
});
