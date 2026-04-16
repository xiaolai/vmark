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

    it("detects indented code block at end of file", () => {
      // Line 251: indented block extends to text.length when file ends with indented code
      const text = "text\n\n    code line\n    more code";
      const regions = findProtectedRegions(text);
      const indentedRegion = regions.find((r) => r.type === "indented_code");
      expect(indentedRegion).toBeDefined();
      expect(indentedRegion!.end).toBe(text.length);
    });

    it("detects tab-indented code block at end of file", () => {
      const text = "text\n\n\tcode line\n\tmore code";
      const regions = findProtectedRegions(text);
      const indentedRegion = regions.find((r) => r.type === "indented_code");
      expect(indentedRegion).toBeDefined();
      expect(indentedRegion!.end).toBe(text.length);
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

describe("patterns inside already-protected regions are skipped", () => {
  it("skips image syntax inside inline code (line 107)", () => {
    const text = "text `![alt](url)` more";
    const regions = findProtectedRegions(text);
    // Only the inline_code region should be found, not an image region
    expect(regions.filter((r) => r.type === "image")).toHaveLength(0);
    expect(regions.filter((r) => r.type === "inline_code")).toHaveLength(1);
  });

  it("skips link URL inside inline code (line 134)", () => {
    const text = "text `[click](http://x.com)` more";
    const regions = findProtectedRegions(text);
    expect(regions.filter((r) => r.type === "link_url")).toHaveLength(0);
  });

  it("skips HTML tags inside inline code (line 146)", () => {
    const text = "text `<div>hello</div>` more";
    const regions = findProtectedRegions(text);
    expect(regions.filter((r) => r.type === "html_tag")).toHaveLength(0);
  });

  it("skips wiki links inside inline code (line 159)", () => {
    const text = "text `[[page]]` more";
    const regions = findProtectedRegions(text);
    expect(regions.filter((r) => r.type === "wiki_link")).toHaveLength(0);
  });

  it("skips footnote defs inside fenced code (line 183)", () => {
    const text = "text\n```\n[^1]: inside code\n```\nmore";
    const regions = findProtectedRegions(text);
    expect(regions.filter((r) => r.type === "footnote_def")).toHaveLength(0);
  });

  it("skips math block inside fenced code (line 196)", () => {
    const text = "text\n```\n$$x^2$$\n```\nmore";
    const regions = findProtectedRegions(text);
    expect(regions.filter((r) => r.type === "math_block")).toHaveLength(0);
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

describe("findProtectedRegions — reference section skipping", () => {
  it("does not skip reference sections by default", () => {
    const text = "中文Python\n\n## References\n\nAuthor, A. Title.\n\n## Other";
    const regions = findProtectedRegions(text);
    const refRegions = regions.filter((r) => r.type === "reference_section");
    expect(refRegions).toHaveLength(0);
  });

  it("protects References section when skipReferenceSections is true", () => {
    const text = "中文Python\n\n## References\n\nAuthor, A. Title.\n\n## Other";
    const regions = findProtectedRegions(text, { skipReferenceSections: true });
    const refRegions = regions.filter((r) => r.type === "reference_section");
    expect(refRegions).toHaveLength(1);
    const refText = text.slice(refRegions[0].start, refRegions[0].end);
    expect(refText).toContain("## References");
    expect(refText).toContain("Author, A. Title.");
    // Should NOT include the next section
    expect(refText).not.toContain("## Other");
  });

  it("protects Further Reading section when skipReferenceSections is true", () => {
    const text = "Content\n\n## Further Reading\n\n- Book by Author\n- Another resource";
    const regions = findProtectedRegions(text, { skipReferenceSections: true });
    const refRegions = regions.filter((r) => r.type === "reference_section");
    expect(refRegions).toHaveLength(1);
    const refText = text.slice(refRegions[0].start, refRegions[0].end);
    expect(refText).toContain("## Further Reading");
    expect(refText).toContain("Book by Author");
  });

  it("protects References section until end of document", () => {
    const text = "Content\n\n## References\n\nEntry 1.\nEntry 2.";
    const regions = findProtectedRegions(text, { skipReferenceSections: true });
    const refRegions = regions.filter((r) => r.type === "reference_section");
    expect(refRegions).toHaveLength(1);
    expect(refRegions[0].end).toBe(text.length);
  });

  it("protects multiple reference-like sections", () => {
    const text = "Content\n\n## References\n\nRef entry\n\n## Further Reading\n\nBook entry";
    const regions = findProtectedRegions(text, { skipReferenceSections: true });
    const refRegions = regions.filter((r) => r.type === "reference_section");
    // References ends at "## Further Reading", then Further Reading is also protected
    expect(refRegions).toHaveLength(2);
  });

  it("does not protect sections with similar but different names", () => {
    const text = "Content\n\n## Reference Guide\n\nThis is a guide.";
    const regions = findProtectedRegions(text, { skipReferenceSections: true });
    const refRegions = regions.filter((r) => r.type === "reference_section");
    expect(refRegions).toHaveLength(0);
  });
});

describe("findProtectedRegions — inline math inside another region", () => {
  it("skips inline math that appears inside a code span", () => {
    // The $x$ inside backticks should be treated as code, not math_inline
    const text = "`$x$`";
    const regions = findProtectedRegions(text);
    // Should have an inline_code region but no math_inline region
    const mathRegions = regions.filter((r) => r.type === "math_inline");
    expect(mathRegions).toHaveLength(0);
    const codeRegions = regions.filter((r) => r.type === "inline_code");
    expect(codeRegions.length).toBeGreaterThan(0);
  });

  it("skips inline math that appears inside a fenced code block", () => {
    const text = "```\n$x$\n```";
    const regions = findProtectedRegions(text);
    const mathRegions = regions.filter((r) => r.type === "math_inline");
    expect(mathRegions).toHaveLength(0);
  });
});
