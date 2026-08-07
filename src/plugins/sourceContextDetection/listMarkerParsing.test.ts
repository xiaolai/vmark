// @vitest-environment node
/**
 * One list-marker grammar — parseListMarker.
 *
 * The parser is the single source of truth for CommonMark/GFM list markers:
 * bullets (-, *, +), ordered items (N. and N)), GFM task checkboxes on BOTH
 * bullet and ordered items, and the spaced thematic-break forms ("- - -",
 * "* * *") that are NOT list items.
 *
 * @module plugins/sourceContextDetection/listMarkerParsing.test
 */
import { describe, it, expect } from "vitest";
import { parseListMarker } from "./listMarkerParsing";

describe("parseListMarker", () => {
  describe("bullet markers", () => {
    it.each([
      { line: "- item", delimiter: "-" },
      { line: "* item", delimiter: "*" },
      { line: "+ item", delimiter: "+" },
    ])("parses $line", ({ line, delimiter }) => {
      const parsed = parseListMarker(line);
      expect(parsed).not.toBeNull();
      expect(parsed!.kind).toBe("bullet");
      expect(parsed!.delimiter).toBe(delimiter);
      expect(parsed!.number).toBeNull();
      expect(parsed!.isTask).toBe(false);
      expect(parsed!.checked).toBeNull();
      expect(parsed!.content).toBe("item");
      expect(parsed!.prefix).toBe(line.slice(0, 2));
    });

    it("captures indentation in indent, prefix, and contentCol", () => {
      const parsed = parseListMarker("    - nested")!;
      expect(parsed.indent).toBe("    ");
      expect(parsed.prefix).toBe("    - ");
      expect(parsed.contentCol).toBe(6);
    });
  });

  describe("ordered markers", () => {
    it("parses a dot delimiter", () => {
      const parsed = parseListMarker("1. item")!;
      expect(parsed.kind).toBe("ordered");
      expect(parsed.delimiter).toBe(".");
      expect(parsed.number).toBe(1);
      expect(parsed.content).toBe("item");
      expect(parsed.prefix).toBe("1. ");
    });

    it("parses a close-paren delimiter (CommonMark)", () => {
      const parsed = parseListMarker("1) item")!;
      expect(parsed.kind).toBe("ordered");
      expect(parsed.delimiter).toBe(")");
      expect(parsed.number).toBe(1);
      expect(parsed.content).toBe("item");
    });

    it("parses multi-digit numbers", () => {
      expect(parseListMarker("123. item")!.number).toBe(123);
    });

    it("rejects numbers longer than nine digits (CommonMark cap)", () => {
      expect(parseListMarker("1234567890. item")).toBeNull();
    });
  });

  describe("task checkboxes", () => {
    it("parses an unchecked bullet task", () => {
      const parsed = parseListMarker("- [ ] todo")!;
      expect(parsed.isTask).toBe(true);
      expect(parsed.checked).toBe(false);
      expect(parsed.checkboxChar).toBe(" ");
      expect(parsed.prefix).toBe("- [ ] ");
      expect(parsed.content).toBe("todo");
    });

    it("parses a checked bullet task", () => {
      const parsed = parseListMarker("- [x] done")!;
      expect(parsed.checked).toBe(true);
      expect(parsed.checkboxChar).toBe("x");
    });

    it("preserves an uppercase checkbox char", () => {
      const parsed = parseListMarker("- [X] done")!;
      expect(parsed.checked).toBe(true);
      expect(parsed.checkboxChar).toBe("X");
    });

    it("parses an ORDERED task (valid GFM)", () => {
      const parsed = parseListMarker("1. [x] done")!;
      expect(parsed.kind).toBe("ordered");
      expect(parsed.number).toBe(1);
      expect(parsed.isTask).toBe(true);
      expect(parsed.checked).toBe(true);
      expect(parsed.prefix).toBe("1. [x] ");
      expect(parsed.content).toBe("done");
    });

    it("parses a close-paren ordered task", () => {
      const parsed = parseListMarker("2) [ ] later")!;
      expect(parsed.isTask).toBe(true);
      expect(parsed.checked).toBe(false);
      expect(parsed.content).toBe("later");
    });

    it("keeps a checkbox without trailing space as plain content", () => {
      const parsed = parseListMarker("- [x]")!;
      expect(parsed.isTask).toBe(false);
      expect(parsed.content).toBe("[x]");
    });
  });

  describe("content column", () => {
    it("is the column after the marker and its spaces, before any checkbox", () => {
      // CommonMark: the checkbox is part of the item's paragraph, so a
      // continuation line only needs to reach the column after "- ".
      expect(parseListMarker("- [ ] task")!.contentCol).toBe(2);
      expect(parseListMarker("10. item")!.contentCol).toBe(4);
      expect(parseListMarker("  - item")!.contentCol).toBe(4);
    });
  });

  describe("non-markers", () => {
    it.each(["plain text", "", "# heading", "> quote", "-nospace", "1.nospace", "-", "10)"])(
      "returns null for %j",
      (line) => {
        expect(parseListMarker(line)).toBeNull();
      },
    );
  });

  describe("thematic breaks are not list items", () => {
    it.each(["---", "***", "___", "- - -", "* * *", "-  -  -", " - - -", "   * * *", "- - - - ", "-\t-\t-"])(
      "rejects %j",
      (line) => {
        expect(parseListMarker(line)).toBeNull();
      },
    );

    it("still parses a bullet whose content merely starts with a dash", () => {
      const parsed = parseListMarker("- - x");
      expect(parsed).not.toBeNull();
      expect(parsed!.content).toBe("- x");
    });
  });
});
