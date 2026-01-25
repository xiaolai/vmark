/**
 * Tests for image path security.
 *
 * These tests verify protection against path traversal attacks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isRelativePath,
  isAbsolutePath,
  isExternalUrl,
  validateImagePath,
  sanitizeImagePath,
} from "./security";

describe("imageView security", () => {
  describe("isRelativePath", () => {
    it("returns true for ./ prefix", () => {
      expect(isRelativePath("./image.png")).toBe(true);
      expect(isRelativePath("./assets/image.png")).toBe(true);
      expect(isRelativePath("./nested/path/image.png")).toBe(true);
    });

    it("returns true for assets/ prefix", () => {
      expect(isRelativePath("assets/image.png")).toBe(true);
      expect(isRelativePath("assets/nested/image.png")).toBe(true);
    });

    it("returns false for other paths", () => {
      expect(isRelativePath("image.png")).toBe(false);
      expect(isRelativePath("/absolute/path.png")).toBe(false);
      expect(isRelativePath("../parent/image.png")).toBe(false);
      expect(isRelativePath("http://example.com/image.png")).toBe(false);
    });
  });

  describe("isAbsolutePath", () => {
    describe("POSIX absolute paths", () => {
      it("returns true for / prefix", () => {
        expect(isAbsolutePath("/home/user/image.png")).toBe(true);
        expect(isAbsolutePath("/etc/passwd")).toBe(true);
        expect(isAbsolutePath("/")).toBe(true);
      });
    });

    describe("Windows absolute paths", () => {
      it("returns true for drive letter prefix", () => {
        expect(isAbsolutePath("C:\\Users\\image.png")).toBe(true);
        expect(isAbsolutePath("D:/Documents/image.png")).toBe(true);
        expect(isAbsolutePath("c:\\path")).toBe(true);
        expect(isAbsolutePath("Z:")).toBe(true);
      });
    });

    it("returns false for relative paths", () => {
      expect(isAbsolutePath("./image.png")).toBe(false);
      expect(isAbsolutePath("assets/image.png")).toBe(false);
      expect(isAbsolutePath("image.png")).toBe(false);
      expect(isAbsolutePath("../image.png")).toBe(false);
    });

    it("returns false for URLs", () => {
      expect(isAbsolutePath("http://example.com")).toBe(false);
      expect(isAbsolutePath("https://example.com")).toBe(false);
    });
  });

  describe("isExternalUrl", () => {
    it("returns true for http URLs", () => {
      expect(isExternalUrl("http://example.com/image.png")).toBe(true);
      expect(isExternalUrl("http://localhost:3000/image.png")).toBe(true);
    });

    it("returns true for https URLs", () => {
      expect(isExternalUrl("https://example.com/image.png")).toBe(true);
      expect(isExternalUrl("https://cdn.example.com/path/image.png")).toBe(true);
    });

    it("returns true for data URLs", () => {
      expect(isExternalUrl("data:image/png;base64,abc123")).toBe(true);
      expect(isExternalUrl("data:text/html,<h1>Test</h1>")).toBe(true);
    });

    it("returns false for file paths", () => {
      expect(isExternalUrl("./image.png")).toBe(false);
      expect(isExternalUrl("/absolute/image.png")).toBe(false);
      expect(isExternalUrl("assets/image.png")).toBe(false);
      expect(isExternalUrl("C:\\image.png")).toBe(false);
    });

    it("returns false for other protocols", () => {
      expect(isExternalUrl("ftp://example.com/file")).toBe(false);
      expect(isExternalUrl("file:///path/to/file")).toBe(false);
    });
  });

  describe("validateImagePath", () => {
    describe("path traversal attacks", () => {
      it("rejects paths with .. (parent directory)", () => {
        expect(validateImagePath("../../../etc/passwd")).toBe(false);
        expect(validateImagePath("./assets/../../../etc/passwd")).toBe(false);
        expect(validateImagePath("assets/../secret.txt")).toBe(false);
        expect(validateImagePath("..")).toBe(false);
        expect(validateImagePath("a../b")).toBe(false);
        expect(validateImagePath("../")).toBe(false);
      });

      it("rejects absolute POSIX paths", () => {
        expect(validateImagePath("/etc/passwd")).toBe(false);
        expect(validateImagePath("/home/user/secret.txt")).toBe(false);
        expect(validateImagePath("/")).toBe(false);
      });

      it("rejects absolute Windows paths", () => {
        expect(validateImagePath("C:\\Windows\\System32")).toBe(false);
        expect(validateImagePath("D:\\sensitive.txt")).toBe(false);
        expect(validateImagePath("c:\\Users")).toBe(false);
      });
    });

    describe("valid paths", () => {
      it("accepts ./ prefixed paths", () => {
        expect(validateImagePath("./image.png")).toBe(true);
        expect(validateImagePath("./assets/image.png")).toBe(true);
        expect(validateImagePath("./nested/deep/path/image.png")).toBe(true);
      });

      it("accepts assets/ prefixed paths", () => {
        expect(validateImagePath("assets/image.png")).toBe(true);
        expect(validateImagePath("assets/nested/image.png")).toBe(true);
      });
    });

    describe("edge cases", () => {
      it("rejects paths without valid prefix", () => {
        expect(validateImagePath("image.png")).toBe(false);
        expect(validateImagePath("nested/image.png")).toBe(false);
      });

      it("handles empty string", () => {
        expect(validateImagePath("")).toBe(false);
      });

      it("handles URLs (not relative paths)", () => {
        expect(validateImagePath("http://example.com/image.png")).toBe(false);
        expect(validateImagePath("https://example.com/image.png")).toBe(false);
      });
    });
  });

  describe("sanitizeImagePath", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("returns path for valid relative paths", () => {
      expect(sanitizeImagePath("./image.png")).toBe("./image.png");
      expect(sanitizeImagePath("./assets/image.png")).toBe("./assets/image.png");
      expect(sanitizeImagePath("assets/image.png")).toBe("assets/image.png");
    });

    it("returns null for path traversal attempts", () => {
      expect(sanitizeImagePath("../../../etc/passwd")).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it("returns null for absolute paths", () => {
      expect(sanitizeImagePath("/etc/passwd")).toBeNull();
      expect(sanitizeImagePath("C:\\Windows\\System32")).toBeNull();
    });

    it("logs warning for rejected paths", () => {
      sanitizeImagePath("../malicious.txt");
      expect(warnSpy).toHaveBeenCalledWith(
        "[ImageView] Rejected suspicious image path:",
        "../malicious.txt"
      );
    });
  });
});
