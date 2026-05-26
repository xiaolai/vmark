import { describe, it, expect } from "vitest";
import { classifyImageSrc, formatImageMarkdown, isValidImageSrc } from "./operations";

describe("classifyImageSrc", () => {
  it("returns 'unknown' for empty / whitespace", () => {
    expect(classifyImageSrc("")).toBe("unknown");
    expect(classifyImageSrc("   ")).toBe("unknown");
  });
  it("returns 'data' for data: URIs", () => {
    expect(classifyImageSrc("data:image/png;base64,abc")).toBe("data");
  });
  it("returns 'remote' for http(s) URLs (case-insensitive scheme)", () => {
    expect(classifyImageSrc("https://example.com/x.png")).toBe("remote");
    expect(classifyImageSrc("http://example.com/x.png")).toBe("remote");
    expect(classifyImageSrc("HTTPS://example.com/x.png")).toBe("remote");
  });
  it("falls through to 'local' for relative / absolute paths and file:// URLs", () => {
    expect(classifyImageSrc("./images/x.png")).toBe("local");
    expect(classifyImageSrc("/abs/path.png")).toBe("local");
    expect(classifyImageSrc("file:///tmp/x.png")).toBe("local");
  });
});

describe("formatImageMarkdown", () => {
  it("formats without title when none provided", () => {
    expect(formatImageMarkdown("alt", "src.png")).toBe("![alt](src.png)");
  });
  it("formats with title in quotes", () => {
    expect(formatImageMarkdown("alt", "src.png", "Title")).toBe('![alt](src.png "Title")');
  });
  it("ignores whitespace-only titles", () => {
    expect(formatImageMarkdown("alt", "src.png", "   ")).toBe("![alt](src.png)");
  });
  it("escapes brackets and backslashes in alt text", () => {
    expect(formatImageMarkdown("a]b", "x.png")).toBe("![a\\]b](x.png)");
    expect(formatImageMarkdown("a\\b", "x.png")).toBe("![a\\\\b](x.png)");
  });
  it("escapes quotes inside titles", () => {
    expect(formatImageMarkdown("alt", "x.png", 'He said "hi"')).toBe(
      '![alt](x.png "He said \\"hi\\"")',
    );
  });
  it("trims whitespace from src", () => {
    expect(formatImageMarkdown("alt", "  x.png  ")).toBe("![alt](x.png)");
  });
});

describe("isValidImageSrc", () => {
  it.each([
    ["", false],
    ["   ", false],
    ["x", true],
    ["  x  ", true],
    ["https://example.com", true],
  ])("isValidImageSrc(%j) -> %s", (input, expected) => {
    expect(isValidImageSrc(input)).toBe(expected);
  });
});
