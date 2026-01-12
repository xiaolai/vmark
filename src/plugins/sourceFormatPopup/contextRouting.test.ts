/**
 * Source Mode Context Routing Tests
 *
 * Tests for adapting source cursor context to shared toolbar intent resolver.
 * Verifies that source mode produces the same routing outcomes after unification.
 */

import { describe, it, expect } from "vitest";
import { adaptSourceContext, routeSourceContext } from "./sourceContextAdapter";
import type { CursorContext as SourceCursorContext } from "@/types/cursorContext";

// Helper to create minimal source context
function createSourceContext(
  overrides: Partial<SourceCursorContext> = {}
): SourceCursorContext {
  return {
    inCodeBlock: null,
    inBlockMath: null,
    inTable: null,
    inList: null,
    inBlockquote: null,
    inHeading: null,
    inLink: null,
    inImage: null,
    inInlineMath: null,
    inFootnote: null,
    activeFormats: [],
    formatRanges: [],
    innermostFormat: null,
    atLineStart: false,
    atBlankLine: false,
    inWord: null,
    contextMode: "inline-insert",
    nearSpace: false,
    nearPunctuation: false,
    hasSelection: false,
    selectionFrom: 0,
    selectionTo: 0,
    ...overrides,
  };
}

describe("adaptSourceContext", () => {
  describe("code block adaptation", () => {
    it("adapts code block context", () => {
      const sourceCtx = createSourceContext({
        inCodeBlock: { language: "typescript", nodePos: 100 },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inCodeBlock).toEqual({
        language: "typescript",
        from: 100,
        to: 100, // source mode doesn't have end position
      });
    });
  });

  describe("block math adaptation", () => {
    it("adapts block math context", () => {
      const sourceCtx = createSourceContext({
        inBlockMath: { nodePos: 50 },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inBlockMath).toEqual({
        from: 50,
        to: 50,
      });
    });
  });

  describe("table adaptation", () => {
    it("adapts table context", () => {
      const sourceCtx = createSourceContext({
        inTable: { row: 1, col: 2, isHeader: false, nodePos: 0 },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inTable).toEqual({
        row: 1,
        col: 2,
        totalRows: 0, // source mode doesn't track totals
        totalCols: 0,
      });
    });
  });

  describe("list adaptation", () => {
    it("adapts bullet list context", () => {
      const sourceCtx = createSourceContext({
        inList: { type: "bullet", depth: 2, nodePos: 10 },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inList).toEqual({
        listType: "bullet",
        depth: 2,
      });
    });

    it("adapts task list context", () => {
      const sourceCtx = createSourceContext({
        inList: { type: "task", depth: 1, nodePos: 0 },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inList).toEqual({
        listType: "task",
        depth: 1,
      });
    });
  });

  describe("blockquote adaptation", () => {
    it("adapts blockquote context", () => {
      const sourceCtx = createSourceContext({
        inBlockquote: { depth: 3, nodePos: 20 },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inBlockquote).toEqual({
        depth: 3,
      });
    });
  });

  describe("selection adaptation", () => {
    it("adapts selection info", () => {
      const sourceCtx = createSourceContext({
        hasSelection: true,
        selectionFrom: 10,
        selectionTo: 25,
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.hasSelection).toBe(true);
      expect(sharedCtx.selectionInfo).toEqual({
        from: 10,
        to: 25,
        text: "", // text not available without EditorView
      });
    });
  });

  describe("heading adaptation", () => {
    it("adapts heading context", () => {
      const sourceCtx = createSourceContext({
        inHeading: { level: 2, nodePos: 0 },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inHeading).toEqual({
        level: 2,
        lineStart: 0,
      });
    });
  });

  describe("link adaptation", () => {
    it("adapts link context", () => {
      const sourceCtx = createSourceContext({
        inLink: {
          href: "https://example.com",
          text: "click here",
          from: 0,
          to: 40,
          contentFrom: 1,
          contentTo: 11,
        },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inLink).toEqual({
        href: "https://example.com",
        text: "click here",
        from: 0,
        to: 40,
        contentFrom: 1,
        contentTo: 11,
      });
    });
  });

  describe("inline math adaptation", () => {
    it("adapts inline math context", () => {
      const sourceCtx = createSourceContext({
        inInlineMath: {
          from: 5,
          to: 15,
          contentFrom: 6,
          contentTo: 14,
        },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inInlineMath).toEqual({
        from: 5,
        to: 15,
        contentFrom: 6,
        contentTo: 14,
      });
    });
  });

  describe("footnote adaptation", () => {
    it("adapts footnote context", () => {
      const sourceCtx = createSourceContext({
        inFootnote: {
          label: "1",
          from: 0,
          to: 5,
          contentFrom: 2,
          contentTo: 3,
        },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inFootnote).toEqual({
        label: "1",
        from: 0,
        to: 5,
        contentFrom: 2,
        contentTo: 3,
      });
    });
  });

  describe("formatted range adaptation", () => {
    it("adapts innermost format context", () => {
      const sourceCtx = createSourceContext({
        innermostFormat: {
          type: "bold",
          from: 0,
          to: 10,
          contentFrom: 2,
          contentTo: 8,
        },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inFormattedRange).toEqual({
        markType: "bold",
        from: 0,
        to: 10,
        contentFrom: 2,
        contentTo: 8,
      });
    });
  });

  describe("word adaptation", () => {
    it("adapts word context", () => {
      const sourceCtx = createSourceContext({
        inWord: { from: 10, to: 20 },
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.inWord).toEqual({
        from: 10,
        to: 20,
        text: "",
      });
    });
  });

  describe("line start adaptation", () => {
    it("adapts atLineStart flag", () => {
      const sourceCtx = createSourceContext({
        atLineStart: true,
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.atLineStart).toBe(true);
    });
  });

  describe("context mode adaptation", () => {
    it("adapts inline-insert to insert", () => {
      const sourceCtx = createSourceContext({
        contextMode: "inline-insert",
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.contextMode).toBe("insert");
    });

    it("adapts block-insert to insert-block", () => {
      const sourceCtx = createSourceContext({
        contextMode: "block-insert",
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.contextMode).toBe("insert-block");
    });

    it("adapts format to insert (format mode handled via selection)", () => {
      const sourceCtx = createSourceContext({
        contextMode: "format",
      });

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.contextMode).toBe("insert");
    });
  });

  describe("surface flag", () => {
    it("sets surface to source", () => {
      const sourceCtx = createSourceContext();

      const sharedCtx = adaptSourceContext(sourceCtx);

      expect(sharedCtx.surface).toBe("source");
    });
  });
});

describe("routeSourceContext", () => {
  describe("priority order", () => {
    it("routes code block first", () => {
      const sourceCtx = createSourceContext({
        inCodeBlock: { language: "js", nodePos: 0 },
        hasSelection: true,
        selectionFrom: 5,
        selectionTo: 10,
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("code");
    });

    it("routes block math before table", () => {
      const sourceCtx = createSourceContext({
        inBlockMath: { nodePos: 0 },
        inTable: { row: 0, col: 0, isHeader: true, nodePos: 0 },
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("blockMath");
    });

    it("routes table before list", () => {
      const sourceCtx = createSourceContext({
        inTable: { row: 1, col: 2, isHeader: false, nodePos: 0 },
        inList: { type: "bullet", depth: 1, nodePos: 0 },
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("table");
    });

    it("routes list before blockquote", () => {
      const sourceCtx = createSourceContext({
        inList: { type: "ordered", depth: 1, nodePos: 0 },
        inBlockquote: { depth: 1, nodePos: 0 },
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("list");
    });

    it("routes blockquote before selection", () => {
      const sourceCtx = createSourceContext({
        inBlockquote: { depth: 2, nodePos: 0 },
        hasSelection: true,
        selectionFrom: 5,
        selectionTo: 15,
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("blockquote");
    });

    it("routes selection before formatted range", () => {
      const sourceCtx = createSourceContext({
        hasSelection: true,
        selectionFrom: 10,
        selectionTo: 20,
        innermostFormat: {
          type: "bold",
          from: 0,
          to: 30,
          contentFrom: 2,
          contentTo: 28,
        },
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("format");
    });

    it("routes formatted range to format (auto-select)", () => {
      const sourceCtx = createSourceContext({
        innermostFormat: {
          type: "italic",
          from: 5,
          to: 20,
          contentFrom: 6,
          contentTo: 19,
        },
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("format");
    });

    it("routes image to none (has own popup)", () => {
      const sourceCtx = createSourceContext({
        inImage: { src: "img.png", alt: "alt", from: 0, to: 20 },
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("none");
    });

    it("routes link to format (auto-select content)", () => {
      const sourceCtx = createSourceContext({
        inLink: {
          href: "https://example.com",
          text: "link",
          from: 0,
          to: 30,
          contentFrom: 1,
          contentTo: 5,
        },
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("format");
    });

    it("routes inline math to format (auto-select)", () => {
      const sourceCtx = createSourceContext({
        inInlineMath: {
          from: 0,
          to: 10,
          contentFrom: 1,
          contentTo: 9,
        },
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("inlineMath");
    });

    it("routes footnote to footnote intent", () => {
      const sourceCtx = createSourceContext({
        inFootnote: {
          label: "1",
          from: 0,
          to: 5,
          contentFrom: 2,
          contentTo: 3,
        },
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("footnote");
    });

    it("routes heading to heading intent", () => {
      const sourceCtx = createSourceContext({
        inHeading: { level: 3, nodePos: 0 },
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("heading");
    });

    it("routes line start to heading intent (level 0)", () => {
      const sourceCtx = createSourceContext({
        atLineStart: true,
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("heading");
      if (intent.type === "heading") {
        expect(intent.info.level).toBe(0);
      }
    });

    it("routes word to format (auto-select)", () => {
      const sourceCtx = createSourceContext({
        inWord: { from: 5, to: 12 },
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("format");
    });

    it("routes blank line to insert-block", () => {
      const sourceCtx = createSourceContext({
        atBlankLine: true,
        contextMode: "block-insert",
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("insert");
      if (intent.type === "insert") {
        expect(intent.contextMode).toBe("insert-block");
      }
    });

    it("routes otherwise to insert", () => {
      const sourceCtx = createSourceContext({
        contextMode: "inline-insert",
      });

      const intent = routeSourceContext(sourceCtx);

      expect(intent.type).toBe("insert");
      if (intent.type === "insert") {
        expect(intent.contextMode).toBe("insert");
      }
    });
  });
});
