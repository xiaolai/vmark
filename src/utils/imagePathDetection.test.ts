// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  detectImagePath,
  detectMultipleImagePaths,
  hasImageExtension,
  IMAGE_EXTENSIONS,
} from "./imagePathDetection";

describe("IMAGE_EXTENSIONS", () => {
  it("includes common image formats with dot prefix", () => {
    expect(IMAGE_EXTENSIONS).toContain(".png");
    expect(IMAGE_EXTENSIONS).toContain(".jpg");
    expect(IMAGE_EXTENSIONS).toContain(".jpeg");
    expect(IMAGE_EXTENSIONS).toContain(".gif");
    expect(IMAGE_EXTENSIONS).toContain(".webp");
    expect(IMAGE_EXTENSIONS).toContain(".svg");
    expect(IMAGE_EXTENSIONS).toContain(".bmp");
    expect(IMAGE_EXTENSIONS).toContain(".ico");
  });
});

describe("hasImageExtension", () => {
  it("returns true for paths with image extensions", () => {
    expect(hasImageExtension("photo.png")).toBe(true);
    expect(hasImageExtension("image.jpg")).toBe(true);
    expect(hasImageExtension("picture.jpeg")).toBe(true);
    expect(hasImageExtension("animation.gif")).toBe(true);
    expect(hasImageExtension("modern.webp")).toBe(true);
    expect(hasImageExtension("vector.svg")).toBe(true);
    expect(hasImageExtension("bitmap.bmp")).toBe(true);
    expect(hasImageExtension("icon.ico")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasImageExtension("photo.PNG")).toBe(true);
    expect(hasImageExtension("image.JPG")).toBe(true);
    expect(hasImageExtension("picture.JPEG")).toBe(true);
  });

  it("returns false for non-image extensions", () => {
    expect(hasImageExtension("document.pdf")).toBe(false);
    expect(hasImageExtension("text.txt")).toBe(false);
    expect(hasImageExtension("code.ts")).toBe(false);
  });

  it("handles URLs with query parameters", () => {
    expect(hasImageExtension("https://example.com/image.png?size=large")).toBe(true);
    expect(hasImageExtension("https://example.com/image.jpg?v=123")).toBe(true);
  });

  it("handles URLs with fragments", () => {
    expect(hasImageExtension("https://example.com/image.png#section")).toBe(true);
  });

  it("handles paths without extension", () => {
    expect(hasImageExtension("noextension")).toBe(false);
    expect(hasImageExtension("/path/to/file")).toBe(false);
  });
});

describe("detectImagePath", () => {
  describe("empty and invalid input", () => {
    it("returns none for empty string", () => {
      const result = detectImagePath("");
      expect(result.isImage).toBe(false);
      expect(result.type).toBe("none");
    });

    it("returns none for whitespace-only string", () => {
      const result = detectImagePath("   \n  ");
      expect(result.isImage).toBe(false);
      expect(result.type).toBe("none");
    });

    it("returns none for non-image paths", () => {
      const result = detectImagePath("/path/to/document.pdf");
      expect(result.isImage).toBe(false);
      expect(result.type).toBe("none");
    });
  });

  describe("data URLs", () => {
    it("detects data: image URLs", () => {
      const result = detectImagePath("data:image/png;base64,iVBORw0KGgo=");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("dataUrl");
      expect(result.needsCopy).toBe(false);
    });

    it("handles various image MIME types in data URLs", () => {
      expect(detectImagePath("data:image/jpeg;base64,abc").isImage).toBe(true);
      expect(detectImagePath("data:image/gif;base64,abc").isImage).toBe(true);
      expect(detectImagePath("data:image/webp;base64,abc").isImage).toBe(true);
    });
  });

  describe("HTTP/HTTPS URLs", () => {
    it("detects HTTP URLs with image extension", () => {
      const result = detectImagePath("http://example.com/photo.png");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("url");
      expect(result.path).toBe("http://example.com/photo.png");
      expect(result.needsCopy).toBe(false);
    });

    it("detects HTTPS URLs with image extension", () => {
      const result = detectImagePath("https://example.com/photo.jpg");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("url");
      expect(result.needsCopy).toBe(false);
    });

    it("rejects HTTP URLs without image extension", () => {
      const result = detectImagePath("https://example.com/page");
      expect(result.isImage).toBe(false);
    });
  });

  describe("file:// URLs", () => {
    it("detects file:// URLs with double slash", () => {
      const result = detectImagePath("file:///Users/name/photo.png");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("absolutePath");
      expect(result.path).toBe("/Users/name/photo.png");
      expect(result.needsCopy).toBe(true);
    });

    it("detects file:// URLs with triple slash", () => {
      const result = detectImagePath("file:///path/to/image.jpg");
      expect(result.isImage).toBe(true);
      expect(result.path).toBe("/path/to/image.jpg");
    });
  });

  describe("Unix absolute paths", () => {
    it("detects Unix absolute paths", () => {
      const result = detectImagePath("/Users/name/Documents/photo.png");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("absolutePath");
      expect(result.path).toBe("/Users/name/Documents/photo.png");
      expect(result.needsCopy).toBe(true);
    });

    it("rejects paths starting with // (not Unix absolute)", () => {
      const result = detectImagePath("//server/share/image.png");
      expect(result.isImage).toBe(false);
    });
  });

  describe("Windows absolute paths", () => {
    it("detects Windows paths with backslash", () => {
      const result = detectImagePath("C:\\Users\\name\\photo.png");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("absolutePath");
      expect(result.needsCopy).toBe(true);
    });

    it("detects Windows paths with forward slash", () => {
      const result = detectImagePath("D:/Photos/vacation/sunset.jpg");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("absolutePath");
    });

    it("handles lowercase drive letters", () => {
      const result = detectImagePath("c:/images/photo.png");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("absolutePath");
    });
  });

  describe("home paths", () => {
    it("detects home directory paths", () => {
      const result = detectImagePath("~/Pictures/photo.png");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("homePath");
      expect(result.path).toBe("~/Pictures/photo.png");
      expect(result.needsCopy).toBe(true);
    });

    it("rejects ~ without slash", () => {
      const result = detectImagePath("~photo.png");
      expect(result.isImage).toBe(false);
    });
  });

  describe("relative paths", () => {
    it("detects ./ relative paths", () => {
      const result = detectImagePath("./assets/image.png");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("relativePath");
      expect(result.needsCopy).toBe(false);
    });

    it("detects ../ relative paths", () => {
      const result = detectImagePath("../images/photo.jpg");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("relativePath");
      expect(result.needsCopy).toBe(false);
    });

    it("detects bare relative paths without ./ prefix", () => {
      const result = detectImagePath("images/photo.jpg");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("relativePath");
      expect(result.needsCopy).toBe(false);
    });

    it("detects bare filename as relative path", () => {
      const result = detectImagePath("photo.png");
      expect(result.isImage).toBe(true);
      expect(result.type).toBe("relativePath");
      expect(result.needsCopy).toBe(false);
    });
  });

  describe("multi-line input", () => {
    it("uses only the first line", () => {
      const input = "/path/to/image.png\n/path/to/other.jpg";
      const result = detectImagePath(input);
      expect(result.isImage).toBe(true);
      expect(result.path).toBe("/path/to/image.png");
    });

    it("trims whitespace", () => {
      const result = detectImagePath("  /path/to/image.png  ");
      expect(result.path).toBe("/path/to/image.png");
    });

    it("returns none when trimmed text has empty first line (only newlines)", () => {
      // trimmed = "\n" still has an empty first line after split
      const result = detectImagePath("\n");
      expect(result.isImage).toBe(false);
      expect(result.type).toBe("none");
    });
  });

  describe("originalText preservation", () => {
    it("preserves original text in result", () => {
      const input = "  /path/to/image.png  ";
      const result = detectImagePath(input);
      expect(result.originalText).toBe(input);
    });
  });
});

describe("detectMultipleImagePaths", () => {
  it("returns allImages true when all paths are images", () => {
    const paths = ["/path/to/a.png", "/path/to/b.jpg", "https://example.com/c.gif"];
    const result = detectMultipleImagePaths(paths);
    expect(result.allImages).toBe(true);
    expect(result.imageCount).toBe(3);
    expect(result.results).toHaveLength(3);
  });

  it("returns allImages false when any path is not an image", () => {
    const paths = ["/path/to/a.png", "/path/to/document.pdf"];
    const result = detectMultipleImagePaths(paths);
    expect(result.allImages).toBe(false);
  });

  it("returns early on first non-image (optimization)", () => {
    const paths = ["/path/to/a.png", "not-an-image", "/path/to/b.jpg"];
    const result = detectMultipleImagePaths(paths);
    expect(result.allImages).toBe(false);
    // Should have stopped after second path
    expect(result.results).toHaveLength(2);
    expect(result.imageCount).toBe(1);
  });

  it("handles empty array", () => {
    const result = detectMultipleImagePaths([]);
    expect(result.allImages).toBe(false);
    expect(result.imageCount).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it("handles single path", () => {
    const result = detectMultipleImagePaths(["/path/to/image.png"]);
    expect(result.allImages).toBe(true);
    expect(result.imageCount).toBe(1);
  });

  it("includes individual detection results", () => {
    const paths = ["/path/to/local.png", "https://example.com/remote.jpg"];
    const result = detectMultipleImagePaths(paths);

    expect(result.results[0].type).toBe("absolutePath");
    expect(result.results[0].needsCopy).toBe(true);

    expect(result.results[1].type).toBe("url");
    expect(result.results[1].needsCopy).toBe(false);
  });
});
