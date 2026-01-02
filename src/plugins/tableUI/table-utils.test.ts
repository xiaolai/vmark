import { describe, it, expect } from "vitest";
import { isSelectionInTable } from "./table-utils";

describe("table-utils", () => {
  describe("isSelectionInTable", () => {
    it("returns false when not in table", () => {
      // Create a minimal mock state with no table in ancestry
      const mockState = {
        selection: {
          $from: {
            depth: 2,
            node: (d: number) => {
              if (d === 2) return { type: { name: "paragraph" } };
              if (d === 1) return { type: { name: "doc" } };
              return { type: { name: "unknown" } };
            },
          },
        },
      };

      expect(isSelectionInTable(mockState as never)).toBe(false);
    });

    it("returns true when cursor is inside table", () => {
      // Create a minimal mock state with table in ancestry
      const mockState = {
        selection: {
          $from: {
            depth: 4,
            node: (d: number) => {
              if (d === 4) return { type: { name: "paragraph" } };
              if (d === 3) return { type: { name: "table_cell" } };
              if (d === 2) return { type: { name: "table_row" } };
              if (d === 1) return { type: { name: "table" } };
              return { type: { name: "doc" } };
            },
          },
        },
      };

      expect(isSelectionInTable(mockState as never)).toBe(true);
    });

    it("returns true when cursor is inside table_header", () => {
      const mockState = {
        selection: {
          $from: {
            depth: 4,
            node: (d: number) => {
              if (d === 4) return { type: { name: "paragraph" } };
              if (d === 3) return { type: { name: "table_header" } };
              if (d === 2) return { type: { name: "table_row" } };
              if (d === 1) return { type: { name: "table" } };
              return { type: { name: "doc" } };
            },
          },
        },
      };

      expect(isSelectionInTable(mockState as never)).toBe(true);
    });
  });
});
