// @vitest-environment node
/**
 * Tests for media path classification.
 *
 * The refusals that carry weight are URI schemes, home-relative paths and
 * directory-naming paths. A `..` segment is NOT refused (#1433) — see the
 * header of `mediaSecurity.ts` for the measurement behind that.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isRelativePath,
  isAbsolutePath,
  isExternalUrl,
  validateImagePath,
  sanitizeImagePath,
} from "./mediaSecurity";

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

    it("returns true for bare relative paths (no ./ prefix)", () => {
      expect(isRelativePath("image.png")).toBe(true);
      expect(isRelativePath("images/photo.jpg")).toBe(true);
      expect(isRelativePath("nested/deep/image.png")).toBe(true);
      expect(isRelativePath("my-folder/pic.webp")).toBe(true);
    });

    it("returns false for absolute paths and URLs", () => {
      expect(isRelativePath("/absolute/path.png")).toBe(false);
      expect(isRelativePath("C:\\Users\\image.png")).toBe(false);
      expect(isRelativePath("http://example.com/image.png")).toBe(false);
      expect(isRelativePath("https://example.com/image.png")).toBe(false);
      expect(isRelativePath("data:image/png;base64,abc")).toBe(false);
      expect(isRelativePath("asset://localhost/image.png")).toBe(false);
      expect(isRelativePath("tauri://localhost/image.png")).toBe(false);
    });

    it("returns true for parent-relative paths (#1433)", () => {
      // `notes/report.md` referencing `../images/photo.png` is the standard
      // layout for a shared assets folder, and every other markdown tool
      // resolves it. Rejecting it rendered a broken placeholder.
      expect(isRelativePath("../parent/image.png")).toBe(true);
      expect(isRelativePath("../../images/photo.png")).toBe(true);
      expect(isRelativePath("./../sibling/photo.png")).toBe(true);
    });

    it("returns false for home-relative paths", () => {
      expect(isRelativePath("~/photo.png")).toBe(false);
      expect(isRelativePath("~")).toBe(false);
    });

    it("returns false for degenerate inputs", () => {
      expect(isRelativePath("")).toBe(false);
      expect(isRelativePath("   ")).toBe(false);
      expect(isRelativePath(".")).toBe(false);
    });

    it("returns false for a path that names a DIRECTORY, not a file", () => {
      // Allowing `..` as a segment must not start accepting sources that
      // resolve to a directory: no loader can decode one, so the honest
      // answer is a refusal rather than a broken element.
      expect(isRelativePath("..")).toBe(false);
      expect(isRelativePath("../")).toBe(false);
      expect(isRelativePath("../images/")).toBe(false);
      expect(isRelativePath("assets/..")).toBe(false);
      expect(isRelativePath("./")).toBe(false);
    });

    it("returns false for non-standard URI schemes", () => {
      expect(isRelativePath("javascript:alert(1)")).toBe(false);
      expect(isRelativePath("vbscript:code")).toBe(false);
      expect(isRelativePath("blob:http://example.com")).toBe(false);
      expect(isRelativePath("HTTPS://example.com/image.png")).toBe(false);
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
    describe("parent-relative paths", () => {
      it("accepts `..` as a path segment (#1433)", () => {
        // `..` is ordinary path syntax, not an attack signature. The set of
        // files reachable through it is already reachable by writing an
        // absolute path, which every resolver converts one branch earlier
        // with no validation at all — so refusing `..` cost the common
        // authoring layout and bought no containment. See the module header.
        expect(validateImagePath("../images/photo.png")).toBe(true);
        expect(validateImagePath("./assets/../photo.png")).toBe(true);
        expect(validateImagePath("assets/../secret.txt")).toBe(true);
      });

      it("still rejects a path that names a directory", () => {
        expect(validateImagePath("..")).toBe(false);
        expect(validateImagePath("../")).toBe(false);
        expect(validateImagePath("../images/")).toBe(false);
      });

      it("allows filenames containing consecutive dots (not traversal)", () => {
        expect(validateImagePath("a../b")).toBe(true);
        expect(validateImagePath("my..photo.png")).toBe(true);
        expect(validateImagePath("images/v1..2/photo.png")).toBe(true);
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

      it("accepts bare relative paths", () => {
        expect(validateImagePath("image.png")).toBe(true);
        expect(validateImagePath("images/photo.jpg")).toBe(true);
        expect(validateImagePath("nested/deep/image.png")).toBe(true);
      });
    });

    describe("edge cases", () => {

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
      expect(sanitizeImagePath("images/photo.jpg")).toBe("images/photo.jpg");
    });

    it("passes a parent-relative path through (#1433)", () => {
      expect(sanitizeImagePath("../images/photo.png")).toBe("../images/photo.png");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("returns null for a source carrying a URI scheme", () => {
      expect(sanitizeImagePath("javascript:alert(1)")).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it("returns null for absolute paths", () => {
      expect(sanitizeImagePath("/etc/passwd")).toBeNull();
      expect(sanitizeImagePath("C:\\Windows\\System32")).toBeNull();
    });

    it("logs warning for rejected paths", () => {
      sanitizeImagePath("~/malicious.txt");
      expect(warnSpy).toHaveBeenCalledWith(
        "[ImageView]",
        "Rejected suspicious image path:",
        "~/malicious.txt"
      );
    });
  });
});
