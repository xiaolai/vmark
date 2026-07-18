import { describe, expect, it } from "vitest";
import { findProtectedRegions } from "./markdownParser";
import { extractFormattableSegments, reconstructText } from "./segments";

describe("extractFormattableSegments", () => {
  it("extracts non-protected regions", () => {
    const text = "before `code` after";
    const regions = findProtectedRegions(text);
    const segments = extractFormattableSegments(text, regions);

    expect(segments.length).toBe(2);
    expect(segments[0].text).toBe("before ");
    expect(segments[1].text).toBe(" after");
  });

  it("returns full text if no protected regions", () => {
    const text = "plain text without any special syntax";
    const regions = findProtectedRegions(text);
    const segments = extractFormattableSegments(text, regions);

    expect(segments.length).toBe(1);
    expect(segments[0].text).toBe(text);
  });
});

describe("reconstructText", () => {
  it("reconstructs text with formatted segments", () => {
    const original = "text `code` more";
    const regions = findProtectedRegions(original);
    const segments = extractFormattableSegments(original, regions);

    // Simulate formatting by uppercasing formattable segments
    const formattedSegments = segments.map((s) => ({
      ...s,
      text: s.text.toUpperCase(),
    }));

    const result = reconstructText(original, formattedSegments, regions);
    expect(result).toBe("TEXT `code` MORE");
  });

  it("round-trips text unchanged through extract + reconstruct with nested constructs (F1 regression)", () => {
    // Indented code containing a link produced overlapping regions pre-fix,
    // duplicating the overlapped range on reconstruction.
    const text =
      "Intro 文字\n\n    See [docs](https://example.com) for info\n\nMore 文字";
    const regions = findProtectedRegions(text);
    const segments = extractFormattableSegments(text, regions);
    expect(reconstructText(text, segments, regions)).toBe(text);
  });
});
