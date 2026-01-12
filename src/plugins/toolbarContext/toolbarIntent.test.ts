/**
 * Toolbar Intent Resolver Tests
 *
 * Tests for the shared intent resolver that maps cursor context → toolbar intent.
 * Priority order (canonical):
 * 1. Code block
 * 2. Block math (source only)
 * 3. Table
 * 4. List
 * 5. Blockquote
 * 6. Selection (user-made)
 * 7. Formatted range (auto-select)
 * 8. Link → opens link popup in WYSIWYG, format in source
 * 9. Image → none in WYSIWYG (has own popup), skip in source
 * 10. Inline math
 * 11. Footnote
 * 12. Heading
 * 13. Line start → heading toolbar
 * 14. Word (auto-select)
 * 15. Insert (fallback)
 */

import { describe, it, expect } from "vitest";
import { resolveToolbarIntent } from "./toolbarIntent";
import type { CursorContext } from "./types";

// Helper to create minimal context
function createContext(overrides: Partial<CursorContext> = {}): CursorContext {
  return {
    hasSelection: false,
    atLineStart: false,
    contextMode: "insert",
    surface: "wysiwyg",
    ...overrides,
  };
}

describe("resolveToolbarIntent", () => {
  describe("priority order", () => {
    it("returns code intent when in code block", () => {
      const ctx = createContext({
        inCodeBlock: { language: "typescript", from: 0, to: 100 },
        inTable: { row: 0, col: 0, totalRows: 2, totalCols: 2 },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("code");
    });

    it("returns blockMath intent when in block math (source mode)", () => {
      const ctx = createContext({
        surface: "source",
        inBlockMath: { from: 0, to: 50 },
        inTable: { row: 0, col: 0, totalRows: 2, totalCols: 2 },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("blockMath");
    });

    it("ignores blockMath in WYSIWYG mode", () => {
      const ctx = createContext({
        surface: "wysiwyg",
        inBlockMath: { from: 0, to: 50 },
        inTable: { row: 0, col: 0, totalRows: 2, totalCols: 2 },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("table");
    });

    it("returns table intent when in table", () => {
      const ctx = createContext({
        inTable: { row: 1, col: 2, totalRows: 3, totalCols: 4 },
        inList: { listType: "bullet", depth: 1 },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("table");
    });

    it("returns list intent when in list", () => {
      const ctx = createContext({
        inList: { listType: "ordered", depth: 2 },
        inBlockquote: { depth: 1 },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("list");
    });

    it("returns blockquote intent when in blockquote", () => {
      const ctx = createContext({
        inBlockquote: { depth: 1 },
        hasSelection: true,
        selectionInfo: { from: 10, to: 20, text: "selected" },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("blockquote");
    });

    it("returns format intent with user selection", () => {
      const ctx = createContext({
        hasSelection: true,
        selectionInfo: { from: 10, to: 20, text: "selected text" },
        inHeading: { level: 2 },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("format");
      if (intent.type === "format") {
        expect(intent.autoSelected).toBeFalsy();
      }
    });

    it("returns format intent with auto-selected formatted range", () => {
      const ctx = createContext({
        inFormattedRange: {
          markType: "bold",
          from: 5,
          to: 15,
          contentFrom: 7,
          contentTo: 13,
        },
        inHeading: { level: 1 },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("format");
      if (intent.type === "format") {
        expect(intent.autoSelected).toBe(true);
        expect(intent.selection.from).toBe(7);
        expect(intent.selection.to).toBe(13);
      }
    });
  });

  describe("link handling", () => {
    it("returns link intent in WYSIWYG for opening link popup", () => {
      const ctx = createContext({
        surface: "wysiwyg",
        inLink: {
          href: "https://example.com",
          text: "link text",
          from: 0,
          to: 30,
          contentFrom: 1,
          contentTo: 10,
        },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("link");
    });

    it("returns format intent in source mode for link (auto-select)", () => {
      const ctx = createContext({
        surface: "source",
        inLink: {
          href: "https://example.com",
          text: "link text",
          from: 0,
          to: 30,
          contentFrom: 1,
          contentTo: 10,
        },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("format");
      if (intent.type === "format") {
        expect(intent.autoSelected).toBe(true);
      }
    });
  });

  describe("image handling", () => {
    it("returns none intent in WYSIWYG (image has own popup)", () => {
      const ctx = createContext({
        surface: "wysiwyg",
        inImage: { src: "image.png", alt: "alt text", from: 0, to: 20 },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("none");
    });

    it("returns none intent in source mode (image has own popup)", () => {
      const ctx = createContext({
        surface: "source",
        inImage: { src: "image.png", alt: "alt text", from: 0, to: 20 },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("none");
    });
  });

  describe("inline math and footnote", () => {
    it("returns inlineMath intent", () => {
      const ctx = createContext({
        inInlineMath: { from: 0, to: 10, contentFrom: 1, contentTo: 9 },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("inlineMath");
    });

    it("returns footnote intent", () => {
      const ctx = createContext({
        inFootnote: {
          label: "1",
          from: 0,
          to: 5,
          contentFrom: 2,
          contentTo: 3,
        },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("footnote");
    });
  });

  describe("heading and line start", () => {
    it("returns heading intent when in heading", () => {
      const ctx = createContext({
        inHeading: { level: 3, nodePos: 100 },
        inWord: { from: 5, to: 10, text: "hello" },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("heading");
      if (intent.type === "heading") {
        expect(intent.info.level).toBe(3);
      }
    });

    it("returns heading intent at line start (level 0 = paragraph)", () => {
      const ctx = createContext({
        atLineStart: true,
        inWord: { from: 0, to: 5, text: "hello" },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("heading");
      if (intent.type === "heading") {
        expect(intent.info.level).toBe(0);
      }
    });
  });

  describe("word and insert fallback", () => {
    it("returns format intent with auto-selected word", () => {
      const ctx = createContext({
        inWord: { from: 10, to: 15, text: "world" },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("format");
      if (intent.type === "format") {
        expect(intent.autoSelected).toBe(true);
        expect(intent.selection.text).toBe("world");
      }
    });

    it("returns insert intent as fallback", () => {
      const ctx = createContext({
        contextMode: "insert",
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("insert");
      if (intent.type === "insert") {
        expect(intent.contextMode).toBe("insert");
      }
    });

    it("returns insert-block intent when at block boundary", () => {
      const ctx = createContext({
        contextMode: "insert-block",
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("insert");
      if (intent.type === "insert") {
        expect(intent.contextMode).toBe("insert-block");
      }
    });
  });

  describe("nested context priority", () => {
    it("code block wins over everything", () => {
      const ctx = createContext({
        inCodeBlock: { language: "js", from: 0, to: 100 },
        inTable: { row: 0, col: 0, totalRows: 1, totalCols: 1 },
        inList: { listType: "bullet", depth: 1 },
        inBlockquote: { depth: 1 },
        hasSelection: true,
        selectionInfo: { from: 10, to: 20, text: "selected" },
        inHeading: { level: 1 },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("code");
    });

    it("table wins over list/blockquote/selection", () => {
      const ctx = createContext({
        inTable: { row: 0, col: 0, totalRows: 2, totalCols: 2 },
        inList: { listType: "bullet", depth: 1 },
        inBlockquote: { depth: 1 },
        hasSelection: true,
        selectionInfo: { from: 10, to: 20, text: "selected" },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("table");
    });

    it("list wins over blockquote/selection", () => {
      const ctx = createContext({
        inList: { listType: "task", depth: 1, checked: false },
        inBlockquote: { depth: 1 },
        hasSelection: true,
        selectionInfo: { from: 10, to: 20, text: "selected" },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("list");
    });

    it("blockquote wins over selection", () => {
      const ctx = createContext({
        inBlockquote: { depth: 2 },
        hasSelection: true,
        selectionInfo: { from: 10, to: 20, text: "selected" },
      });

      const intent = resolveToolbarIntent(ctx);
      expect(intent.type).toBe("blockquote");
    });
  });
});
