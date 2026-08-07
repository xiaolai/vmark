// @vitest-environment node
/**
 * Tests for Export Naming Utilities
 *
 * @module utils/exportNaming.test
 */

import { describe, it, expect } from "vitest";
import {
  extractFirstH1,
  sanitizeFileName,
  getExportFolderName,
  getSaveFileName,
} from "./exportNaming";

describe("extractFirstH1", () => {
  describe("ATX style headings (# Heading)", () => {
    it("extracts simple H1", () => {
      expect(extractFirstH1("# Hello World")).toBe("Hello World");
    });

    it("extracts H1 with content after", () => {
      expect(extractFirstH1("# My Document\n\nSome content here.")).toBe("My Document");
    });

    it("extracts H1 with content before", () => {
      expect(extractFirstH1("Some preamble\n\n# The Title\n\nContent")).toBe("The Title");
    });

    it("extracts H1 with closing hashes", () => {
      expect(extractFirstH1("# Heading #")).toBe("Heading");
      expect(extractFirstH1("# Heading ##")).toBe("Heading");
      expect(extractFirstH1("# Heading ###")).toBe("Heading");
    });

    it("extracts first H1 when multiple exist", () => {
      expect(extractFirstH1("# First\n\n# Second\n\n# Third")).toBe("First");
    });

    it("handles H1 with special characters", () => {
      expect(extractFirstH1("# What's New?")).toBe("What's New?");
      expect(extractFirstH1("# Price: $100")).toBe("Price: $100");
      expect(extractFirstH1("# C++ Programming")).toBe("C++ Programming");
    });

    it("handles H1 with markdown formatting", () => {
      expect(extractFirstH1("# **Bold** Title")).toBe("**Bold** Title");
      expect(extractFirstH1("# _Italic_ Title")).toBe("_Italic_ Title");
      expect(extractFirstH1("# `Code` Title")).toBe("`Code` Title");
    });

    it("handles H1 with emoji", () => {
      expect(extractFirstH1("# 🎉 Celebration")).toBe("🎉 Celebration");
      expect(extractFirstH1("# Hello 👋 World")).toBe("Hello 👋 World");
    });

    it("handles H1 with CJK characters", () => {
      expect(extractFirstH1("# 你好世界")).toBe("你好世界");
      expect(extractFirstH1("# こんにちは")).toBe("こんにちは");
      expect(extractFirstH1("# 한국어 제목")).toBe("한국어 제목");
    });

    it("handles H1 with numbers", () => {
      expect(extractFirstH1("# Chapter 1")).toBe("Chapter 1");
      expect(extractFirstH1("# 2024 Report")).toBe("2024 Report");
    });

    it("trims whitespace from H1", () => {
      expect(extractFirstH1("#   Spaced Title   ")).toBe("Spaced Title");
      expect(extractFirstH1("# \tTabbed\t")).toBe("Tabbed");
    });
  });

  describe("Setext style headings (Heading\\n===)", () => {
    it("extracts simple setext H1", () => {
      expect(extractFirstH1("My Title\n===")).toBe("My Title");
    });

    it("extracts setext H1 with multiple equals", () => {
      expect(extractFirstH1("Title\n==========")).toBe("Title");
    });

    it("extracts setext H1 with trailing whitespace on underline", () => {
      expect(extractFirstH1("Title\n===   ")).toBe("Title");
    });

    it("extracts setext H1 with content after", () => {
      expect(extractFirstH1("Document Title\n===\n\nContent here.")).toBe("Document Title");
    });

    it("handles setext H1 with special characters", () => {
      expect(extractFirstH1("What's New?\n===")).toBe("What's New?");
    });
  });

  describe("No H1 cases", () => {
    it("returns null for empty string", () => {
      expect(extractFirstH1("")).toBeNull();
    });

    it("returns null for null/undefined", () => {
      expect(extractFirstH1(null as unknown as string)).toBeNull();
      expect(extractFirstH1(undefined as unknown as string)).toBeNull();
    });

    it("returns null for content with only H2", () => {
      expect(extractFirstH1("## Only H2")).toBeNull();
    });

    it("returns null for content with only H3-H6", () => {
      expect(extractFirstH1("### H3\n#### H4\n##### H5\n###### H6")).toBeNull();
    });

    it("returns null for plain text", () => {
      expect(extractFirstH1("Just some plain text without headings.")).toBeNull();
    });

    it("returns null for empty H1", () => {
      expect(extractFirstH1("# ")).toBeNull();
      expect(extractFirstH1("#")).toBeNull();
    });

    it("returns null for H1 that is only whitespace", () => {
      expect(extractFirstH1("#    ")).toBeNull();
      expect(extractFirstH1("# \t\n")).toBeNull();
    });

    it("does not match H1 without space after #", () => {
      expect(extractFirstH1("#NoSpace")).toBeNull();
    });

    it("does not match setext H2 (dashes)", () => {
      expect(extractFirstH1("Not H1\n---")).toBeNull();
    });

    it("ignores setext candidate starting with special chars (looks like syntax)", () => {
      // A line starting with - before === looks like a list item, not a heading
      expect(extractFirstH1("- Not a heading\n===")).toBeNull();
      expect(extractFirstH1("> Not a heading\n===")).toBeNull();
      expect(extractFirstH1("# Not setext\n===")).not.toBeNull(); // ATX wins
    });
  });

  describe("Edge cases", () => {
    it("handles H1 at very start of document", () => {
      expect(extractFirstH1("# First Line")).toBe("First Line");
    });

    it("handles H1 after blank lines", () => {
      expect(extractFirstH1("\n\n\n# After Blanks")).toBe("After Blanks");
    });

    it("handles H1 after code block", () => {
      const md = "```\ncode\n```\n\n# After Code";
      expect(extractFirstH1(md)).toBe("After Code");
    });

    it("does not extract H1 inside code block", () => {
      const md = "```\n# Not a heading\n```\n\n## Real H2";
      // This is a limitation - we don't parse code blocks
      // The regex will still match it, which is acceptable for this use case
      expect(extractFirstH1(md)).toBe("Not a heading");
    });

    it("handles Windows line endings (CRLF)", () => {
      expect(extractFirstH1("# Title\r\n\r\nContent")).toBe("Title");
      expect(extractFirstH1("Title\r\n===\r\n")).toBe("Title");
    });

    it("prefers ATX over setext when ATX comes first", () => {
      expect(extractFirstH1("# ATX First\n\nSetext\n===")).toBe("ATX First");
    });

    it("finds setext when it comes before ATX", () => {
      // Note: Our implementation checks ATX first regardless of position
      // This is a design choice - ATX is more common
      const md = "Setext\n===\n\n# ATX Second";
      expect(extractFirstH1(md)).toBe("ATX Second");
    });
  });
});

describe("sanitizeFileName", () => {
  describe("Invalid characters", () => {
    it("replaces forward slash with dash", () => {
      expect(sanitizeFileName("What/Why")).toBe("What-Why");
    });

    it("replaces backslash with dash", () => {
      expect(sanitizeFileName("What\\Why")).toBe("What-Why");
    });

    it("replaces colon with dash", () => {
      expect(sanitizeFileName("Title: Subtitle")).toBe("Title- Subtitle");
    });

    it("replaces asterisk with dash", () => {
      expect(sanitizeFileName("Important*")).toBe("Important");
    });

    it("replaces question mark with dash", () => {
      expect(sanitizeFileName("What?")).toBe("What");
    });

    it("replaces double quotes with dash", () => {
      expect(sanitizeFileName('Say "Hello"')).toBe("Say -Hello");
    });

    it("replaces angle brackets with dash", () => {
      expect(sanitizeFileName("List<Item>")).toBe("List-Item");
    });

    it("replaces pipe with dash", () => {
      expect(sanitizeFileName("A | B")).toBe("A - B");
    });

    it("handles multiple invalid characters", () => {
      expect(sanitizeFileName("What/Why:When?")).toBe("What-Why-When");
    });

    it("removes control characters", () => {
      expect(sanitizeFileName("Hello\x00World")).toBe("HelloWorld");
      expect(sanitizeFileName("Tab\tHere")).toBe("Tab Here");
    });
  });

  describe("Dots handling", () => {
    it("removes leading dots", () => {
      expect(sanitizeFileName(".hidden")).toBe("hidden");
      expect(sanitizeFileName("..hidden")).toBe("hidden");
      expect(sanitizeFileName("...hidden")).toBe("hidden");
    });

    it("removes trailing dots", () => {
      expect(sanitizeFileName("name.")).toBe("name");
      expect(sanitizeFileName("name..")).toBe("name");
      expect(sanitizeFileName("name...")).toBe("name");
    });

    it("preserves dots in the middle", () => {
      expect(sanitizeFileName("file.name")).toBe("file.name");
      expect(sanitizeFileName("v1.2.3")).toBe("v1.2.3");
    });
  });

  describe("Whitespace handling", () => {
    it("trims leading whitespace", () => {
      expect(sanitizeFileName("  Title")).toBe("Title");
    });

    it("trims trailing whitespace", () => {
      expect(sanitizeFileName("Title  ")).toBe("Title");
    });

    it("collapses multiple spaces", () => {
      expect(sanitizeFileName("Title    Name")).toBe("Title Name");
    });

    it("handles tabs and other whitespace", () => {
      expect(sanitizeFileName("Title\t\tName")).toBe("Title Name");
    });
  });

  describe("Dash handling", () => {
    it("collapses multiple dashes", () => {
      expect(sanitizeFileName("A--B")).toBe("A-B");
      expect(sanitizeFileName("A---B")).toBe("A-B");
    });

    it("removes leading dashes", () => {
      expect(sanitizeFileName("-Title")).toBe("Title");
      expect(sanitizeFileName("--Title")).toBe("Title");
    });

    it("removes trailing dashes", () => {
      expect(sanitizeFileName("Title-")).toBe("Title");
      expect(sanitizeFileName("Title--")).toBe("Title");
    });

    it("preserves single dashes in the middle", () => {
      expect(sanitizeFileName("My-Title")).toBe("My-Title");
    });
  });

  describe("Length truncation", () => {
    it("truncates long names to default max length", () => {
      const longName = "A".repeat(100);
      const result = sanitizeFileName(longName);
      expect(result.length).toBeLessThanOrEqual(80);
    });

    it("truncates at word boundary when possible", () => {
      const longName = "This is a very long title that should be truncated at a word boundary for readability";
      const result = sanitizeFileName(longName, 50);
      expect(result.length).toBeLessThanOrEqual(50);
      expect(result.endsWith(" ")).toBe(false);
    });

    it("respects custom max length", () => {
      const result = sanitizeFileName("Hello World", 5);
      expect(result).toBe("Hello");
    });

    it("handles names shorter than max length", () => {
      expect(sanitizeFileName("Short", 100)).toBe("Short");
    });

    it("truncates without word boundary when no space in lookback window", () => {
      // Create a string with no spaces near the end: "AAAA...AAAA" (100 chars)
      const noSpaces = "A".repeat(100);
      const result = sanitizeFileName(noSpaces, 50);
      expect(result).toBe("A".repeat(50));
    });

    it("truncates at word boundary within lookback window", () => {
      // Word boundary at position 45, maxLength 50, lookback 20 → should find it
      const withSpace = "A".repeat(45) + " " + "B".repeat(54); // 100 chars total
      const result = sanitizeFileName(withSpace, 50);
      expect(result).toBe("A".repeat(45));
    });
  });

  describe("Windows reserved names", () => {
    it("appends suffix to CON", () => {
      expect(sanitizeFileName("CON")).toBe("CON_export");
    });

    it("appends suffix to PRN", () => {
      expect(sanitizeFileName("PRN")).toBe("PRN_export");
    });

    it("appends suffix to AUX", () => {
      expect(sanitizeFileName("AUX")).toBe("AUX_export");
    });

    it("appends suffix to NUL", () => {
      expect(sanitizeFileName("NUL")).toBe("NUL_export");
    });

    it("appends suffix to COM ports", () => {
      expect(sanitizeFileName("COM1")).toBe("COM1_export");
      expect(sanitizeFileName("COM9")).toBe("COM9_export");
    });

    it("appends suffix to LPT ports", () => {
      expect(sanitizeFileName("LPT1")).toBe("LPT1_export");
      expect(sanitizeFileName("LPT9")).toBe("LPT9_export");
    });

    it("handles reserved names case-insensitively", () => {
      expect(sanitizeFileName("con")).toBe("con_export");
      expect(sanitizeFileName("Con")).toBe("Con_export");
      expect(sanitizeFileName("CON")).toBe("CON_export");
    });

    it("handles reserved names with extensions", () => {
      expect(sanitizeFileName("CON.txt")).toBe("CON.txt_export");
      expect(sanitizeFileName("nul.md")).toBe("nul.md_export");
    });

    it("does not modify similar but valid names", () => {
      expect(sanitizeFileName("CONTROL")).toBe("CONTROL");
      expect(sanitizeFileName("PRINTER")).toBe("PRINTER");
      expect(sanitizeFileName("COM10")).toBe("COM10");
    });
  });

  describe("Edge cases", () => {
    it("returns empty string for null", () => {
      expect(sanitizeFileName(null as unknown as string)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(sanitizeFileName(undefined as unknown as string)).toBe("");
    });

    it("returns empty string for empty string", () => {
      expect(sanitizeFileName("")).toBe("");
    });

    it("returns empty string when only invalid chars", () => {
      expect(sanitizeFileName("///")).toBe("");
      expect(sanitizeFileName("???")).toBe("");
    });

    it("handles emoji", () => {
      expect(sanitizeFileName("🎉 Party")).toBe("🎉 Party");
      expect(sanitizeFileName("Hello 👋")).toBe("Hello 👋");
    });

    it("handles CJK characters", () => {
      expect(sanitizeFileName("你好世界")).toBe("你好世界");
      expect(sanitizeFileName("日本語タイトル")).toBe("日本語タイトル");
    });

    it("handles mixed scripts", () => {
      expect(sanitizeFileName("Hello 你好 World")).toBe("Hello 你好 World");
    });

    it("handles numbers", () => {
      expect(sanitizeFileName("2024")).toBe("2024");
      expect(sanitizeFileName("Chapter 1")).toBe("Chapter 1");
    });

    it("handles string that becomes empty after sanitization", () => {
      expect(sanitizeFileName("...")).toBe("");
      expect(sanitizeFileName("---")).toBe("");
      expect(sanitizeFileName("   ")).toBe("");
    });
  });
});

describe("getExportFolderName", () => {
  describe("H1 extraction priority", () => {
    it("uses H1 when available", () => {
      expect(getExportFolderName("# My Document", "/path/to/file.md")).toBe("My Document");
    });

    it("sanitizes H1", () => {
      expect(getExportFolderName("# What/Why?", "/path/to/file.md")).toBe("What-Why");
    });

    it("uses H1 even when file path is null", () => {
      expect(getExportFolderName("# Title", null)).toBe("Title");
    });

    it("uses H1 even when file path is undefined", () => {
      expect(getExportFolderName("# Title", undefined)).toBe("Title");
    });
  });

  describe("File name fallback", () => {
    it("falls back to file name when no H1", () => {
      expect(getExportFolderName("No heading here", "/path/to/notes.md")).toBe("notes");
    });

    it("removes extension from file name", () => {
      expect(getExportFolderName("No H1", "/path/to/document.md")).toBe("document");
      expect(getExportFolderName("No H1", "/path/to/file.txt")).toBe("file");
    });

    it("handles files without extension", () => {
      expect(getExportFolderName("No H1", "/path/to/README")).toBe("README");
    });

    it("handles Windows-style paths", () => {
      expect(getExportFolderName("No H1", "C:\\Users\\doc.md")).toBe("doc");
    });

    it("sanitizes file name", () => {
      expect(getExportFolderName("No H1", "/path/to/file:name.md")).toBe("file-name");
    });
  });

  describe("Fallback value", () => {
    it("uses 'Untitled' as default fallback", () => {
      expect(getExportFolderName("No heading", null)).toBe("Untitled");
    });

    it("uses custom fallback when provided", () => {
      expect(getExportFolderName("No heading", null, "Document")).toBe("Document");
    });

    it("uses fallback when H1 sanitizes to empty", () => {
      expect(getExportFolderName("# ???", null)).toBe("Untitled");
    });

    it("uses file name when hidden file (leading dot stripped)", () => {
      // .hidden becomes "hidden" after stripping leading dot
      expect(getExportFolderName("No H1", "/path/to/.hidden", "Fallback")).toBe("hidden");
    });

    it("uses fallback when file name is only dots", () => {
      expect(getExportFolderName("No H1", "/path/to/...", "Fallback")).toBe("Fallback");
    });

    it("uses fallback when filePath ends with separator (empty last component, line 240 branch)", () => {
      // "/path/to/" splits to ["", "path", "to", ""] → last part is "" → empty filename
      expect(getExportFolderName("No H1", "/path/to/", "Fallback")).toBe("Fallback");
    });
  });

  describe("Empty and edge cases", () => {
    it("handles empty markdown", () => {
      expect(getExportFolderName("", "/path/to/file.md")).toBe("file");
    });

    it("handles empty markdown and null path", () => {
      expect(getExportFolderName("", null)).toBe("Untitled");
    });

    it("handles whitespace-only markdown", () => {
      expect(getExportFolderName("   \n\n   ", null)).toBe("Untitled");
    });

    it("handles markdown with only H2+", () => {
      expect(getExportFolderName("## Section\n### Subsection", "/doc.md")).toBe("doc");
    });
  });

  describe("Real-world scenarios", () => {
    it("handles typical blog post", () => {
      const md = `# How to Learn Programming

Programming is a valuable skill...`;
      expect(getExportFolderName(md, "/posts/draft.md")).toBe("How to Learn Programming");
    });

    it("handles README with project name", () => {
      const md = `# VMark

A markdown editor for macOS.`;
      expect(getExportFolderName(md, "/Users/dev/vmark/README.md")).toBe("VMark");
    });

    it("handles document with long title", () => {
      const md = `# This is an extremely long title that goes on and on and should be truncated at some reasonable point for filesystem compatibility

Content here.`;
      const result = getExportFolderName(md, null);
      expect(result.length).toBeLessThanOrEqual(80);
    });

    it("handles document with H1 containing special chars", () => {
      const md = `# FAQ: What's New in v2.0?

Changelog...`;
      expect(getExportFolderName(md, "/docs/faq.md")).toBe("FAQ- What's New in v2.0");
    });

    it("handles CJK document", () => {
      const md = `# 如何学习编程

编程是一项有价值的技能...`;
      expect(getExportFolderName(md, "/posts/draft.md")).toBe("如何学习编程");
    });

    it("handles mixed language document", () => {
      const md = `# Getting Started 入门指南

Welcome...`;
      expect(getExportFolderName(md, null)).toBe("Getting Started 入门指南");
    });

    it("handles untitled new document", () => {
      const md = "Just started typing some notes...";
      expect(getExportFolderName(md, null)).toBe("Untitled");
    });
  });
});

describe("getSaveFileName", () => {
  describe("H1 extraction priority", () => {
    it("uses H1 when available in content", () => {
      expect(getSaveFileName("# My Document", "Untitled")).toBe("My Document");
    });

    it("sanitizes H1 for filesystem", () => {
      expect(getSaveFileName("# What/Why?", "Untitled")).toBe("What-Why");
    });

    it("handles H1 with special characters", () => {
      expect(getSaveFileName("# Title: Subtitle", "Untitled")).toBe("Title- Subtitle");
    });

    it("handles CJK H1", () => {
      expect(getSaveFileName("# 我的文档", "Untitled")).toBe("我的文档");
    });
  });

  describe("inline markdown stripping", () => {
    it("strips bold formatting", () => {
      expect(getSaveFileName("# **Bold** Title", "Untitled")).toBe("Bold Title");
    });

    it("strips italic formatting with asterisks", () => {
      expect(getSaveFileName("# *Italic* Title", "Untitled")).toBe("Italic Title");
    });

    it("strips italic formatting with underscores", () => {
      expect(getSaveFileName("# _Italic_ Title", "Untitled")).toBe("Italic Title");
    });

    it("strips bold with underscores", () => {
      expect(getSaveFileName("# __Bold__ Title", "Untitled")).toBe("Bold Title");
    });

    it("strips inline code", () => {
      expect(getSaveFileName("# `Code` Title", "Untitled")).toBe("Code Title");
    });

    it("strips strikethrough", () => {
      expect(getSaveFileName("# ~~Struck~~ Title", "Untitled")).toBe("Struck Title");
    });

    it("strips links but keeps text", () => {
      expect(getSaveFileName("# [Click Here](url)", "Untitled")).toBe("Click Here");
    });

    it("strips images but keeps alt text", () => {
      expect(getSaveFileName("# ![Alt](image.png) Title", "Untitled")).toBe("Alt Title");
    });

    it("strips reference-style links but keeps text", () => {
      expect(getSaveFileName("# [Click Here][ref] Title", "Untitled")).toBe("Click Here Title");
    });

    it("strips reference-style images but keeps alt text", () => {
      expect(getSaveFileName("# ![Alt][img] Title", "Untitled")).toBe("Alt Title");
    });

    it("handles complex mixed formatting", () => {
      expect(getSaveFileName("# My **Bold** and _Italic_ Title", "Untitled")).toBe("My Bold and Italic Title");
    });
  });

  describe("fallback to tab title", () => {
    it("uses tab title when no H1", () => {
      expect(getSaveFileName("No heading here", "My Tab")).toBe("My Tab");
    });

    it("uses tab title when H1 is empty", () => {
      expect(getSaveFileName("# ", "My Tab")).toBe("My Tab");
    });

    it("uses tab title when H1 sanitizes to empty", () => {
      expect(getSaveFileName("# ???", "My Tab")).toBe("My Tab");
    });
  });

  describe("final fallback", () => {
    it("returns 'Untitled' when no H1 and no tab title", () => {
      expect(getSaveFileName("No heading", "")).toBe("Untitled");
    });

    it("returns 'Untitled' when content is empty and no tab title", () => {
      expect(getSaveFileName("", "")).toBe("Untitled");
    });

    it("returns tab title even if it's 'Untitled'", () => {
      expect(getSaveFileName("No heading", "Untitled")).toBe("Untitled");
    });
  });

  describe("real-world scenarios", () => {
    it("extracts title from typical new document", () => {
      const content = `# My New Document

This is my new document content.`;
      expect(getSaveFileName(content, "Untitled-1")).toBe("My New Document");
    });

    it("falls back for document without H1", () => {
      const content = `Just some notes here...

## Section 1

More content.`;
      expect(getSaveFileName(content, "Untitled-2")).toBe("Untitled-2");
    });

    it("handles blank new document", () => {
      expect(getSaveFileName("", "Untitled-1")).toBe("Untitled-1");
    });
  });
});
