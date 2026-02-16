import { describe, it, expect } from "vitest";
import { Text } from "@codemirror/state";
import { findNthHeadingPos, findHeadingIndexAtLine } from "./useSourceOutlineSync";

function textFrom(content: string): Text {
  return Text.of(content.split("\n"));
}

/** Helper: compute expected position by finding the nth occurrence of a substring */
function posOf(content: string, substring: string, occurrence = 0): number {
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = content.indexOf(substring, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

describe("findNthHeadingPos", () => {
  it("finds the first heading", () => {
    const s = "# Hello\n\nSome text\n\n## World";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# Hello"));
  });

  it("finds the second heading", () => {
    const s = "# Hello\n\nSome text\n\n## World";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## World"));
  });

  it("returns -1 if heading index out of range", () => {
    const doc = textFrom("# Hello\n\n## World");
    expect(findNthHeadingPos(doc, 5)).toBe(-1);
  });

  it("returns -1 for empty document", () => {
    const doc = textFrom("");
    expect(findNthHeadingPos(doc, 0)).toBe(-1);
  });

  it("skips headings inside backtick code fences", () => {
    const s = "# Real\n\n```\n# Fake\n```\n\n## Also Real";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# Real"));
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## Also Real"));
    expect(findNthHeadingPos(doc, 2)).toBe(-1);
  });

  it("skips headings inside tilde code fences", () => {
    const s = "# Real\n\n~~~\n# Fake\n~~~\n\n## Also Real";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# Real"));
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## Also Real"));
  });

  it("handles longer closing fence (4 backticks close 3)", () => {
    const s = "# A\n\n```\n# B\n````\n\n## C";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# A"));
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## C"));
  });

  it("does not close fence with shorter fence", () => {
    const s = "# A\n\n````\n# B\n```\n# C\n````\n\n## D";
    const doc = textFrom(s);
    // 4-backtick fence opened, 3-backtick line does NOT close it
    // # B and # C are inside the fence
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# A"));
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## D"));
  });

  it("does not close fence with different character", () => {
    const s = "# A\n\n```\n# B\n~~~\n# C\n```\n\n## D";
    const doc = textFrom(s);
    // backtick fence cannot be closed by tilde
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# A"));
    // # B and # C are inside, ~~~ doesn't close backtick fence
    // ``` at line 7 closes it
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## D"));
  });

  it("handles headings at all levels", () => {
    const doc = textFrom("# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6");
    for (let i = 0; i < 6; i++) {
      expect(findNthHeadingPos(doc, i)).toBeGreaterThanOrEqual(0);
    }
    expect(findNthHeadingPos(doc, 6)).toBe(-1);
  });

  it("ignores lines that look like headings but aren't (no space)", () => {
    const s = "#NoSpace\n# Real Heading";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# Real Heading"));
    expect(findNthHeadingPos(doc, 1)).toBe(-1);
  });
});

describe("findHeadingIndexAtLine", () => {
  it("returns -1 when cursor is before all headings", () => {
    const doc = textFrom("Some text\n\n# Heading");
    expect(findHeadingIndexAtLine(doc, 1)).toBe(-1);
  });

  it("returns 0 when cursor is on first heading line", () => {
    const doc = textFrom("# First\n\nSome text\n\n## Second");
    expect(findHeadingIndexAtLine(doc, 1)).toBe(0);
  });

  it("returns 0 when cursor is between first and second heading", () => {
    const doc = textFrom("# First\n\nSome text\n\n## Second");
    expect(findHeadingIndexAtLine(doc, 3)).toBe(0); // "Some text" line
  });

  it("returns 1 when cursor is on second heading", () => {
    const doc = textFrom("# First\n\nSome text\n\n## Second");
    expect(findHeadingIndexAtLine(doc, 5)).toBe(1);
  });

  it("skips headings inside code fences", () => {
    const doc = textFrom("# Real\n\n```\n# Fake\n```\n\n## Also Real\n\nText here");
    // Line 9 is "Text here", which is after "## Also Real" (heading index 1)
    expect(findHeadingIndexAtLine(doc, 9)).toBe(1);
    // Line 4 is "# Fake" inside code block — not counted
    expect(findHeadingIndexAtLine(doc, 4)).toBe(0);
  });

  it("returns -1 for empty document", () => {
    const doc = textFrom("");
    expect(findHeadingIndexAtLine(doc, 1)).toBe(-1);
  });
});
