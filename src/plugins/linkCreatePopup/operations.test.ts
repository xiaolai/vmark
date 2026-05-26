import { describe, it, expect } from "vitest";
import { normalizeHref, isValidHref, deriveLinkText } from "./operations";

describe("normalizeHref", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeHref("  https://example.com  ")).toBe("https://example.com");
  });
  it("strips trailing punctuation (. , ))", () => {
    expect(normalizeHref("https://example.com.")).toBe("https://example.com");
    expect(normalizeHref("https://example.com,")).toBe("https://example.com");
    expect(normalizeHref("https://example.com)")).toBe("https://example.com");
    expect(normalizeHref("https://example.com.,)")).toBe("https://example.com");
  });
  it("returns empty string for whitespace-only input", () => {
    expect(normalizeHref("   ")).toBe("");
  });
});

describe("isValidHref", () => {
  it("rejects empty and whitespace-only input", () => {
    expect(isValidHref("")).toBe(false);
    expect(isValidHref("   ")).toBe(false);
  });
  it("accepts external URLs", () => {
    expect(isValidHref("https://example.com")).toBe(true);
    expect(isValidHref("http://example.com")).toBe(true);
  });
  it("accepts fragment references", () => {
    expect(isValidHref("#heading-id")).toBe(true);
  });
  it("accepts filepath-style references", () => {
    expect(isValidHref("./notes.md")).toBe(true);
    expect(isValidHref("../other.md")).toBe(true);
    expect(isValidHref("other.md")).toBe(true);
  });
});

describe("deriveLinkText", () => {
  it("strips a leading # from fragment href", () => {
    expect(deriveLinkText("#section-one")).toBe("section-one");
  });
  it("uses the last segment of a URL path", () => {
    expect(deriveLinkText("https://example.com/docs/page.html")).toBe("page.html");
  });
  it("uses the last segment of a filesystem path", () => {
    expect(deriveLinkText("/Users/me/notes.md")).toBe("notes.md");
  });
  it("handles Windows-style path separators", () => {
    expect(deriveLinkText("C:\\users\\me\\file.md")).toBe("file.md");
  });
  it("returns the input when no separator is present", () => {
    expect(deriveLinkText("name")).toBe("name");
  });
  it("normalizes the input before deriving (strips trailing punctuation)", () => {
    expect(deriveLinkText("https://example.com/page.")).toBe("page");
  });
});
