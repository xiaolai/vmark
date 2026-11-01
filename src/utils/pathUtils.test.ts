// @vitest-environment node
/**
 * Tests for cross-platform path utilities.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getFileName,
  getFileNameWithoutExtension,
  getDirectory,
  joinPath,
  revealInFileManagerKey,
} from "./pathUtils";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

      it("returns root for root-level file", () => {
        expect(getDirectory("/document.md")).toBe("/");
      });
    });

    describe("Windows paths", () => {
      it("extracts directory from simple path", () => {
        expect(getDirectory("C:\\Users\\user\\document.md")).toBe("C:\\Users\\user");
      });

      it("extracts directory from nested path", () => {
        expect(getDirectory("C:\\Users\\user\\projects\\readme.md")).toBe("C:\\Users\\user\\projects");
      });

      it("returns drive root with backslash for drive-root file", () => {
        expect(getDirectory("C:\\document.md")).toBe("C:\\");
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

  // WI-RA19.4 — the label is a translation KEY, chosen per platform; the
  // caller translates it. It used to return English literals, so Windows and
  // Linux users in every locale read "Show in Explorer" / "Show in File Manager".
  // On macOS and Linux a backslash is an ordinary filename character, and a path
  // that starts with a single "/" can only be one of theirs.
  describe("a backslash inside a POSIX absolute path", () => {
    it("stays part of the filename", () => {
      expect(getFileName("/notes/a\\b.md")).toBe("a\\b.md");
      expect(getFileName("/a\\b.md")).toBe("a\\b.md");
      expect(getFileName("/notes\\sub/")).toBe("");
    });

    it("stays part of the name without its extension", () => {
      expect(getFileNameWithoutExtension("/notes/a\\b.md")).toBe("a\\b");
      expect(getFileNameWithoutExtension("/notes/a.b\\c")).toBe("a");
    });

    it("does not end the directory early", () => {
      expect(getDirectory("/notes/a\\b.md")).toBe("/notes");
      expect(getDirectory("/notes/a\\b/c.md")).toBe("/notes/a\\b");
      expect(getDirectory("/a\\b.md")).toBe("/");
    });

    it("does not make the joined path use a backslash separator", () => {
      expect(joinPath("/notes/a\\b", "c.md")).toBe("/notes/a\\b/c.md");
      expect(joinPath("/notes/a\\", "c.md")).toBe("/notes/a\\/c.md");
    });

    it.each([
      ["a drive path", "C:\\Users\\a.md", "a.md", "C:\\Users"],
      ["a UNC path", "\\\\server\\share\\a.md", "a.md", "\\\\server\\share"],
      ["a forward-slashed UNC path", "//server/share\\a.md", "a.md", "//server/share"],
      ["a relative path", "docs\\a.md", "a.md", "docs"],
    ])("still splits %s on the backslash", (_label, path, name, directory) => {
      expect(getFileName(path)).toBe(name);
      expect(getDirectory(path)).toBe(directory);
    });

    it("still joins a Windows directory with a backslash", () => {
      expect(joinPath("\\\\server\\share", "a.md")).toBe("\\\\server\\share\\a.md");
    });
  });

  describe("revealInFileManagerKey", () => {
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

    const onPlatform = (platform: string | undefined) =>
      Object.defineProperty(global, "navigator", {
        value: platform === undefined ? undefined : { platform },
        writable: true,
      });

    it.each([
      ["MacIntel", "sidebar:contextMenu.revealInFinder"],
      ["MacARM", "sidebar:contextMenu.revealInFinder"],
      ["Win32", "sidebar:contextMenu.showInExplorer"],
      ["Linux x86_64", "sidebar:contextMenu.showInFileManager"],
      [undefined, "sidebar:contextMenu.showInFileManager"],
    ])("platform %s → %s", (platform, key) => {
      onPlatform(platform);
      expect(revealInFileManagerKey()).toBe(key);
    });

    it("every key it can return is translated in every locale", () => {
      const localesDir = join(import.meta.dirname, "../locales");
      const locales = readdirSync(localesDir).filter((d) => !d.startsWith("_") && !d.includes("."));
      expect(locales.length).toBeGreaterThan(1);
      for (const platform of ["MacIntel", "Win32", "Linux x86_64"]) {
        onPlatform(platform);
        const local = revealInFileManagerKey().replace(/^sidebar:/, "");
        for (const locale of locales) {
          const sidebar = JSON.parse(readFileSync(join(localesDir, locale, "sidebar.json"), "utf8")) as Record<string, unknown>;
          expect(typeof sidebar[local], `${locale}/${local}`).toBe("string");
        }
      }
    });
  });
});
