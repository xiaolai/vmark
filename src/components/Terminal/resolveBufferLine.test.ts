// WI-4.4 — mapping a right-click's viewport position onto a BUFFER line.
//
// Getting this wrong copies a different command's output than the one the
// user aimed at, silently. The scrolled-back case (viewportY > 0) is the one
// that breaks if you forget that a viewport row is not a buffer line.
import { describe, it, expect } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { resolveBufferLineFromEvent } from "./resolveBufferLine";

interface TermShape {
  rows?: number;
  height?: number;
  top?: number;
  viewportY?: number;
  length?: number;
  noElement?: boolean;
}

function makeTerm({
  rows = 24,
  height = 240, // 10px per row
  top = 100,
  viewportY = 0,
  length = 1000,
  noElement = false,
}: TermShape = {}): Terminal {
  return {
    rows,
    element: noElement
      ? null
      : ({ getBoundingClientRect: () => ({ top, height }) } as unknown as HTMLElement),
    buffer: { active: { viewportY, length } },
  } as unknown as Terminal;
}

describe("resolveBufferLineFromEvent (WI-4.4)", () => {
  it("maps the first visible row to viewportY", () => {
    expect(resolveBufferLineFromEvent(makeTerm({ viewportY: 0 }), { clientY: 105 })).toBe(0);
  });

  it("maps a row by pixel offset within the terminal element", () => {
    // 10px rows, element top at 100 → clientY 135 is row 3.
    expect(resolveBufferLineFromEvent(makeTerm(), { clientY: 135 })).toBe(3);
  });

  it("adds viewportY so a scrolled-back click resolves to the right BUFFER line", () => {
    // The whole point: viewport row 3 of a buffer scrolled to line 500 is
    // buffer line 503, not 3.
    expect(
      resolveBufferLineFromEvent(makeTerm({ viewportY: 500 }), { clientY: 135 }),
    ).toBe(503);
  });

  it("clamps a click above the terminal to the first visible row", () => {
    expect(
      resolveBufferLineFromEvent(makeTerm({ viewportY: 500 }), { clientY: 10 }),
    ).toBe(500);
  });

  it("clamps a click below the terminal to the last visible row", () => {
    // rows=24 → last viewport row index 23.
    expect(
      resolveBufferLineFromEvent(makeTerm({ viewportY: 100 }), { clientY: 9999 }),
    ).toBe(123);
  });

  it("never points past the end of the buffer", () => {
    // A short buffer with a tall element: the clamped row would exceed it.
    expect(
      resolveBufferLineFromEvent(
        makeTerm({ viewportY: 0, length: 5 }),
        { clientY: 9999 },
      ),
    ).toBe(4);
  });

  it("never returns a negative line for an empty buffer", () => {
    expect(
      resolveBufferLineFromEvent(makeTerm({ length: 0 }), { clientY: 105 }),
    ).toBe(0);
  });

  it.each([
    ["no terminal", null],
    ["undefined terminal", undefined],
  ])("returns undefined for %s rather than guessing", (_label, term) => {
    expect(resolveBufferLineFromEvent(term, { clientY: 100 })).toBeUndefined();
  });

  it("returns undefined when the terminal has no element yet", () => {
    expect(
      resolveBufferLineFromEvent(makeTerm({ noElement: true }), { clientY: 100 }),
    ).toBeUndefined();
  });

  it("returns undefined for a zero-height element", () => {
    // A hidden panel measures 0; dividing by it would yield Infinity.
    expect(
      resolveBufferLineFromEvent(makeTerm({ height: 0 }), { clientY: 100 }),
    ).toBeUndefined();
  });

  it("returns undefined when the terminal reports zero rows", () => {
    expect(
      resolveBufferLineFromEvent(makeTerm({ rows: 0 }), { clientY: 100 }),
    ).toBeUndefined();
  });

  it("handles a fractional row height without drifting", () => {
    // 25 rows in 240px → 9.6px per row; clientY 100+48 = row 5.
    expect(
      resolveBufferLineFromEvent(makeTerm({ rows: 25, height: 240 }), { clientY: 148 }),
    ).toBe(5);
  });
});
