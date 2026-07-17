import { describe, it, expect } from "vitest";
import { Text } from "@codemirror/state";
import { viewportScanWindow, BLOCK_SCAN_MARGIN } from "./viewportScan";

/** Build a fake view whose only relevant surface is visibleRanges + state.doc. */
function makeView(lineCount: number, visibleRanges: { from: number; to: number }[]) {
  const doc = Text.of(Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`));
  return { visibleRanges, state: { doc } };
}

describe("viewportScanWindow", () => {
  it("returns the whole document when there are no visible ranges", () => {
    // Detached / unmeasured view (e.g. jsdom before layout): scan everything so
    // correctness never depends on a measured viewport.
    const view = makeView(500, []);
    expect(viewportScanWindow(view)).toEqual({ startLine: 1, endLine: 500 });
  });

  it("expands the visible span by the margin and stays in-bounds", () => {
    const doc = Text.of(Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`));
    const view = {
      visibleRanges: [{ from: doc.line(300).from, to: doc.line(320).to }],
      state: { doc },
    };
    expect(viewportScanWindow(view, 50)).toEqual({ startLine: 250, endLine: 370 });
  });

  it("clamps startLine to 1 and endLine to doc.lines at the document edges", () => {
    const doc = Text.of(Array.from({ length: 100 }, (_, i) => `line ${i + 1}`));
    const view = {
      visibleRanges: [{ from: doc.line(1).from, to: doc.line(100).to }],
      state: { doc },
    };
    expect(viewportScanWindow(view, BLOCK_SCAN_MARGIN)).toEqual({ startLine: 1, endLine: 100 });
  });

  it("spans from the first range's start to the last range's end when folded", () => {
    const doc = Text.of(Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`));
    const view = {
      visibleRanges: [
        { from: doc.line(100).from, to: doc.line(110).to },
        { from: doc.line(500).from, to: doc.line(510).to },
      ],
      state: { doc },
    };
    expect(viewportScanWindow(view, 0)).toEqual({ startLine: 100, endLine: 510 });
  });

  it("defaults the margin to BLOCK_SCAN_MARGIN", () => {
    const doc = Text.of(Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`));
    const view = {
      visibleRanges: [{ from: doc.line(1000).from, to: doc.line(1000).to }],
      state: { doc },
    };
    expect(viewportScanWindow(view)).toEqual({
      startLine: 1000 - BLOCK_SCAN_MARGIN,
      endLine: 1000 + BLOCK_SCAN_MARGIN,
    });
  });
});
