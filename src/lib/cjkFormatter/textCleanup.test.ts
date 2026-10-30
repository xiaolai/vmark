// @vitest-environment node
// Format → Text Cleanup runs over the whole document, but a fenced code block
// is code: its trailing spaces and blank-line runs are content (a diff, a
// heredoc, whitespace-sensitive output). The cleanup must leave every fence
// byte-for-byte as it was and still clean the prose around it.

import { describe, it, expect } from "vitest";
import { cleanBlankLines, cleanTrailingSpaces } from "./textCleanup";

const FENCE = "```text\nkeep  \n\n\n\nkeep\t \n```";

describe("cleanTrailingSpaces", () => {
  it("cleans prose but leaves a fenced block untouched", () => {
    const doc = `intro   \n\n${FENCE}\n\nafter  \n`;
    expect(cleanTrailingSpaces(doc)).toBe(`intro\n\n${FENCE}\n\nafter\n`);
  });

  it("leaves an unclosed fence untouched to the end of the document", () => {
    const doc = "a  \n~~~\nopen   \nstill  ";
    expect(cleanTrailingSpaces(doc)).toBe("a\n~~~\nopen   \nstill  ");
  });

  it("keeps a two-space hard break in prose when asked to", () => {
    const doc = `line  \nnext \n${FENCE}`;
    expect(cleanTrailingSpaces(doc, { preserveTwoSpaceHardBreaks: true })).toBe(`line  \nnext\n${FENCE}`);
  });

  it("copies the closing fence's whole line, spaces included, and cleans the next", () => {
    expect(cleanTrailingSpaces("```\nx  \n```   \ntext ")).toBe("```\nx  \n```   \ntext");
  });

  it("matches the plain rule on a document with no fence", () => {
    expect(cleanTrailingSpaces("a  \nb \r\nc")).toBe("a\nb\r\nc");
    expect(cleanTrailingSpaces("")).toBe("");
  });
});

describe("cleanBlankLines", () => {
  it("collapses blank-line runs in prose but not inside a fence", () => {
    const doc = `a\n\n\n\n${FENCE}\n\n\n\nb`;
    expect(cleanBlankLines(doc)).toBe(`a\n\n${FENCE}\n\nb`);
  });

  it("handles adjacent fences and CJK prose", () => {
    const doc = "中文\n\n\n```\n1\n\n\n2\n```\n```\n3\n\n\n4\n```\n\n\n\n結束";
    expect(cleanBlankLines(doc)).toBe("中文\n\n```\n1\n\n\n2\n```\n```\n3\n\n\n4\n```\n\n結束");
  });

  it("matches the plain rule on a document with no fence", () => {
    expect(cleanBlankLines("a\n\n\n\nb")).toBe("a\n\nb");
  });
});
