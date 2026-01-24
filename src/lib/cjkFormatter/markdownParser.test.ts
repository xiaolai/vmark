import { describe, expect, it } from "vitest";
import {
  findProtectedRegions,
  extractFormattableSegments,
  reconstructText,
} from "./markdownParser";

describe("findProtectedRegions", () => {
  describe("fenced code blocks", () => {
    it("detects basic fenced code blocks", () => {
      const text = "text\n```js\ncode\n```\nmore";
      const regions = findProtectedRegions(text);
      const codeRegion = regions.find((r) => r.type === "fenced_code");
      expect(codeRegion).toBeDefined();
      expect(text.slice(codeRegion!.start, codeRegion!.end)).toBe(
        "```js\ncode\n```"
      );
    });

    it("detects fenced code blocks with tilde fence", () => {
      const text = "text\n~~~python\ncode\n~~~\nmore";
      const regions = findProtectedRegions(text);
      const codeRegion = regions.find((r) => r.type === "fenced_code");
      expect(codeRegion).toBeDefined();
      expect(text.slice(codeRegion!.start, codeRegion!.end)).toBe(
        "~~~python\ncode\n~~~"
      );
    });

    it("detects code block at end of file without trailing newline", () => {
      const text = "text\n```\ncode\n```";
      const regions = findProtectedRegions(text);
      const codeRegion = regions.find((r) => r.type === "fenced_code");
      expect(codeRegion).toBeDefined();
    });
  });

  describe("inline code", () => {
    it("detects single backtick inline code", () => {
      const text = "text `code` more";
      const regions = findProtectedRegions(text);
      const codeRegion = regions.find((r) => r.type === "inline_code");
      expect(codeRegion).toBeDefined();
      expect(text.slice(codeRegion!.start, codeRegion!.end)).toBe("`code`");
    });

    it("detects double backtick inline code", () => {
      const text = "text ``code with ` inside`` more";
      const regions = findProtectedRegions(text);
      const codeRegion = regions.find((r) => r.type === "inline_code");
      expect(codeRegion).toBeDefined();
    });
  });

  describe("frontmatter", () => {
    it("detects YAML frontmatter at start", () => {
      const text = "---\ntitle: Test\ndate: 2024\n---\n\nContent";
      const regions = findProtectedRegions(text);
      const fmRegion = regions.find((r) => r.type === "frontmatter");
      expect(fmRegion).toBeDefined();
      expect(fmRegion!.start).toBe(0);
    });

    it("does not detect frontmatter in middle of document", () => {
      const text = "Content\n---\ntitle: Test\n---\nMore";
      const regions = findProtectedRegions(text);
      const fmRegion = regions.find((r) => r.type === "frontmatter");
      expect(fmRegion).toBeUndefined();
    });
  });

  describe("links and images", () => {
    it("detects image URLs", () => {
      const text = "text ![alt](http://example.com/image.png) more";
      const regions = findProtectedRegions(text);
      const imgRegion = regions.find((r) => r.type === "image");
      expect(imgRegion).toBeDefined();
    });

    it("detects link URLs (protects only URL part)", () => {
      const text = "text [link text](http://example.com) more";
      const regions = findProtectedRegions(text);
      const linkRegion = regions.find((r) => r.type === "link_url");
      expect(linkRegion).toBeDefined();
      // URL part should be protected
      expect(text.slice(linkRegion!.start, linkRegion!.end)).toContain("http");
    });
  });

  describe("wiki links", () => {
    it("detects basic wiki links", () => {
      const text = "text [[My Page]] more";
      const regions = findProtectedRegions(text);
      const wikiRegion = regions.find((r) => r.type === "wiki_link");
      expect(wikiRegion).toBeDefined();
      expect(text.slice(wikiRegion!.start, wikiRegion!.end)).toBe("[[My Page]]");
    });

    it("detects wiki links with display text", () => {
      const text = "text [[target|display]] more";
      const regions = findProtectedRegions(text);
      const wikiRegion = regions.find((r) => r.type === "wiki_link");
      expect(wikiRegion).toBeDefined();
      expect(text.slice(wikiRegion!.start, wikiRegion!.end)).toBe(
        "[[target|display]]"
      );
    });
  });

  describe("footnotes", () => {
    it("detects footnote references", () => {
      const text = "text[^1] with footnote";
      const regions = findProtectedRegions(text);
      const fnRegion = regions.find((r) => r.type === "footnote_ref");
      expect(fnRegion).toBeDefined();
      expect(text.slice(fnRegion!.start, fnRegion!.end)).toBe("[^1]");
    });

    it("detects named footnote references", () => {
      const text = "text[^note] with footnote";
      const regions = findProtectedRegions(text);
      const fnRegion = regions.find((r) => r.type === "footnote_ref");
      expect(fnRegion).toBeDefined();
      expect(text.slice(fnRegion!.start, fnRegion!.end)).toBe("[^note]");
    });

    it("detects footnote definitions", () => {
      const text = "[^1]: This is the footnote content";
      const regions = findProtectedRegions(text);
      const fnDefRegion = regions.find((r) => r.type === "footnote_def");
      expect(fnDefRegion).toBeDefined();
      expect(text.slice(fnDefRegion!.start, fnDefRegion!.end)).toBe("[^1]:");
    });
  });

  describe("math blocks", () => {
    it("detects display math blocks", () => {
      const text = "text\n$$\nE = mc^2\n$$\nmore";
      const regions = findProtectedRegions(text);
      const mathRegion = regions.find((r) => r.type === "math_block");
      expect(mathRegion).toBeDefined();
      expect(text.slice(mathRegion!.start, mathRegion!.end)).toContain(
        "E = mc^2"
      );
    });

    it("detects inline math", () => {
      const text = "The equation $E = mc^2$ is famous";
      const regions = findProtectedRegions(text);
      const mathRegion = regions.find((r) => r.type === "math_inline");
      expect(mathRegion).toBeDefined();
      expect(text.slice(mathRegion!.start, mathRegion!.end)).toBe("$E = mc^2$");
    });

    it("does not confuse $$ with inline math", () => {
      const text = "text $$math$$ more";
      const regions = findProtectedRegions(text);
      const blockMath = regions.find((r) => r.type === "math_block");
      const inlineMath = regions.find((r) => r.type === "math_inline");
      expect(blockMath).toBeDefined();
      expect(inlineMath).toBeUndefined();
    });
  });

  describe("HTML tags", () => {
    it("detects opening HTML tags", () => {
      const text = "text <div class='test'> more";
      const regions = findProtectedRegions(text);
      const htmlRegion = regions.find((r) => r.type === "html_tag");
      expect(htmlRegion).toBeDefined();
    });

    it("detects closing HTML tags", () => {
      const text = "text </div> more";
      const regions = findProtectedRegions(text);
      const htmlRegion = regions.find((r) => r.type === "html_tag");
      expect(htmlRegion).toBeDefined();
    });
  });

  describe("indented code blocks", () => {
    it("detects 4-space indented code", () => {
      const text = "text\n\n    code line\n    more code\n\nafter";
      const regions = findProtectedRegions(text);
      const indentedRegion = regions.find((r) => r.type === "indented_code");
      expect(indentedRegion).toBeDefined();
    });

    it("does not detect list continuations as code", () => {
      const text = "- list item\n    continuation";
      const regions = findProtectedRegions(text);
      const indentedRegion = regions.find((r) => r.type === "indented_code");
      expect(indentedRegion).toBeUndefined();
    });

    it("does not detect ordered list continuations as code", () => {
      const text = "1. list item\n    continuation";
      const regions = findProtectedRegions(text);
      const indentedRegion = regions.find((r) => r.type === "indented_code");
      expect(indentedRegion).toBeUndefined();
    });
  });
});

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
});
