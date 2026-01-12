/**
 * Tiptap Routing Tests
 *
 * Tests for routing toolbar intents to the correct store actions.
 * Uses mocked intents to test routing logic without DOM dependencies.
 */

import { describe, it, expect } from "vitest";
import { routeToolbarIntent } from "./tiptapRouting";
import type { ToolbarIntent } from "@/plugins/toolbarContext/types";

describe("routeToolbarIntent", () => {
  describe("code block routing", () => {
    it("routes code intent to openCodeToolbar", () => {
      const intent: ToolbarIntent = {
        type: "code",
        info: { language: "typescript", from: 0, to: 100 },
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openCodeToolbar");
      expect(result.payload).toEqual({ language: "typescript", from: 0, to: 100 });
    });
  });

  describe("table routing", () => {
    it("routes table intent to openMergedToolbar with table context", () => {
      const intent: ToolbarIntent = {
        type: "table",
        info: { row: 1, col: 2, totalRows: 3, totalCols: 4 },
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openMergedToolbar");
      expect(result).toHaveProperty("payload.type", "table");
    });
  });

  describe("list routing", () => {
    it("routes list intent to openMergedToolbar with list context", () => {
      const intent: ToolbarIntent = {
        type: "list",
        info: { listType: "bullet", depth: 1 },
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openMergedToolbar");
      expect(result).toHaveProperty("payload.type", "list");
    });
  });

  describe("blockquote routing", () => {
    it("routes blockquote intent to openMergedToolbar with blockquote context", () => {
      const intent: ToolbarIntent = {
        type: "blockquote",
        info: { depth: 2 },
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openMergedToolbar");
      expect(result).toHaveProperty("payload.type", "blockquote");
    });
  });

  describe("format routing", () => {
    it("routes format intent to openToolbar with format mode", () => {
      const intent: ToolbarIntent = {
        type: "format",
        selection: { from: 10, to: 20, text: "selected" },
        autoSelected: false,
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openToolbar");
      expect(result).toHaveProperty("payload.contextMode", "format");
    });

    it("preserves originalCursorPos for auto-selected format", () => {
      const intent: ToolbarIntent = {
        type: "format",
        selection: { from: 10, to: 20, text: "word" },
        autoSelected: true,
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openToolbar");
      expect(result).toHaveProperty("payload.autoSelected", true);
    });
  });

  describe("link routing", () => {
    it("routes link intent to openLinkPopup", () => {
      const intent: ToolbarIntent = {
        type: "link",
        info: {
          href: "https://example.com",
          text: "click here",
          from: 0,
          to: 30,
          contentFrom: 1,
          contentTo: 10,
        },
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openLinkPopup");
      expect(result).toHaveProperty("payload.href", "https://example.com");
    });
  });

  describe("image routing", () => {
    it("routes image intent to openImagePopup", () => {
      const intent: ToolbarIntent = {
        type: "image",
        info: { src: "image.png", alt: "alt text", from: 0, to: 20 },
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openImagePopup");
    });
  });

  describe("heading routing", () => {
    it("routes heading intent to openHeadingToolbar", () => {
      const intent: ToolbarIntent = {
        type: "heading",
        info: { level: 2, nodePos: 100 },
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openHeadingToolbar");
      expect(result).toHaveProperty("payload.level", 2);
    });

    it("routes heading level 0 (paragraph line start) to openHeadingToolbar", () => {
      const intent: ToolbarIntent = {
        type: "heading",
        info: { level: 0 },
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openHeadingToolbar");
      expect(result).toHaveProperty("payload.level", 0);
    });
  });

  describe("insert routing", () => {
    it("routes insert intent to openToolbar with insert mode", () => {
      const intent: ToolbarIntent = {
        type: "insert",
        contextMode: "insert",
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openToolbar");
      expect(result).toHaveProperty("payload.contextMode", "insert");
    });

    it("routes insert-block intent to openToolbar with insert-block mode", () => {
      const intent: ToolbarIntent = {
        type: "insert",
        contextMode: "insert-block",
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openToolbar");
      expect(result).toHaveProperty("payload.contextMode", "insert-block");
    });
  });

  describe("none routing", () => {
    it("routes none intent to skip action", () => {
      const intent: ToolbarIntent = { type: "none" };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("skip");
    });
  });

  describe("blockMath routing", () => {
    it("routes blockMath intent to openMathToolbar", () => {
      const intent: ToolbarIntent = {
        type: "blockMath",
        info: { from: 0, to: 50 },
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openMathToolbar");
    });
  });

  describe("inlineMath routing", () => {
    it("routes inlineMath intent to openToolbar with format mode (auto-select)", () => {
      const intent: ToolbarIntent = {
        type: "inlineMath",
        info: { from: 0, to: 10, contentFrom: 1, contentTo: 9 },
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openToolbar");
      expect(result).toHaveProperty("payload.autoSelected", true);
    });
  });

  describe("footnote routing", () => {
    it("routes footnote intent to openFootnotePopup", () => {
      const intent: ToolbarIntent = {
        type: "footnote",
        info: { label: "1", from: 0, to: 5, contentFrom: 2, contentTo: 3 },
      };

      const result = routeToolbarIntent(intent);

      expect(result.action).toBe("openFootnotePopup");
    });
  });
});
