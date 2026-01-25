import { describe, it, expect } from "vitest";
import {
  findMarkdownLinksInLine,
  findWikiLinksInLine,
  findMarkdownLinkAtPosition,
  findWikiLinkAtPosition,
} from "./markdownLinkPatterns";

describe("markdownLinkPatterns", () => {
  describe("findMarkdownLinksInLine", () => {
    it("finds basic markdown link", () => {
      const links = findMarkdownLinksInLine("[text](https://example.com)", 0);
      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({
        from: 0,
        to: 27,
        text: "text",
        url: "https://example.com",
        fullMatch: "[text](https://example.com)",
      });
    });

    it("finds link with title", () => {
      const links = findMarkdownLinksInLine('[text](url "title")', 0);
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe("text");
      expect(links[0].url).toBe("url");
    });

    it("finds link with angle bracket URL", () => {
      const links = findMarkdownLinksInLine("[text](<url with spaces>)", 0);
      expect(links).toHaveLength(1);
      expect(links[0].url).toBe("url with spaces");
    });

    it("skips images by default", () => {
      const links = findMarkdownLinksInLine("![alt](image.png)", 0);
      expect(links).toHaveLength(0);
    });

    it("includes images when skipImages is false", () => {
      const links = findMarkdownLinksInLine("![alt](image.png)", 0, false);
      expect(links).toHaveLength(1);
    });

    it("finds multiple links in one line", () => {
      const links = findMarkdownLinksInLine("[a](1) and [b](2)", 0);
      expect(links).toHaveLength(2);
      expect(links[0].text).toBe("a");
      expect(links[1].text).toBe("b");
    });

    it("handles empty link text", () => {
      const links = findMarkdownLinksInLine("[](url)", 0);
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe("");
    });

    it("calculates correct positions with lineStart offset", () => {
      const links = findMarkdownLinksInLine("[text](url)", 100);
      expect(links[0].from).toBe(100);
      expect(links[0].to).toBe(111);
    });
  });

  describe("findWikiLinksInLine", () => {
    it("finds basic wiki link", () => {
      const links = findWikiLinksInLine("[[page]]", 0);
      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({
        from: 0,
        to: 8,
        target: "page",
        alias: null,
        fullMatch: "[[page]]",
      });
    });

    it("finds wiki link with alias", () => {
      const links = findWikiLinksInLine("[[target|display text]]", 0);
      expect(links).toHaveLength(1);
      expect(links[0].target).toBe("target");
      expect(links[0].alias).toBe("display text");
    });

    it("finds multiple wiki links", () => {
      const links = findWikiLinksInLine("[[a]] and [[b|B]]", 0);
      expect(links).toHaveLength(2);
    });

    it("handles wiki link with path", () => {
      const links = findWikiLinksInLine("[[folder/page]]", 0);
      expect(links[0].target).toBe("folder/page");
    });
  });

  describe("findMarkdownLinkAtPosition", () => {
    it("returns link when position is inside", () => {
      const link = findMarkdownLinkAtPosition("[hello](url)", 0, 3);
      expect(link).not.toBeNull();
      expect(link?.text).toBe("hello");
    });

    it("returns null when position is before link", () => {
      const link = findMarkdownLinkAtPosition("prefix [hello](url)", 0, 2);
      expect(link).toBeNull();
    });

    it("returns null when position is after link", () => {
      const link = findMarkdownLinkAtPosition("[hello](url) suffix", 0, 15);
      expect(link).toBeNull();
    });

    it("returns correct link when multiple exist", () => {
      const link = findMarkdownLinkAtPosition("[a](1) [b](2)", 0, 9);
      expect(link?.text).toBe("b");
    });

    it("returns null for position at exact end (exclusive)", () => {
      // "[hello](url)" has length 12, positions 0-11 are inside
      const link = findMarkdownLinkAtPosition("[hello](url)", 0, 12);
      expect(link).toBeNull();
    });
  });

  describe("findWikiLinkAtPosition", () => {
    it("returns wiki link when position is inside", () => {
      const link = findWikiLinkAtPosition("[[page]]", 0, 4);
      expect(link).not.toBeNull();
      expect(link?.target).toBe("page");
    });

    it("returns null when not inside wiki link", () => {
      const link = findWikiLinkAtPosition("text [[page]]", 0, 2);
      expect(link).toBeNull();
    });

    it("handles wiki link with alias", () => {
      const link = findWikiLinkAtPosition("[[target|alias]]", 0, 10);
      expect(link?.target).toBe("target");
      expect(link?.alias).toBe("alias");
    });
  });
});
