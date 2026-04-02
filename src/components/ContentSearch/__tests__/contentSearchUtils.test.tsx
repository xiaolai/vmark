/**
 * Tests for contentSearchUtils
 *
 * Covers: renderHighlightedLine and buildFlatIndex pure functions.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { renderHighlightedLine, buildFlatIndex } from "../contentSearchUtils";

describe("renderHighlightedLine", () => {
  it("returns plain text when no ranges", () => {
    const result = renderHighlightedLine("hello world", []);
    expect(result).toBe("hello world");
  });

  it("highlights a single range", () => {
    const result = renderHighlightedLine("hello world", [{ start: 6, end: 11 }]);
    const { container } = render(<span>{result}</span>);
    expect(container.textContent).toBe("hello world");
    const highlights = container.querySelectorAll(".content-search-highlight");
    expect(highlights).toHaveLength(1);
    expect(highlights[0].textContent).toBe("world");
  });

  it("highlights multiple ranges", () => {
    const result = renderHighlightedLine("cat and cat", [
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
    const { container } = render(<span>{result}</span>);
    const highlights = container.querySelectorAll(".content-search-highlight");
    expect(highlights).toHaveLength(2);
    expect(highlights[0].textContent).toBe("cat");
    expect(highlights[1].textContent).toBe("cat");
  });

  it("handles range at start of text", () => {
    const result = renderHighlightedLine("hello", [{ start: 0, end: 5 }]);
    const { container } = render(<span>{result}</span>);
    expect(container.querySelector(".content-search-highlight")?.textContent).toBe("hello");
  });

  it("handles empty text", () => {
    const result = renderHighlightedLine("", []);
    expect(result).toBe("");
  });
});

describe("buildFlatIndex", () => {
  it("returns empty for no results", () => {
    expect(buildFlatIndex([])).toEqual([]);
  });

  it("flattens single file with multiple matches", () => {
    const results = [
      {
        path: "/a.md",
        relativePath: "a.md",
        matches: [
          { lineNumber: 1, lineContent: "a", matchRanges: [{ start: 0, end: 1 }] },
          { lineNumber: 5, lineContent: "b", matchRanges: [{ start: 0, end: 1 }] },
        ],
      },
    ];
    const flat = buildFlatIndex(results);
    expect(flat).toEqual([
      { fileIndex: 0, matchIndex: 0 },
      { fileIndex: 0, matchIndex: 1 },
    ]);
  });

  it("flattens multiple files", () => {
    const results = [
      {
        path: "/a.md",
        relativePath: "a.md",
        matches: [{ lineNumber: 1, lineContent: "a", matchRanges: [{ start: 0, end: 1 }] }],
      },
      {
        path: "/b.md",
        relativePath: "b.md",
        matches: [
          { lineNumber: 1, lineContent: "b", matchRanges: [{ start: 0, end: 1 }] },
          { lineNumber: 2, lineContent: "c", matchRanges: [{ start: 0, end: 1 }] },
        ],
      },
    ];
    const flat = buildFlatIndex(results);
    expect(flat).toEqual([
      { fileIndex: 0, matchIndex: 0 },
      { fileIndex: 1, matchIndex: 0 },
      { fileIndex: 1, matchIndex: 1 },
    ]);
  });

  it("handles file with empty matches array", () => {
    const results = [
      { path: "/a.md", relativePath: "a.md", matches: [] },
    ];
    expect(buildFlatIndex(results)).toEqual([]);
  });
});
