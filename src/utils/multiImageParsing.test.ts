// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseMultiplePaths } from "./multiImageParsing";

describe("parseMultiplePaths", () => {
  describe("newline-separated format", () => {
    it("parses multiple paths separated by newlines", () => {
      const input = "/path/to/image1.jpg\n/path/to/image2.png";
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["/path/to/image1.jpg", "/path/to/image2.png"]);
      expect(result.format).toBe("newline");
    });

    it("handles empty lines between paths", () => {
      const input = "/path/to/image1.jpg\n\n/path/to/image2.png";
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["/path/to/image1.jpg", "/path/to/image2.png"]);
      expect(result.format).toBe("newline");
    });

    it("trims whitespace from each line", () => {
      const input = "  /path/to/image1.jpg  \n  /path/to/image2.png  ";
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["/path/to/image1.jpg", "/path/to/image2.png"]);
    });
  });

  describe("shell-style format", () => {
    it("parses space-separated paths without quotes", () => {
      const input = "/path/one.jpg /path/two.png";
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["/path/one.jpg", "/path/two.png"]);
      expect(result.format).toBe("shell");
    });

    it("parses quoted paths with spaces", () => {
      const input = '"/path/with spaces/image.png" /path/other.jpg';
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["/path/with spaces/image.png", "/path/other.jpg"]);
      expect(result.format).toBe("shell");
    });

    it("parses single-quoted paths", () => {
      const input = "'/path/with spaces/image.png' /path/other.jpg";
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["/path/with spaces/image.png", "/path/other.jpg"]);
      expect(result.format).toBe("shell");
    });

    it("handles mixed quotes", () => {
      const input = `"/path/one.png" '/path/two.jpg'`;
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["/path/one.png", "/path/two.jpg"]);
      expect(result.format).toBe("shell");
    });

    it("handles home paths", () => {
      const input = "~/image1.png ~/image2.jpg";
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["~/image1.png", "~/image2.jpg"]);
      expect(result.format).toBe("shell");
    });

    it("handles URLs mixed with paths", () => {
      const input = "https://example.com/image.png /local/path.jpg";
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["https://example.com/image.png", "/local/path.jpg"]);
      expect(result.format).toBe("shell");
    });
  });

  describe("single path", () => {
    it("returns single format for one path", () => {
      const input = "/path/to/image.jpg";
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["/path/to/image.jpg"]);
      expect(result.format).toBe("single");
    });

    it("returns single format for one quoted path", () => {
      const input = '"/path/with spaces/image.jpg"';
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["/path/with spaces/image.jpg"]);
      expect(result.format).toBe("single");
    });
  });

  describe("edge cases", () => {
    it("returns empty for empty input", () => {
      const result = parseMultiplePaths("");
      expect(result.paths).toEqual([]);
      expect(result.format).toBe("single");
    });

    it("returns empty for whitespace-only input", () => {
      const result = parseMultiplePaths("   ");
      expect(result.paths).toEqual([]);
      expect(result.format).toBe("single");
    });

    it("handles trailing spaces", () => {
      const input = "/path/one.jpg /path/two.png   ";
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["/path/one.jpg", "/path/two.png"]);
    });

    it("handles multiple spaces between paths", () => {
      const input = "/path/one.jpg    /path/two.png";
      const result = parseMultiplePaths(input);
      expect(result.paths).toEqual(["/path/one.jpg", "/path/two.png"]);
    });
  });

  describe("newline format with single path (line 133 branch)", () => {
    it("returns single format when newline-split yields only one path", () => {
      // Text has a newline but only one non-empty line → format is "single"
      const result = parseMultiplePaths("/path/to/image.jpg\n");
      expect(result.paths).toEqual(["/path/to/image.jpg"]);
      expect(result.format).toBe("single");
    });

    it("returns single format with leading blank line before single path", () => {
      const result = parseMultiplePaths("\n/path/to/image.jpg");
      expect(result.paths).toEqual(["/path/to/image.jpg"]);
      expect(result.format).toBe("single");
    });
  });

  describe("shell parse with zero paths (line 140 branch)", () => {
    it("returns empty paths when quoted text contains only empty string", () => {
      // '""' is non-empty (passes !trimmed guard), no newlines, shell parse yields 0 paths
      const result = parseMultiplePaths('""');
      expect(result.paths).toEqual([]);
      expect(result.format).toBe("single");
    });
  });
});

describe("mightContainMultiplePaths (tested via parseMultiplePaths)", () => {
  it("parses text with newlines as multiple paths", () => {
    const result = parseMultiplePaths("/path/one.jpg\n/path/two.jpg");
    expect(result.paths.length).toBe(2);
  });

  it("parses text with quotes", () => {
    const result = parseMultiplePaths('"/path/image.jpg"');
    expect(result.paths).toEqual(["/path/image.jpg"]);
  });

  it("parses paths with spaces as multiple", () => {
    const result = parseMultiplePaths("/path/one.jpg /path/two.jpg");
    expect(result.paths.length).toBe(2);
  });

  it("parses single path without spaces", () => {
    const result = parseMultiplePaths("/path/to/image.jpg");
    expect(result.format).toBe("single");
  });

  it("returns empty for empty string", () => {
    const result = parseMultiplePaths("");
    expect(result.paths).toEqual([]);
  });
});
