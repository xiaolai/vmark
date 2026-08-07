// @vitest-environment node
/**
 * Tests for text transformations.
 */

import { describe, expect, it } from "vitest";
import {
  toUpperCase,
  toLowerCase,
  toTitleCase,
  toggleCase,
  removeBlankLines,
  moveLinesUp,
  moveLinesDown,
  duplicateLines,
  deleteLines,
  joinLines,
  sortLinesAscending,
  sortLinesDescending,
  getLinesInRange,
} from "./textTransformations";

describe("Case Transformations", () => {
  describe("toUpperCase", () => {
    it("converts text to uppercase", () => {
      expect(toUpperCase("hello")).toBe("HELLO");
      expect(toUpperCase("Hello World")).toBe("HELLO WORLD");
      expect(toUpperCase("123abc")).toBe("123ABC");
    });

    it("handles empty string", () => {
      expect(toUpperCase("")).toBe("");
    });

    it("preserves non-letter characters", () => {
      expect(toUpperCase("hello-world_123")).toBe("HELLO-WORLD_123");
    });
  });

  describe("toLowerCase", () => {
    it("converts text to lowercase", () => {
      expect(toLowerCase("HELLO")).toBe("hello");
      expect(toLowerCase("Hello World")).toBe("hello world");
      expect(toLowerCase("123ABC")).toBe("123abc");
    });

    it("handles empty string", () => {
      expect(toLowerCase("")).toBe("");
    });
  });

  describe("toTitleCase", () => {
    it("capitalizes first letter of each word", () => {
      expect(toTitleCase("hello world")).toBe("Hello World");
      expect(toTitleCase("HELLO WORLD")).toBe("HELLO WORLD"); // Already uppercase stays
      expect(toTitleCase("hello-world")).toBe("Hello-World");
    });

    it("handles single word", () => {
      expect(toTitleCase("hello")).toBe("Hello");
    });

    it("handles empty string", () => {
      expect(toTitleCase("")).toBe("");
    });

    it("treats apostrophes as word-internal (contractions)", () => {
      expect(toTitleCase("don't stop")).toBe("Don't Stop");
      expect(toTitleCase("it's fine")).toBe("It's Fine");
    });

    it("treats typographic apostrophes (U+2019) as word-internal", () => {
      expect(toTitleCase("don’t stop")).toBe("Don’t Stop");
    });

    it("capitalizes accented letters (Unicode-aware)", () => {
      expect(toTitleCase("état de l'art")).toBe("État De L'art");
    });

    it("leaves CJK text unchanged", () => {
      expect(toTitleCase("中文 文本")).toBe("中文 文本");
    });
  });

  describe("toggleCase", () => {
    it("converts mostly uppercase to lowercase", () => {
      expect(toggleCase("HELLO")).toBe("hello");
      expect(toggleCase("HELlo")).toBe("hello"); // 3 upper, 2 lower
    });

    it("converts mostly lowercase to uppercase", () => {
      expect(toggleCase("hello")).toBe("HELLO");
      expect(toggleCase("helLO")).toBe("HELLO"); // 2 upper, 3 lower
    });

    it("converts equal case to lowercase", () => {
      expect(toggleCase("HeLLo")).toBe("hello"); // 3 upper, 2 lower
    });

    it("handles empty string", () => {
      expect(toggleCase("")).toBe("");
    });
  });

  describe("removeBlankLines", () => {
    it("removes blank lines from text", () => {
      expect(removeBlankLines("line1\n\nline2")).toBe("line1\nline2");
      expect(removeBlankLines("line1\n\n\nline2")).toBe("line1\nline2");
    });

    it("removes lines with only whitespace", () => {
      expect(removeBlankLines("line1\n   \nline2")).toBe("line1\nline2");
      expect(removeBlankLines("line1\n\t\nline2")).toBe("line1\nline2");
    });

    it("preserves non-blank lines", () => {
      expect(removeBlankLines("line1\nline2\nline3")).toBe("line1\nline2\nline3");
    });

    it("handles text with no blank lines", () => {
      expect(removeBlankLines("no blank lines")).toBe("no blank lines");
    });

    it("handles empty string", () => {
      expect(removeBlankLines("")).toBe("");
    });

    it("handles text that is all blank lines", () => {
      expect(removeBlankLines("\n\n\n")).toBe("");
    });
  });
});

describe("Line Operations", () => {
  describe("getLinesInRange", () => {
    it("gets single line", () => {
      const text = "line1\nline2\nline3";
      const result = getLinesInRange(text, 6, 10); // "line2"
      expect(result.startLine).toBe(1);
      expect(result.endLine).toBe(1);
      expect(result.lines).toEqual(["line2"]);
    });

    it("gets multiple lines", () => {
      const text = "line1\nline2\nline3";
      // "line1\nline2\nline3" = positions 0-4 (line1), 5 (\n), 6-10 (line2), 11 (\n), 12-16 (line3)
      const result = getLinesInRange(text, 0, 10); // "line1" and "line2"
      expect(result.startLine).toBe(0);
      expect(result.endLine).toBe(1);
      expect(result.lines).toEqual(["line1", "line2"]);
    });
  });

  describe("moveLinesUp", () => {
    it("moves single line up", () => {
      const text = "line1\nline2\nline3";
      const result = moveLinesUp(text, 6, 10); // cursor in "line2"
      expect(result).not.toBeNull();
      expect(result!.newText).toBe("line2\nline1\nline3");
    });

    it("returns null when at top", () => {
      const text = "line1\nline2\nline3";
      const result = moveLinesUp(text, 0, 4); // cursor in "line1"
      expect(result).toBeNull();
    });

    it("moves multiple lines up", () => {
      const text = "line1\nline2\nline3\nline4";
      const result = moveLinesUp(text, 6, 17); // "line2" and "line3"
      expect(result).not.toBeNull();
      expect(result!.newText).toBe("line2\nline3\nline1\nline4");
    });
  });

  describe("moveLinesDown", () => {
    it("moves single line down", () => {
      const text = "line1\nline2\nline3";
      const result = moveLinesDown(text, 0, 4); // cursor in "line1"
      expect(result).not.toBeNull();
      expect(result!.newText).toBe("line2\nline1\nline3");
    });

    it("returns null when at bottom", () => {
      const text = "line1\nline2\nline3";
      const result = moveLinesDown(text, 12, 16); // cursor in "line3"
      expect(result).toBeNull();
    });
  });

  describe("duplicateLines", () => {
    it("duplicates single line", () => {
      const text = "line1\nline2\nline3";
      const result = duplicateLines(text, 6, 10); // cursor in "line2"
      expect(result.newText).toBe("line1\nline2\nline2\nline3");
    });

    it("duplicates multiple lines", () => {
      const text = "line1\nline2\nline3";
      const result = duplicateLines(text, 0, 10); // "line1" and "line2"
      expect(result.newText).toBe("line1\nline2\nline1\nline2\nline3");
    });
  });

  describe("deleteLines", () => {
    it("deletes single line", () => {
      const text = "line1\nline2\nline3";
      const result = deleteLines(text, 6, 10); // cursor in "line2"
      expect(result.newText).toBe("line1\nline3");
    });

    it("deletes multiple lines", () => {
      const text = "line1\nline2\nline3\nline4";
      const result = deleteLines(text, 6, 17); // "line2" and "line3"
      expect(result.newText).toBe("line1\nline4");
    });

    it("handles deleting last line", () => {
      const text = "line1\nline2";
      const result = deleteLines(text, 6, 10); // "line2"
      expect(result.newText).toBe("line1");
    });
  });

  describe("joinLines", () => {
    it("joins current line with next", () => {
      const text = "line1\nline2\nline3";
      const result = joinLines(text, 3, 3); // cursor in "line1"
      expect(result.newText).toBe("line1 line2\nline3");
    });

    it("joins multiple selected lines", () => {
      const text = "line1\nline2\nline3";
      const result = joinLines(text, 0, 17); // all lines
      expect(result.newText).toBe("line1 line2 line3");
    });

    it("trims leading whitespace when joining", () => {
      const text = "line1\n  line2\n    line3";
      const result = joinLines(text, 0, 23);
      expect(result.newText).toBe("line1 line2 line3");
    });
  });

  describe("sortLinesAscending", () => {
    it("sorts lines alphabetically ascending", () => {
      const text = "banana\napple\ncherry";
      const result = sortLinesAscending(text, 0, 19);
      expect(result.newText).toBe("apple\nbanana\ncherry");
    });

    it("handles single line", () => {
      const text = "only line";
      const result = sortLinesAscending(text, 0, 8);
      expect(result.newText).toBe("only line");
    });
  });

  describe("sortLinesDescending", () => {
    it("sorts lines alphabetically descending", () => {
      const text = "apple\nbanana\ncherry";
      const result = sortLinesDescending(text, 0, 19);
      expect(result.newText).toBe("cherry\nbanana\napple");
    });

    it("handles single line (no-op)", () => {
      const text = "only line";
      const result = sortLinesDescending(text, 0, 8);
      expect(result.newText).toBe("only line");
    });
  });

  describe("getLinesInRange - edge cases", () => {
    it("handles 'to' exactly at lineEnd+1 (newline boundary)", () => {
      const text = "line1\nline2\nline3";
      // lineEnd of line1 is 4, lineEnd+1 is 5
      // to=5 triggers the newline boundary case: to === lineEnd + 1
      const result = getLinesInRange(text, 0, 5);
      expect(result.startLine).toBe(0);
      expect(result.endLine).toBe(0);
      expect(result.lines).toEqual(["line1"]);
    });

    it("excludes the trailing line when a selection ends exactly at its start", () => {
      // "ab\ncd": selection [0,3) is "ab\n" — it ends at the start of "cd",
      // so only "ab" is a selected line (CodeMirror line-block semantics:
      // `to` is exclusive for non-empty selections).
      const text = "ab\ncd";
      const result = getLinesInRange(text, 0, 3);
      expect(result.startLine).toBe(0);
      expect(result.endLine).toBe(0);
      expect(result.lines).toEqual(["ab"]);
      expect(result.fullEnd).toBe(2);
    });

    it("handles 'to' beyond all lines", () => {
      const text = "line1\nline2";
      // 'to' beyond the document length
      const result = getLinesInRange(text, 0, 100);
      expect(result.endLine).toBe(1);
      expect(result.fullEnd).toBe(text.length);
    });
  });

  describe("getLinesInRange - collapsed cursor boundaries", () => {
    // "line1\nline2\nline3" — line starts at 0, 6, 12; length 17.
    const text = "line1\nline2\nline3";

    it("collapsed cursor at document start selects only the first line", () => {
      const result = getLinesInRange(text, 0, 0);
      expect(result.startLine).toBe(0);
      expect(result.endLine).toBe(0);
      expect(result.lines).toEqual(["line1"]);
    });

    it("collapsed cursor at the exact start of a middle line selects only that line", () => {
      // Regression (Codex audit): this used to leave startLine=0 and expand
      // endLine to the last line, making a line operation hit the whole doc.
      const result = getLinesInRange(text, 6, 6);
      expect(result.startLine).toBe(1);
      expect(result.endLine).toBe(1);
      expect(result.lines).toEqual(["line2"]);
      expect(result.fullStart).toBe(6);
      expect(result.fullEnd).toBe(11);
    });

    it("collapsed cursor at the exact start of the last line selects only that line", () => {
      const result = getLinesInRange(text, 12, 12);
      expect(result.startLine).toBe(2);
      expect(result.endLine).toBe(2);
      expect(result.lines).toEqual(["line3"]);
    });

    it("collapsed cursor on a newline position belongs to the line it terminates", () => {
      const result = getLinesInRange(text, 5, 5);
      expect(result.startLine).toBe(0);
      expect(result.endLine).toBe(0);
      expect(result.lines).toEqual(["line1"]);
    });

    it("collapsed cursor at end of document selects the last line", () => {
      const result = getLinesInRange(text, 17, 17);
      expect(result.startLine).toBe(2);
      expect(result.endLine).toBe(2);
    });

    it("collapsed cursor beyond the document clamps to the last line", () => {
      const result = getLinesInRange(text, 100, 100);
      expect(result.startLine).toBe(2);
      expect(result.endLine).toBe(2);
      expect(result.lines).toEqual(["line3"]);
    });

    it("non-empty selection ending at the start of a line excludes that line", () => {
      // Selection "line1\n" ends at the start of line2 — line2 not included.
      const result = getLinesInRange(text, 0, 6);
      expect(result.startLine).toBe(0);
      expect(result.endLine).toBe(0);
      expect(result.lines).toEqual(["line1"]);
    });

    it("deleteLines with cursor at start of a middle line deletes only that line", () => {
      const result = deleteLines(text, 6, 6);
      expect(result.newText).toBe("line1\nline3");
    });

    it("duplicateLines with cursor at start of a middle line duplicates only that line", () => {
      const result = duplicateLines(text, 6, 6);
      expect(result.newText).toBe("line1\nline2\nline2\nline3");
    });
  });

  describe("joinLines - edge cases", () => {
    it("returns unchanged text when single line at end of document", () => {
      const text = "first\nlast";
      // Cursor in "last" — no next line to join
      const result = joinLines(text, 6, 9);
      expect(result.newText).toBe(text);
      expect(result.newFrom).toBe(6);
      expect(result.newTo).toBe(9);
    });
  });

  describe("deleteLines - edge cases", () => {
    it("deletes first line (includes newline after)", () => {
      const text = "first\nsecond\nthird";
      const result = deleteLines(text, 0, 4);
      expect(result.newText).toBe("second\nthird");
    });

    it("handles deleting all text", () => {
      const text = "only";
      const result = deleteLines(text, 0, 3);
      expect(result.newText).toBe("");
      expect(result.newCursor).toBe(0);
    });
  });
});
