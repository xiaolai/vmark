import { describe, it, expect } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import { testSchema } from "@/utils/markdownPipeline/testSchema";
import { textblockLineAt, withinTable } from "./wysiwygLineUnit";

const s = testSchema;
const doc = (...blocks: PMNode[]) => s.node("doc", null, blocks);
const p = (...content: PMNode[]) => s.node("paragraph", null, content);
const text = (t: string) => s.text(t);
const br = () => s.node("hardBreak");
const cell = (...blocks: PMNode[]) => s.node("tableCell", null, blocks);
const row = (...cells: PMNode[]) => s.node("tableRow", null, cells);
const table = (...rows: PMNode[]) => s.node("table", null, rows);

describe("textblockLineAt", () => {
  // p("alpha", br, "beta", br, "gamma") — doc positions: "alpha" 1..6,
  // break 6..7, "beta" 7..11, break 11..12, "gamma" 12..17.
  const threeLine = doc(p(text("alpha"), br(), text("beta"), br(), text("gamma")));

  it("returns null for a textblock without hard breaks", () => {
    const d = doc(p(text("plain")));
    expect(textblockLineAt(d.resolve(3))).toBeNull();
  });

  it("returns null when the position's parent is not a textblock", () => {
    expect(textblockLineAt(threeLine.resolve(0))).toBeNull();
  });

  it("resolves the middle line with both neighbours", () => {
    expect(textblockLineAt(threeLine.resolve(8))).toEqual({
      from: 7,
      to: 11,
      prev: { from: 1, to: 6 },
      next: { from: 12, to: 17 },
    });
  });

  it("resolves the first line with no prev", () => {
    expect(textblockLineAt(threeLine.resolve(2))).toEqual({
      from: 1,
      to: 6,
      prev: null,
      next: { from: 7, to: 11 },
    });
  });

  it("resolves the last line with no next", () => {
    expect(textblockLineAt(threeLine.resolve(15))).toEqual({
      from: 12,
      to: 17,
      prev: { from: 7, to: 11 },
      next: null,
    });
  });

  it("assigns a cursor sitting exactly on a delimiter to the line it ends", () => {
    // Position 6 is the start of the first hard break — the end of line one.
    expect(textblockLineAt(threeLine.resolve(6))).toMatchObject({ from: 1, to: 6 });
    // Position 7 is just after it — the start of line two.
    expect(textblockLineAt(threeLine.resolve(7))).toMatchObject({ from: 7, to: 11 });
  });

  it("handles an empty line between two adjacent breaks", () => {
    // p("a", br, br, "b") — the middle line is empty: from === to.
    const d = doc(p(text("a"), br(), br(), text("b")));
    expect(textblockLineAt(d.resolve(3))).toEqual({
      from: 3,
      to: 3,
      prev: { from: 1, to: 2 },
      next: { from: 4, to: 5 },
    });
  });
});

describe("withinTable", () => {
  const d = doc(table(row(cell(p(text("x"))))), p(text("out")));

  it("is true for a position inside a table cell", () => {
    expect(withinTable(d.resolve(4))).toBe(true);
  });

  it("is false for a position outside any table", () => {
    expect(withinTable(d.resolve(10))).toBe(false);
  });
});
