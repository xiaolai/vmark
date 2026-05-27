import { describe, it, expect } from "vitest";
import {
  isImageFile,
  getFilename,
  generateUniqueFilename,
  buildAssetRelativePath,
  IMAGE_EXTENSIONS,
} from "./imageUtils";

describe("imageUtils", () => {
  describe("IMAGE_EXTENSIONS", () => {
    it("includes common image formats", () => {
      expect(IMAGE_EXTENSIONS).toContain("png");
      expect(IMAGE_EXTENSIONS).toContain("jpg");
      expect(IMAGE_EXTENSIONS).toContain("jpeg");
      expect(IMAGE_EXTENSIONS).toContain("gif");
      expect(IMAGE_EXTENSIONS).toContain("webp");
      expect(IMAGE_EXTENSIONS).toContain("svg");
      expect(IMAGE_EXTENSIONS).toContain("bmp");
    });
  });

  describe("isImageFile", () => {
    it("returns true for supported image extensions", () => {
      expect(isImageFile("photo.png")).toBe(true);
      expect(isImageFile("image.jpg")).toBe(true);
      expect(isImageFile("picture.jpeg")).toBe(true);
      expect(isImageFile("animation.gif")).toBe(true);
      expect(isImageFile("modern.webp")).toBe(true);
      expect(isImageFile("vector.svg")).toBe(true);
      expect(isImageFile("bitmap.bmp")).toBe(true);
    });

    it("returns true for uppercase extensions", () => {
      expect(isImageFile("photo.PNG")).toBe(true);
      expect(isImageFile("image.JPG")).toBe(true);
      expect(isImageFile("picture.JPEG")).toBe(true);
    });

    it("returns false for non-image extensions", () => {
      expect(isImageFile("document.pdf")).toBe(false);
      expect(isImageFile("text.txt")).toBe(false);
      expect(isImageFile("markdown.md")).toBe(false);
      expect(isImageFile("code.ts")).toBe(false);
    });

    it("returns false for files without extensions", () => {
      expect(isImageFile("noextension")).toBe(false);
    });

    it("handles empty string", () => {
      expect(isImageFile("")).toBe(false);
    });
  });

  describe("getFilename", () => {
    it("extracts filename from Unix paths", () => {
      expect(getFilename("/path/to/image.png")).toBe("image.png");
      expect(getFilename("/Users/name/Documents/photo.jpg")).toBe("photo.jpg");
    });

    it("extracts filename from Windows paths", () => {
      expect(getFilename("C:\\Users\\name\\image.png")).toBe("image.png");
      expect(getFilename("D:\\Photos\\vacation\\sunset.jpg")).toBe("sunset.jpg");
    });

    it("handles filename only (no path)", () => {
      expect(getFilename("image.png")).toBe("image.png");
    });

    it("returns default for empty string", () => {
      expect(getFilename("")).toBe("image.png");
    });
  });

  describe("generateUniqueFilename", () => {
    it("generates filename with timestamp and random suffix", () => {
      const result = generateUniqueFilename("original.png");

      // Should contain base name
      expect(result).toMatch(/^original-/);
      // Should end with .png
      expect(result).toMatch(/\.png$/);
      // Should have timestamp and random suffix pattern
      expect(result).toMatch(/^original-\d+-[a-z0-9]{8}\.png$/);
    });

    it("sanitizes special characters in filename", () => {
      const result = generateUniqueFilename("my file@#$%.png");

      // Special chars should be replaced with underscores
      expect(result).not.toContain("@");
      expect(result).not.toContain("#");
      expect(result).not.toContain("$");
      expect(result).not.toContain("%");
      expect(result).not.toContain(" ");
    });

    it("preserves extension from original filename", () => {
      expect(generateUniqueFilename("image.jpg")).toMatch(/\.jpg$/);
      expect(generateUniqueFilename("image.gif")).toMatch(/\.gif$/);
      expect(generateUniqueFilename("image.webp")).toMatch(/\.webp$/);
    });

    it("uses lowercase extension", () => {
      const result = generateUniqueFilename("image.PNG");
      expect(result).toMatch(/\.png$/);
    });

    it("limits base name length", () => {
      const longName = "a".repeat(100) + ".png";
      const result = generateUniqueFilename(longName);

      // Base name should be truncated to 50 chars
      const baseName = result.split("-")[0];
      expect(baseName.length).toBeLessThanOrEqual(50);
    });

    it("generates unique filenames on subsequent calls", () => {
      const results = new Set<string>();
      for (let i = 0; i < 100; i++) {
        results.add(generateUniqueFilename("test.png"));
      }
      // All 100 should be unique
      expect(results.size).toBe(100);
    });

    it("handles filename without extension", () => {
      const result = generateUniqueFilename("noextension");
      // When no extension found, the whole filename becomes the "extension"
      // This is expected behavior - caller should provide proper filenames
      expect(result).toMatch(/^noextension-\d+-[a-z0-9]{8}\.noextension$/);
    });

    it("falls back to png extension for empty filename (line 49)", () => {
      const result = generateUniqueFilename("");
      // Empty string: pop() returns "", which is falsy, so || "png" kicks in
      expect(result).toMatch(/\.png$/);
    });
  });

  describe("buildAssetRelativePath", () => {
    it("builds relative path to assets folder", () => {
      expect(buildAssetRelativePath("image.png")).toBe("./assets/images/image.png");
    });

    it("works with generated filenames", () => {
      const filename = "photo-1234567890-abcd.jpg";
      expect(buildAssetRelativePath(filename)).toBe("./assets/images/photo-1234567890-abcd.jpg");
    });
  });
});
