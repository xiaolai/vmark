import { describe, it, expect } from "vitest";
import { clearAllFormatting } from "./clearFormatting";

describe("clearAllFormatting", () => {
  it("removes bold markers", () => {
    expect(clearAllFormatting("**text**")).toBe("text");
    expect(clearAllFormatting("**bold text**")).toBe("bold text");
  });

  it("removes italic markers", () => {
    expect(clearAllFormatting("*text*")).toBe("text");
    expect(clearAllFormatting("*italic text*")).toBe("italic text");
  });

  it("removes underline markers", () => {
    expect(clearAllFormatting("++text++")).toBe("text");
    expect(clearAllFormatting("++underlined text++")).toBe("underlined text");
  });

  it("removes strikethrough markers", () => {
    expect(clearAllFormatting("~~text~~")).toBe("text");
    expect(clearAllFormatting("~~deleted text~~")).toBe("deleted text");
  });

  it("removes highlight markers", () => {
    expect(clearAllFormatting("==text==")).toBe("text");
    expect(clearAllFormatting("==highlighted text==")).toBe("highlighted text");
  });

  it("removes superscript markers", () => {
    expect(clearAllFormatting("^text^")).toBe("text");
    expect(clearAllFormatting("^sup^")).toBe("sup");
  });

  it("removes subscript markers", () => {
    expect(clearAllFormatting("~text~")).toBe("text");
    expect(clearAllFormatting("~sub~")).toBe("sub");
  });

  it("removes inline code markers", () => {
    expect(clearAllFormatting("`text`")).toBe("text");
    expect(clearAllFormatting("`code snippet`")).toBe("code snippet");
  });

  it("extracts text from link syntax", () => {
    expect(clearAllFormatting("[text](url)")).toBe("text");
    expect(clearAllFormatting("[link text](https://example.com)")).toBe("link text");
    expect(clearAllFormatting("[](url)")).toBe("");
  });

  it("removes nested formatting", () => {
    expect(clearAllFormatting("***bold italic***")).toBe("bold italic");
    expect(clearAllFormatting("**`bold code`**")).toBe("bold code");
    expect(clearAllFormatting("*~~italic strike~~*")).toBe("italic strike");
  });

  it("handles multiple formats in text", () => {
    expect(clearAllFormatting("**bold** and *italic*")).toBe("bold and italic");
    expect(clearAllFormatting("text with `code` inside")).toBe("text with code inside");
  });

  it("does not alter image syntax", () => {
    // Images should be preserved as-is
    expect(clearAllFormatting("![alt](url)")).toBe("![alt](url)");
    expect(clearAllFormatting("![](image.png)")).toBe("![](image.png)");
  });

  it("returns plain text unchanged", () => {
    expect(clearAllFormatting("plain text")).toBe("plain text");
    expect(clearAllFormatting("no formatting here")).toBe("no formatting here");
  });

  it("handles empty string", () => {
    expect(clearAllFormatting("")).toBe("");
  });

  it("handles partially formatted text", () => {
    // Only one marker - should not be altered
    expect(clearAllFormatting("**incomplete")).toBe("**incomplete");
    expect(clearAllFormatting("*single star")).toBe("*single star");
  });
});
