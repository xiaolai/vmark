import { describe, it, expect } from "vitest";
import { verifyIntegrity } from "./integrity";

describe("verifyIntegrity", () => {
  it("returns ok when structural patterns are preserved", () => {
    const text = "中文 `code` and [^1] and ```\nblock\n``` end";
    const result = verifyIntegrity(text, text);
    expect(result.ok).toBe(true);
  });

  it("returns ok when formatting only changes non-structural text", () => {
    const before = "中文Python `code` text[^1]";
    const after = "中文 Python `code` text[^1]";
    const result = verifyIntegrity(before, after);
    expect(result.ok).toBe(true);
  });

  it("detects lost footnote references", () => {
    const before = "中文[^1]和[^2]";
    const after = "中文和";
    const result = verifyIntegrity(before, after);
    expect(result.ok).toBe(false);
    expect(result.details["[^"]).toEqual({ before: 2, after: 0 });
  });

  it("detects lost fenced code blocks", () => {
    const before = "text\n```\ncode\n```\nmore";
    const after = "text\ncode\nmore";
    const result = verifyIntegrity(before, after);
    expect(result.ok).toBe(false);
    expect(result.details["```"]).toEqual({ before: 2, after: 0 });
  });

  it("detects lost tilde code fences", () => {
    const before = "text\n~~~\ncode\n~~~\nmore";
    const after = "text\ncode\nmore";
    const result = verifyIntegrity(before, after);
    expect(result.ok).toBe(false);
    expect(result.details["~~~"]).toEqual({ before: 2, after: 0 });
  });

  it("detects lost HTML comments", () => {
    const before = "text <!-- note --> more <!-- ref -->";
    const after = "text more";
    const result = verifyIntegrity(before, after);
    expect(result.ok).toBe(false);
    expect(result.details["<!--"]).toEqual({ before: 2, after: 0 });
  });

  it("detects lost math blocks", () => {
    const before = "text $$E=mc^2$$ more";
    const after = "text E=mc^2 more";
    const result = verifyIntegrity(before, after);
    expect(result.ok).toBe(false);
    expect(result.details["$$"]).toEqual({ before: 2, after: 0 });
  });

  it("detects lost wiki links", () => {
    const before = "see [[PageName]] and [[Other]]";
    const after = "see PageName and Other";
    const result = verifyIntegrity(before, after);
    expect(result.ok).toBe(false);
    expect(result.details["[["]).toEqual({ before: 2, after: 0 });
  });

  it("detects lost inline code spans", () => {
    const before = "use `grep` and `sed`";
    const after = "use grep and sed";
    const result = verifyIntegrity(before, after);
    expect(result.ok).toBe(false);
    // backtick count dropped
    expect(result.details["`"].before).toBeGreaterThan(result.details["`"].after);
  });

  it("returns ok for empty input", () => {
    const result = verifyIntegrity("", "");
    expect(result.ok).toBe(true);
  });

  it("returns ok when counts match despite text changes", () => {
    const before = "中文,Python `code` and [^1]";
    const after = "中文，Python `code` and [^1]";
    const result = verifyIntegrity(before, after);
    expect(result.ok).toBe(true);
  });

  it("detects gained structural patterns (should not happen but safety)", () => {
    const before = "plain text";
    const after = "plain text [^1]";
    const result = verifyIntegrity(before, after);
    expect(result.ok).toBe(false);
  });

  it("handles frontmatter presence", () => {
    const text = "---\ntitle: Test\n---\n\n中文 content";
    const result = verifyIntegrity(text, text);
    expect(result.ok).toBe(true);
  });
});
