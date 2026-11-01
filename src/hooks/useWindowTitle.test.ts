// @vitest-environment node
/**
 * useWindowTitle — pure function tests
 *
 * Tests the title formatting logic extracted from useWindowTitle.ts:
 *   - Window title with dirty indicator
 *   - Document title (for print PDF naming)
 *   - The optional parent folder, and every path that has none to show
 *   - Various file path formats (POSIX, Windows, no extension)
 *   - The unsaved-document fallback is a CALLER-SUPPLIED label, so it can be
 *     translated (#1296): off macOS this string is always on screen, in the
 *     native title bar, whatever the UI language.
 */

import { describe, it, expect } from "vitest";
import { formatWindowTitle, formatDocumentTitle } from "./useWindowTitle";

/** The English label the app passes; spelled out so the tests read as before. */
const UNTITLED = "Untitled";

// ---------------------------------------------------------------------------
// formatWindowTitle
// ---------------------------------------------------------------------------
describe("formatWindowTitle", () => {
  it("returns the filename when not dirty", () => {
    expect(formatWindowTitle("/path/to/readme.md", false, false, UNTITLED)).toBe("readme.md");
  });

  it("prepends the dirty indicator when dirty", () => {
    expect(formatWindowTitle("/path/to/readme.md", true, false, UNTITLED)).toBe("• readme.md");
  });

  it("uses the supplied fallback label when filePath is null", () => {
    expect(formatWindowTitle(null, false, false, UNTITLED)).toBe("Untitled");
  });

  it("uses the supplied fallback label when filePath is undefined", () => {
    expect(formatWindowTitle(undefined, false, false, UNTITLED)).toBe("Untitled");
  });

  it("uses the supplied fallback label with dirty indicator", () => {
    expect(formatWindowTitle(null, true, false, UNTITLED)).toBe("• Untitled");
  });

  it("uses the supplied fallback label when filePath is empty string", () => {
    expect(formatWindowTitle("", false, false, UNTITLED)).toBe("Untitled");
  });

  it("uses the fallback label VERBATIM — no hardcoded English underneath", () => {
    expect(formatWindowTitle(null, false, false, "未命名")).toBe("未命名");
    expect(formatWindowTitle(null, true, false, "Sans titre")).toBe("• Sans titre");
  });

  it("handles Windows backslash paths", () => {
    expect(formatWindowTitle("C:\\Users\\test\\doc.md", false, false, UNTITLED)).toBe("doc.md");
  });

  it("handles path with no directory", () => {
    expect(formatWindowTitle("notes.md", false, false, UNTITLED)).toBe("notes.md");
  });

  it("handles file with multiple dots", () => {
    expect(formatWindowTitle("/path/my.notes.2024.md", false, false, UNTITLED)).toBe(
      "my.notes.2024.md"
    );
  });

  // #1618 — two windows on two README.md files read the same in the Dock.
  describe("with the parent folder (#1618)", () => {
    it.each([
      ["a POSIX path", "/path/to/readme.md", "to | readme.md"],
      ["a backslash in the folder name", "/notes/a\\b/readme.md", "a\\b | readme.md"],
      ["a backslash in the filename", "/notes/a\\b.md", "notes | a\\b.md"],
      ["a CJK folder and file", "/文档/项目/说明.md", "项目 | 说明.md"],
      ["a folder name holding the separator", "/a | b/c.md", "a | b | c.md"],
      ["a doubled separator", "/notes//readme.md", "notes | readme.md"],
      ["a current-directory segment", "/notes/./readme.md", "notes | readme.md"],
      ["a parent-directory segment", "/notes/archive/../readme.md", "notes | readme.md"],
    ])("names the folder for %s", (_label, path, expected) => {
      expect(formatWindowTitle(path, false, true, UNTITLED)).toBe(expected);
    });

    it("keeps the dirty indicator in front of the folder", () => {
      expect(formatWindowTitle("/path/to/readme.md", true, true, UNTITLED)).toBe(
        "• to | readme.md"
      );
    });

    // None of these has a folder to name: a leading " | " would be the bug.
    it.each([
      ["the POSIX root", "/readme.md", "readme.md"],
      ["a doubled root separator", "//readme.md", "readme.md"],
      ["a path that climbs back to the root", "/notes/../readme.md", "readme.md"],
      ["a bare filename", "notes.md", "notes.md"],
    ])("omits the separator at %s", (_label, path, expected) => {
      expect(formatWindowTitle(path, false, true, UNTITLED)).toBe(expected);
    });

    it.each([[null], [undefined], [""]])("uses only the fallback label for %j", (path) => {
      expect(formatWindowTitle(path, false, true, UNTITLED)).toBe("Untitled");
    });
  });
});

// ---------------------------------------------------------------------------
// formatDocumentTitle
// ---------------------------------------------------------------------------
describe("formatDocumentTitle", () => {
  it("returns filename without extension for print PDF naming", () => {
    expect(formatDocumentTitle("/path/to/readme.md", UNTITLED)).toBe("readme");
  });

  it("strips extension from Windows path", () => {
    expect(formatDocumentTitle("C:\\Users\\test\\doc.md", UNTITLED)).toBe("doc");
  });

  it("returns the supplied fallback label for null filePath", () => {
    expect(formatDocumentTitle(null, UNTITLED)).toBe("Untitled");
  });

  it("returns the supplied fallback label for undefined filePath", () => {
    expect(formatDocumentTitle(undefined, UNTITLED)).toBe("Untitled");
  });

  it("returns the supplied fallback label for empty string", () => {
    expect(formatDocumentTitle("", UNTITLED)).toBe("Untitled");
  });

  it("uses the fallback label VERBATIM — it becomes the print-to-PDF filename", () => {
    expect(formatDocumentTitle(null, "未命名")).toBe("未命名");
  });

  it("strips only the last extension from multi-dot filenames", () => {
    expect(formatDocumentTitle("/path/my.notes.2024.md", UNTITLED)).toBe("my.notes.2024");
  });

  it("returns full filename when there is no extension", () => {
    expect(formatDocumentTitle("/path/to/README", UNTITLED)).toBe("README");
  });

  it("handles bare filename without path", () => {
    expect(formatDocumentTitle("notes.txt", UNTITLED)).toBe("notes");
  });

  it("handles dotfile (extension-only name) correctly", () => {
    // .gitignore -> getFileName returns ".gitignore", removing extension = ".gitignore"
    // (no extension to strip since the dot is at position 0)
    expect(formatDocumentTitle("/path/.gitignore", UNTITLED)).toBe(".gitignore");
  });

  it("drops a trailing dot, matching pathUtils rather than a private regex", () => {
    // The local regex used to keep it. Two spellings of "strip the extension"
    // in one codebase is one too many; this pins which one survived.
    expect(formatDocumentTitle("/path/notes.", UNTITLED)).toBe("notes");
  });
});
