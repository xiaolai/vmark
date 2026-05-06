/**
 * Tests for drop paths filtering utility.
 *
 * Phase 1B (WI-1B.3) replaced the legacy MARKDOWN_EXTENSIONS constant
 * with a registry-sourced SUPPORTED_EXTENSIONS getter. Markdown-only
 * checks live under MARKDOWN_ONLY_EXTENSIONS; broad "any registered"
 * checks live under SUPPORTED_EXTENSIONS / isSupportedFileName.
 *
 * @module utils/dropPaths.test
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MARKDOWN_ONLY_EXTENSIONS,
  YAML_EXTENSIONS,
  filterMarkdownPaths,
  filterSupportedPaths,
  getSupportedExtensionsWithDots,
  isMarkdownFileName,
  isSupportedFileName,
  isVMarkFileName,
  isYamlFileName,
  stripSupportedExtension,
} from "./dropPaths";
import { __resetRegistry } from "@/lib/formats/registry";
import { bootstrapFormats, __resetBootstrap } from "@/lib/formats";

// Bootstrap the registry once per test file so getSupportedExtensions()
// returns the real list (markdown + txt + every Phase 2-4 stub).
beforeEach(() => {
  __resetRegistry();
  __resetBootstrap();
  bootstrapFormats();
});
afterEach(() => {
  __resetRegistry();
  __resetBootstrap();
});

describe("MARKDOWN_ONLY_EXTENSIONS", () => {
  it("contains the five canonical markdown extensions", () => {
    expect(MARKDOWN_ONLY_EXTENSIONS).toEqual([
      ".md",
      ".markdown",
      ".mdown",
      ".mkd",
      ".mdx",
    ]);
  });

  it("does not include .txt (txt is its own format from Phase 1A)", () => {
    expect(MARKDOWN_ONLY_EXTENSIONS).not.toContain(".txt");
  });
});

describe("getSupportedExtensionsWithDots", () => {
  it("returns dot-prefixed extensions sourced from the registry", () => {
    const exts = getSupportedExtensionsWithDots();
    expect(exts).toContain(".md");
    expect(exts).toContain(".txt");
    expect(exts).toContain(".json");
    expect(exts).toContain(".yaml");
    expect(exts).toContain(".toml");
    expect(exts).toContain(".html");
    expect(exts).toContain(".ts");
  });

  it("does not return duplicates", () => {
    const exts = getSupportedExtensionsWithDots();
    expect(new Set(exts).size).toBe(exts.length);
  });

  it("falls back to a markdown-friendly set when the registry is empty", () => {
    __resetRegistry();
    __resetBootstrap();
    const exts = getSupportedExtensionsWithDots();
    expect(exts).toContain(".md");
    expect(exts).toContain(".markdown");
    // Defensive fallback so anything calling before bootstrap still
    // accepts markdown-family files.
  });
});

describe("isSupportedFileName", () => {
  it("returns true for any registered extension", () => {
    expect(isSupportedFileName("readme.md")).toBe(true);
    expect(isSupportedFileName("notes.txt")).toBe(true);
    expect(isSupportedFileName("data.json")).toBe(true);
    expect(isSupportedFileName("config.yaml")).toBe(true);
    expect(isSupportedFileName("Cargo.toml")).toBe(true);
    expect(isSupportedFileName("page.html")).toBe(true);
    expect(isSupportedFileName("script.ts")).toBe(true);
    expect(isSupportedFileName("module.py")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isSupportedFileName("README.MD")).toBe(true);
    expect(isSupportedFileName("DATA.JSON")).toBe(true);
  });

  it("returns false for unregistered extensions", () => {
    expect(isSupportedFileName("image.png")).toBe(false);
    expect(isSupportedFileName("video.mp4")).toBe(false);
    expect(isSupportedFileName("archive.zip")).toBe(false);
  });

  it("returns false for paths with no extension", () => {
    expect(isSupportedFileName("Makefile")).toBe(false);
  });
});

describe("filterSupportedPaths", () => {
  it("returns empty for null / undefined / empty input", () => {
    expect(filterSupportedPaths(null)).toEqual([]);
    expect(filterSupportedPaths(undefined)).toEqual([]);
    expect(filterSupportedPaths([])).toEqual([]);
  });

  it("keeps every registered-extension path", () => {
    const paths = [
      "/x/note.md",
      "/x/data.json",
      "/x/config.yaml",
      "/x/Cargo.toml",
      "/x/page.html",
      "/x/image.png",
    ];
    expect(filterSupportedPaths(paths)).toEqual([
      "/x/note.md",
      "/x/data.json",
      "/x/config.yaml",
      "/x/Cargo.toml",
      "/x/page.html",
    ]);
  });

  it("is case-insensitive", () => {
    const paths = ["/x/README.MD", "/x/CONFIG.YAML"];
    expect(filterSupportedPaths(paths)).toEqual(paths);
  });

  it("handles Windows-style paths", () => {
    const paths = ["C:\\Users\\docs\\readme.md", "C:\\Users\\docs\\data.json"];
    expect(filterSupportedPaths(paths)).toEqual(paths);
  });
});

describe("isMarkdownFileName (strict — no .txt)", () => {
  it("matches markdown-only extensions case-insensitively", () => {
    expect(isMarkdownFileName("readme.md")).toBe(true);
    expect(isMarkdownFileName("notes.MARKDOWN")).toBe(true);
    expect(isMarkdownFileName("draft.mdown")).toBe(true);
    expect(isMarkdownFileName("draft.MKD")).toBe(true);
    expect(isMarkdownFileName("doc.mdx")).toBe(true);
  });

  it("rejects .txt — txt is its own format from Phase 1A", () => {
    expect(isMarkdownFileName("notes.txt")).toBe(false);
  });

  it("rejects unrelated extensions", () => {
    expect(isMarkdownFileName("image.png")).toBe(false);
    expect(isMarkdownFileName("data.json")).toBe(false);
  });
});

describe("filterMarkdownPaths (legacy, strict markdown only)", () => {
  it("keeps only strict markdown paths", () => {
    const paths = [
      "/x/note.md",
      "/x/notes.markdown",
      "/x/todo.txt",
      "/x/data.json",
    ];
    expect(filterMarkdownPaths(paths)).toEqual([
      "/x/note.md",
      "/x/notes.markdown",
    ]);
  });
});

describe("stripSupportedExtension", () => {
  it("strips markdown extensions", () => {
    expect(stripSupportedExtension("readme.md")).toBe("readme");
    expect(stripSupportedExtension("notes.MARKDOWN")).toBe("notes");
  });

  it("strips .txt", () => {
    expect(stripSupportedExtension("todo.txt")).toBe("todo");
  });

  it("strips other registered extensions", () => {
    expect(stripSupportedExtension("data.json")).toBe("data");
    expect(stripSupportedExtension("config.yaml")).toBe("config");
    expect(stripSupportedExtension("Cargo.toml")).toBe("Cargo");
  });

  it("leaves unrelated extensions intact", () => {
    expect(stripSupportedExtension("image.png")).toBe("image.png");
    expect(stripSupportedExtension("archive.md.bak")).toBe("archive.md.bak");
  });
});

describe("YAML_EXTENSIONS", () => {
  it("includes .yml and .yaml", () => {
    expect(YAML_EXTENSIONS).toContain(".yml");
    expect(YAML_EXTENSIONS).toContain(".yaml");
  });
});

describe("isYamlFileName", () => {
  it("recognizes .yml / .yaml case-insensitively", () => {
    expect(isYamlFileName("workflow.yml")).toBe(true);
    expect(isYamlFileName("CONFIG.YAML")).toBe(true);
  });

  it("rejects non-YAML files", () => {
    expect(isYamlFileName("readme.md")).toBe(false);
    expect(isYamlFileName("data.json")).toBe(false);
  });
});

describe("isVMarkFileName (markdown OR YAML)", () => {
  it("recognizes markdown files", () => {
    expect(isVMarkFileName("readme.md")).toBe(true);
  });

  it("recognizes YAML files", () => {
    expect(isVMarkFileName("workflow.yml")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isVMarkFileName("data.json")).toBe(false);
    expect(isVMarkFileName("image.png")).toBe(false);
  });
});
