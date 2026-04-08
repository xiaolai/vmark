/**
 * Tests for sourceHandlers — extractHeadingsFromMarkdown edge cases.
 */

import { describe, it, expect } from "vitest";
import { extractHeadingsFromMarkdown } from "../sourceHandlers";

describe("extractHeadingsFromMarkdown", () => {
  it("extracts headings with correct levels and positions", () => {
    const content = "# H1\n## H2\n### H3";
    const headings = extractHeadingsFromMarkdown(content);
    expect(headings).toEqual([
      { level: 1, text: "H1", position: 0 },
      { level: 2, text: "H2", position: 5 },
      { level: 3, text: "H3", position: 11 },
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(extractHeadingsFromMarkdown("")).toEqual([]);
  });

  it("returns empty array for content with no headings", () => {
    expect(extractHeadingsFromMarkdown("Just some text\nwith lines")).toEqual(
      []
    );
  });

  it("strips trailing hashes", () => {
    const headings = extractHeadingsFromMarkdown("## Heading ##");
    expect(headings[0].text).toBe("Heading");
  });

  it("strips trailing hashes with extra spaces", () => {
    const headings = extractHeadingsFromMarkdown("## Heading  ##  ");
    expect(headings[0].text).toBe("Heading");
  });

  it("handles heading without trailing newline", () => {
    const headings = extractHeadingsFromMarkdown("# Title");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toEqual({ level: 1, text: "Title", position: 0 });
  });

  it("ignores non-heading lines between headings", () => {
    const content = "Some text\n# Heading\nMore text";
    const headings = extractHeadingsFromMarkdown(content);
    expect(headings).toHaveLength(1);
    expect(headings[0]).toEqual({ level: 1, text: "Heading", position: 10 });
  });

  it("handles all 6 heading levels", () => {
    const content = [
      "# H1",
      "## H2",
      "### H3",
      "#### H4",
      "##### H5",
      "###### H6",
    ].join("\n");
    const headings = extractHeadingsFromMarkdown(content);
    expect(headings).toHaveLength(6);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("skips lines with more than 6 hashes", () => {
    expect(extractHeadingsFromMarkdown("####### Not a heading")).toEqual([]);
  });

  it("requires space after hashes", () => {
    expect(extractHeadingsFromMarkdown("#NoSpace")).toEqual([]);
  });

  it("tracks positions correctly with mixed content", () => {
    // "intro\n\n# First\n\ntext\n\n## Second"
    // line offsets: "intro"=0, ""=6, "# First"=7, ""=15, "text"=16, ""=21, "## Second"=22
    const content = "intro\n\n# First\n\ntext\n\n## Second";
    const headings = extractHeadingsFromMarkdown(content);
    expect(headings).toHaveLength(2);
    expect(headings[0]).toEqual({ level: 1, text: "First", position: 7 });
    expect(headings[1]).toEqual({ level: 2, text: "Second", position: 22 });
  });

  it("preserves inline markdown in heading text", () => {
    const headings = extractHeadingsFromMarkdown("# Hello **bold** world");
    expect(headings[0].text).toBe("Hello **bold** world");
  });

  it("handles heading with only hashes and space", () => {
    // "# " — match[2] would be empty, but regex requires .+ so it won't match
    expect(extractHeadingsFromMarkdown("# ")).toEqual([]);
  });

  it("handles CJK heading text", () => {
    const headings = extractHeadingsFromMarkdown("# \u6807\u9898\u4E00");
    expect(headings[0].text).toBe("\u6807\u9898\u4E00");
  });

  it("handles heading with extra spaces after hashes", () => {
    // Regex \s+ consumes all spaces after hashes, so only "Extra space" is captured
    const headings = extractHeadingsFromMarkdown("#  Extra space");
    expect(headings[0].text).toBe("Extra space");
  });
});
