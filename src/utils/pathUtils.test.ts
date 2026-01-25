/**
 * Tests for cross-platform path utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getFileName,
  getFileNameWithoutExtension,
  getDirectory,
  joinPath,
  getRevealInFileManagerLabel,
} from "./pathUtils";

describe("pathUtils", () => {
  describe("getFileName", () => {
    describe("POSIX paths (forward slash)", () => {
      it("extracts filename from simple path", () => {
        expect(getFileName("/home/user/document.md")).toBe("document.md");
      });

      it("extracts filename from nested path", () => {
        expect(getFileName("/home/user/projects/docs/readme.md")).toBe("readme.md");
      });

      it("handles path with only filename", () => {
        expect(getFileName("document.md")).toBe("document.md");
      });

      it("handles root path", () => {
        expect(getFileName("/document.md")).toBe("document.md");
      });

      it("handles trailing slash", () => {
        expect(getFileName("/home/user/")).toBe("");
      });

      it("handles empty string", () => {
        expect(getFileName("")).toBe("");
      });
    });

    describe("Windows paths (backslash)", () => {
      it("extracts filename from simple path", () => {
        expect(getFileName("C:\\Users\\user\\document.md")).toBe("document.md");
      });

      it("extracts filename from nested path", () => {
        expect(getFileName("C:\\Users\\user\\projects\\docs\\readme.md")).toBe("readme.md");
      });

      it("handles drive letter only", () => {
        expect(getFileName("C:\\document.md")).toBe("document.md");
      });

      it("handles trailing backslash", () => {
        expect(getFileName("C:\\Users\\user\\")).toBe("");
      });
    });

    describe("mixed separators", () => {
      it("handles mixed forward and back slashes", () => {
        expect(getFileName("C:\\Users/user\\document.md")).toBe("document.md");
      });
    });

    describe("edge cases", () => {
      it("handles filename with multiple dots", () => {
        expect(getFileName("/path/to/file.test.ts")).toBe("file.test.ts");
      });

      it("handles dotfiles", () => {
        expect(getFileName("/path/to/.gitignore")).toBe(".gitignore");
      });

      it("handles filename with spaces", () => {
        expect(getFileName("/path/to/my document.md")).toBe("my document.md");
      });
    });
  });

  describe("getFileNameWithoutExtension", () => {
    it("removes extension from simple filename", () => {
      expect(getFileNameWithoutExtension("/path/document.md")).toBe("document");
    });

    it("removes extension from filename with multiple dots", () => {
      expect(getFileNameWithoutExtension("/path/file.test.ts")).toBe("file.test");
    });

    it("handles filename without extension", () => {
      expect(getFileNameWithoutExtension("/path/README")).toBe("README");
    });

    it("handles dotfile (keeps the name)", () => {
      // .gitignore has no extension, the whole thing is the name
      expect(getFileNameWithoutExtension("/path/.gitignore")).toBe(".gitignore");
    });

    it("handles file starting with dot and having extension", () => {
      expect(getFileNameWithoutExtension("/path/.env.local")).toBe(".env");
    });

    it("handles Windows path", () => {
      expect(getFileNameWithoutExtension("C:\\Users\\doc.txt")).toBe("doc");
    });
  });

  describe("getDirectory", () => {
    describe("POSIX paths", () => {
      it("extracts directory from simple path", () => {
        expect(getDirectory("/home/user/document.md")).toBe("/home/user");
      });

      it("extracts directory from nested path", () => {
        expect(getDirectory("/home/user/projects/docs/readme.md")).toBe("/home/user/projects/docs");
      });

      it("returns empty for filename only", () => {
        expect(getDirectory("document.md")).toBe("");
      });

      it("extracts root directory", () => {
        expect(getDirectory("/document.md")).toBe("");
      });
    });

    describe("Windows paths", () => {
      it("extracts directory from simple path", () => {
        expect(getDirectory("C:\\Users\\user\\document.md")).toBe("C:\\Users\\user");
      });

      it("extracts directory from nested path", () => {
        expect(getDirectory("C:\\Users\\user\\projects\\readme.md")).toBe("C:\\Users\\user\\projects");
      });

      it("extracts drive root", () => {
        expect(getDirectory("C:\\document.md")).toBe("C:");
      });
    });
  });

  describe("joinPath", () => {
    describe("POSIX paths", () => {
      it("joins directory and filename", () => {
        expect(joinPath("/home/user", "document.md")).toBe("/home/user/document.md");
      });

      it("handles trailing slash in directory", () => {
        expect(joinPath("/home/user/", "document.md")).toBe("/home/user/document.md");
      });

      it("handles empty directory", () => {
        expect(joinPath("", "document.md")).toBe("document.md");
      });
    });

    describe("Windows paths", () => {
      it("joins directory and filename", () => {
        expect(joinPath("C:\\Users\\user", "document.md")).toBe("C:\\Users\\user\\document.md");
      });

      it("handles trailing backslash in directory", () => {
        expect(joinPath("C:\\Users\\user\\", "document.md")).toBe("C:\\Users\\user\\document.md");
      });

      it("detects Windows separator from directory", () => {
        const result = joinPath("C:\\Users", "file.txt");
        expect(result).toContain("\\");
        expect(result).not.toMatch(/[^C].*\//); // No forward slashes except possibly in filename
      });
    });

    describe("separator detection", () => {
      it("uses forward slash for POSIX directory", () => {
        const result = joinPath("/home/user", "file.txt");
        expect(result).toBe("/home/user/file.txt");
      });

      it("uses backslash for Windows directory", () => {
        const result = joinPath("C:\\Users", "file.txt");
        expect(result).toBe("C:\\Users\\file.txt");
      });

      it("defaults to forward slash for simple directory", () => {
        const result = joinPath("subdir", "file.txt");
        expect(result).toBe("subdir/file.txt");
      });
    });
  });

  describe("getRevealInFileManagerLabel", () => {
    let originalNavigator: typeof navigator;

    beforeEach(() => {
      originalNavigator = global.navigator;
    });

    afterEach(() => {
      Object.defineProperty(global, "navigator", {
        value: originalNavigator,
        writable: true,
      });
    });

    it("returns 'Reveal in Finder' for macOS", () => {
      Object.defineProperty(global, "navigator", {
        value: { platform: "MacIntel" },
        writable: true,
      });
      expect(getRevealInFileManagerLabel()).toBe("Reveal in Finder");
    });

    it("returns 'Reveal in Finder' for mac arm", () => {
      Object.defineProperty(global, "navigator", {
        value: { platform: "MacARM" },
        writable: true,
      });
      expect(getRevealInFileManagerLabel()).toBe("Reveal in Finder");
    });

    it("returns 'Show in Explorer' for Windows", () => {
      Object.defineProperty(global, "navigator", {
        value: { platform: "Win32" },
        writable: true,
      });
      expect(getRevealInFileManagerLabel()).toBe("Show in Explorer");
    });

    it("returns 'Show in File Manager' for Linux", () => {
      Object.defineProperty(global, "navigator", {
        value: { platform: "Linux x86_64" },
        writable: true,
      });
      expect(getRevealInFileManagerLabel()).toBe("Show in File Manager");
    });

    it("returns 'Show in File Manager' when navigator is undefined", () => {
      Object.defineProperty(global, "navigator", {
        value: undefined,
        writable: true,
      });
      expect(getRevealInFileManagerLabel()).toBe("Show in File Manager");
    });
  });
});
