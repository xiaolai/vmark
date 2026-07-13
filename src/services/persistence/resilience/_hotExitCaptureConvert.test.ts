/**
 * Hot-exit capture converter tests.
 *
 * These pure converters feed the Rust hot-exit session, whose numeric fields
 * are bounded (`u32` line/offset, finite `f32` percent, `Option<u32>` untitled
 * number). A value outside those bounds makes Rust reject the ENTIRE capture
 * response — costing the whole window's crash recovery — so the converters
 * must clamp bad values to a safe "absent" form instead of forwarding them.
 */
import { describe, it, expect } from "vitest";
import type { CursorInfo as StoreCursorInfo } from "@/stores/documentStore";
import {
  extractUntitledNumber,
  toHotExitCursorInfo,
  toHotExitLineEnding,
} from "./_hotExitCaptureConvert";

function makeStoreCursor(overrides: Partial<StoreCursorInfo> = {}): StoreCursorInfo {
  return {
    sourceLine: 3,
    wordAtCursor: "hello",
    offsetInWord: 2,
    nodeType: "paragraph",
    percentInLine: 0.5,
    contextBefore: "he",
    contextAfter: "llo",
    blockAnchor: undefined,
    ...overrides,
  } as StoreCursorInfo;
}

describe("toHotExitLineEnding", () => {
  it("maps known store endings to the wire format", () => {
    expect(toHotExitLineEnding("lf")).toBe("\n");
    expect(toHotExitLineEnding("crlf")).toBe("\r\n");
    expect(toHotExitLineEnding("unknown")).toBe("unknown");
  });

  it("degrades an unrecognized ending to 'unknown' rather than throwing", () => {
    // Throwing here would lose the whole window snapshot at capture time.
    expect(toHotExitLineEnding("mac" as never)).toBe("unknown");
  });
});

describe("toHotExitCursorInfo", () => {
  it("returns null for null/undefined cursor", () => {
    expect(toHotExitCursorInfo(null)).toBeNull();
    expect(toHotExitCursorInfo(undefined)).toBeNull();
  });

  it("maps a valid cursor to the snake_case wire shape", () => {
    const out = toHotExitCursorInfo(makeStoreCursor());
    expect(out).toMatchObject({
      source_line: 3,
      word_at_cursor: "hello",
      offset_in_word: 2,
      node_type: "paragraph",
      percent_in_line: 0.5,
    });
  });

  it.each([
    ["negative source_line", { sourceLine: -1 }],
    ["fractional source_line", { sourceLine: 1.5 }],
    ["NaN source_line", { sourceLine: NaN }],
    ["source_line beyond u32", { sourceLine: 0x1_0000_0000 }],
    ["negative offset_in_word", { offsetInWord: -1 }],
    ["fractional offset_in_word", { offsetInWord: 2.5 }],
    ["non-finite percent_in_line", { percentInLine: Infinity }],
    ["NaN percent_in_line", { percentInLine: NaN }],
  ])("returns null when %s (Rust would reject the whole response)", (_label, overrides) => {
    expect(toHotExitCursorInfo(makeStoreCursor(overrides))).toBeNull();
  });

  it("accepts source_line at the u32 upper bound", () => {
    const out = toHotExitCursorInfo(makeStoreCursor({ sourceLine: 0xffff_ffff }));
    expect(out?.source_line).toBe(0xffff_ffff);
  });
});

describe("extractUntitledNumber", () => {
  it("parses a normal untitled title", () => {
    expect(extractUntitledNumber("Untitled-5")).toBe(5);
  });

  it("returns null for a non-untitled title", () => {
    expect(extractUntitledNumber("notes.md")).toBeNull();
    expect(extractUntitledNumber("Untitled-")).toBeNull();
  });

  it("returns null for a value past the u32 range", () => {
    // parseInt("Untitled-4294967296") = 2^32, one past u32::MAX — Rust's
    // Option<u32> deserialize would reject the entire capture response.
    expect(extractUntitledNumber("Untitled-4294967296")).toBeNull();
  });

  it("returns null for a value past the JS safe-integer range", () => {
    expect(extractUntitledNumber("Untitled-99999999999999999999")).toBeNull();
  });

  it("accepts the u32 upper bound", () => {
    expect(extractUntitledNumber("Untitled-4294967295")).toBe(0xffff_ffff);
  });
});
