// @vitest-environment node
/**
 * Edge Case Tests for Table Escape
 *
 * Tests for ArrowUp/ArrowDown table escape behavior with various edge cases:
 * - Multiple tables in document
 * - Empty tables
 * - Tables in lists
 * - Tables in blockquotes
 * - Very large tables
 * - Tables with merged cells
 */

import { describe, it, expect } from "vitest";
import { isTableFirstBlock, isTableLastBlock } from "./tableEscape";

describe("Table Escape - Position Detection Edge Cases", () => {
  describe("isTableFirstBlock edge cases", () => {
    it("handles table at position 0", () => {
      expect(isTableFirstBlock(0)).toBe(true);
    });

    it("handles table at position 1", () => {
      expect(isTableFirstBlock(1)).toBe(false);
    });

    it("handles negative position (invalid but defensive)", () => {
      expect(isTableFirstBlock(-1)).toBe(false);
    });

    it("handles very large position", () => {
      expect(isTableFirstBlock(999999)).toBe(false);
    });
  });

  describe("isTableLastBlock edge cases", () => {
    it("handles table at document end", () => {
      expect(isTableLastBlock(0, 100, 100)).toBe(true);
    });

    it("handles table not at document end", () => {
      expect(isTableLastBlock(0, 100, 200)).toBe(false);
    });

    it("handles empty table (size 0)", () => {
      // Empty table technically has some size (wrapper nodes)
      // But test the boundary
      expect(isTableLastBlock(0, 2, 2)).toBe(true);
    });

    it("handles table in middle of document", () => {
      expect(isTableLastBlock(100, 50, 200)).toBe(false);
    });

    it("handles off-by-one: table ends one position before doc end", () => {
      expect(isTableLastBlock(0, 99, 100)).toBe(false);
    });

    it("handles exact match: table ends exactly at doc end", () => {
      expect(isTableLastBlock(0, 100, 100)).toBe(true);
    });

    it("handles multiple tables: first table", () => {
      // First table: pos 0, size 50
      // Second table: pos 50, size 50
      // Doc size: 100
      expect(isTableLastBlock(0, 50, 100)).toBe(false);
    });

    it("handles multiple tables: last table", () => {
      // First table: pos 0, size 50
      // Second table: pos 50, size 50
      // Doc size: 100
      expect(isTableLastBlock(50, 50, 100)).toBe(true);
    });

    it("handles three tables: middle table", () => {
      // Three tables, each size 30
      // Middle table at pos 30
      expect(isTableLastBlock(30, 30, 90)).toBe(false);
    });

    it("handles table with paragraph before and after", () => {
      // Paragraph (size 10) + Table (size 50) + Paragraph (size 10)
      // Table at pos 10, doc size 70
      expect(isTableLastBlock(10, 50, 70)).toBe(false);
    });

    it("handles very large table", () => {
      const tableSize = 10000;
      expect(isTableLastBlock(0, tableSize, tableSize)).toBe(true);
    });

    it("handles very small document", () => {
      // Minimal table in minimal doc
      expect(isTableLastBlock(0, 5, 5)).toBe(true);
    });
  });

  describe("Complex document structures", () => {
    it("handles table after heading", () => {
      // Heading (size 20) + Table (size 80)
      // Table at pos 20
      expect(isTableFirstBlock(20)).toBe(false);
      expect(isTableLastBlock(20, 80, 100)).toBe(true);
    });

    it("handles table between two headings", () => {
      // Heading (20) + Table (60) + Heading (20)
      expect(isTableFirstBlock(20)).toBe(false);
      expect(isTableLastBlock(20, 60, 100)).toBe(false);
    });

    it("handles table in list (table itself is not first block)", () => {
      // List wraps the table, so table is not at position 0
      // List (size 100, contains table at offset 10)
      expect(isTableFirstBlock(10)).toBe(false);
    });

    it("handles table in blockquote", () => {
      // Blockquote (size 100, contains table at offset 5)
      expect(isTableFirstBlock(5)).toBe(false);
    });
  });

  describe("Boundary conditions", () => {
    it("handles table size equal to doc size (entire doc is table)", () => {
      expect(isTableLastBlock(0, 100, 100)).toBe(true);
    });

    it("handles table size larger than doc size (invalid state)", () => {
      // This is an invalid state that shouldn't happen in a real document
      // The function correctly returns false since 0 + 150 !== 100
      expect(isTableLastBlock(0, 150, 100)).toBe(false);
    });

    it("handles zero-size document", () => {
      expect(isTableLastBlock(0, 0, 0)).toBe(true);
    });

    it("handles table at exact middle of document", () => {
      // Doc size 200, table from 50-150 (size 100)
      expect(isTableLastBlock(50, 100, 200)).toBe(false);
    });
  });
});

/**
 * NOTE: Integration tests for actual escape behavior (inserting paragraphs)
 * would require a full Tiptap/ProseMirror setup with table plugin.
 * Those tests would cover:
 * - ArrowUp at first row inserting paragraph before
 * - ArrowDown at last row inserting paragraph after
 * - Multiple cursors handling
 * - Undo/redo of escape operations
 * - Table in complex nested structures
 *
 * These are better suited for E2E tests or component tests with full editor setup.
 */

describe("Table Escape - Theoretical Integration Scenarios", () => {
  it("scenario: single-row table as first block", () => {
    // Table with 1 row at pos 0, size 50, doc size 100
    // ArrowUp at row 0 → should insert paragraph before
    const isFirst = isTableFirstBlock(0);
    expect(isFirst).toBe(true);
  });

  it("scenario: single-row table as last block", () => {
    // Paragraph (50) + Table (50, 1 row)
    // ArrowDown at last row → should insert paragraph after
    const isLast = isTableLastBlock(50, 50, 100);
    expect(isLast).toBe(true);
  });

  it("scenario: table as only content", () => {
    // Document contains only a table
    const isFirst = isTableFirstBlock(0);
    const isLast = isTableLastBlock(0, 100, 100);
    expect(isFirst).toBe(true);
    expect(isLast).toBe(true);
    // Both ArrowUp and ArrowDown should insert paragraphs
  });

  it("scenario: table in middle - neither first nor last", () => {
    // Paragraph (30) + Table (40) + Paragraph (30)
    const isFirst = isTableFirstBlock(30);
    const isLast = isTableLastBlock(30, 40, 100);
    expect(isFirst).toBe(false);
    expect(isLast).toBe(false);
    // Arrow keys should use default behavior
  });

  it("scenario: two adjacent tables", () => {
    // Table1 (0-50) + Table2 (50-100)
    const table1IsLast = isTableLastBlock(0, 50, 100);
    const table2IsFirst = isTableFirstBlock(50);
    expect(table1IsLast).toBe(false); // Table2 is after
    expect(table2IsFirst).toBe(false); // Table1 is before
  });

  it("scenario: three tables in sequence", () => {
    // Table1 (0-30) + Table2 (30-60) + Table3 (60-90)
    expect(isTableFirstBlock(0)).toBe(true); // Table1 is first
    expect(isTableFirstBlock(30)).toBe(false);
    expect(isTableFirstBlock(60)).toBe(false);

    expect(isTableLastBlock(0, 30, 90)).toBe(false);
    expect(isTableLastBlock(30, 30, 90)).toBe(false);
    expect(isTableLastBlock(60, 30, 90)).toBe(true); // Table3 is last
  });
});

describe("Table Escape - Performance Edge Cases", () => {
  it("handles calculation with very large position values", () => {
    const largePos = 1_000_000;
    const largeSize = 500_000;
    const largeDoc = 1_500_000;

    expect(isTableLastBlock(largePos, largeSize, largeDoc)).toBe(true);
  });

  it("handles calculation with maximum safe integer", () => {
    const maxSafe = Number.MAX_SAFE_INTEGER;
    // This tests numeric stability
    expect(isTableLastBlock(0, maxSafe, maxSafe)).toBe(true);
  });

  it("handles many tables in document (scalability)", () => {
    // Simulate 1000 tables, each size 100, total doc size 100_000
    const tableIndex = 500; // Middle table
    const tablePos = tableIndex * 100;
    const tableSize = 100;
    const docSize = 100_000;

    expect(isTableFirstBlock(tablePos)).toBe(false);
    expect(isTableLastBlock(tablePos, tableSize, docSize)).toBe(false);
  });
});
