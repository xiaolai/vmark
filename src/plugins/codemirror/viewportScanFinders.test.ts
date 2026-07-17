/**
 * Windowed block-finder tests.
 *
 * The four Source-mode decoration plugins scan only a viewport window
 * (viewportScanWindow) instead of the whole document. These tests exercise the
 * `fromLine`/`toLine` bounds directly on each pure finder: a block whose anchor
 * falls inside the window is found; one outside it is skipped (proving the scan
 * is bounded); and a block that begins inside the window but continues below it
 * is still followed to its true end.
 */
import { describe, it, expect } from "vitest";
import { Text } from "@codemirror/state";
import { findAlertBlocks } from "./sourceAlertDecoration";
import { findMediaBlocks } from "./sourceMediaDecoration";
import { findDetailsBlocks } from "./sourceDetailsDecoration";
import { findBrLineStarts } from "./brHidingPlugin";

const filler = (n: number) => Array.from({ length: n }, () => "text");

describe("findAlertBlocks — windowed", () => {
  // 50 filler lines, then a NOTE alert at 51–52, then filler.
  const doc = Text.of([...filler(50), "> [!NOTE]", "> body", ...filler(48)]);

  it("skips a block whose marker is outside [fromLine, toLine]", () => {
    expect(findAlertBlocks(doc, 1, 40)).toEqual([]);
  });

  it("finds a block whose marker is inside the window", () => {
    expect(findAlertBlocks(doc, 45, 100)).toEqual([
      { type: "NOTE", startLine: 51, endLine: 52 },
    ]);
  });

  it("clamps a block's extent to the scan window (bounds per-keystroke cost)", () => {
    // A long blockquote-alert must not force an O(document) scan+decorate on
    // every keystroke: the extent is capped at toLine. Lines below the window
    // are off-screen and get decorated on scroll (viewportChanged).
    const d = Text.of([...filler(4), "> [!TIP]", ...Array.from({ length: 20 }, () => "> body"), ...filler(10)]);
    const [block] = findAlertBlocks(d, 3, 8); // window ends at line 8; block truly ends at 25
    expect(block).toEqual({ type: "TIP", startLine: 5, endLine: 8 });
  });
});

describe("findMediaBlocks — windowed", () => {
  const doc = Text.of([...filler(19), '<video src="x.mp4">', "</video>", ...filler(29)]);

  it("skips a block whose opening tag is outside the window", () => {
    expect(findMediaBlocks(doc, 1, 10)).toEqual([]);
  });

  it("finds a block whose opening tag is inside the window", () => {
    expect(findMediaBlocks(doc, 15, 30)).toEqual([
      { type: "video", startLine: 20, endLine: 21 },
    ]);
  });
});

describe("findDetailsBlocks — windowed", () => {
  const doc = Text.of([...filler(29), "<details>", "<summary>X</summary>", "</details>", ...filler(18)]);

  it("skips a block whose opening line is outside the window", () => {
    expect(findDetailsBlocks(doc, 1, 20)).toEqual([]);
  });

  it("finds a block whose opening line is inside the window", () => {
    expect(findDetailsBlocks(doc, 25, 40)).toEqual([
      { startLine: 30, endLine: 32, summaryLine: 31, isDirective: false },
    ]);
  });
});

describe("findBrLineStarts — windowed", () => {
  const doc = Text.of([...filler(4), "<br />", ...filler(10)]);

  it("skips a <br> line outside the window", () => {
    expect(findBrLineStarts(doc, 1, 3)).toEqual([]);
  });

  it("finds a <br> line inside the window", () => {
    expect(findBrLineStarts(doc, 4, 10)).toEqual([doc.line(5).from]);
  });
});
