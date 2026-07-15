/**
 * Direct tests for the Tab discriminated-union guards and accessors.
 *
 * These are consumed by file ownership, workspace persistence, link resolution,
 * and the content server. Consumer tests routinely mock them, so a regression
 * here would be masked everywhere — assert them head-on, including the inverse
 * cases (a guard that wrongly returns false would silently skip assertions
 * nested inside it).
 */
import { describe, it, expect } from "vitest";
import { isBrowserTab, isDocumentTab, tabFilePath, type BrowserTab, type DocumentTab } from "./tabStoreTypes";

const saved: DocumentTab = {
  kind: "document",
  id: "d1",
  filePath: "/Users/test/file.md",
  title: "file",
  isPinned: false,
  formatId: "markdown",
};

const untitled: DocumentTab = { ...saved, id: "d2", filePath: null, title: "Untitled-1" };

const browser: BrowserTab = {
  kind: "browser",
  id: "b1",
  url: "https://example.com/",
  title: "Example",
  isPinned: false,
};

describe("isDocumentTab", () => {
  it("is true for a saved document tab", () => {
    expect(isDocumentTab(saved)).toBe(true);
  });

  it("is true for an untitled document tab", () => {
    expect(isDocumentTab(untitled)).toBe(true);
  });

  it("is false for a browser tab", () => {
    expect(isDocumentTab(browser)).toBe(false);
  });
});

describe("isBrowserTab", () => {
  it("is true for a browser tab", () => {
    expect(isBrowserTab(browser)).toBe(true);
  });

  it("is false for a saved document tab", () => {
    expect(isBrowserTab(saved)).toBe(false);
  });

  it("is false for an untitled document tab", () => {
    expect(isBrowserTab(untitled)).toBe(false);
  });
});

describe("tabFilePath", () => {
  it("returns the path of a saved document tab", () => {
    expect(tabFilePath(saved)).toBe("/Users/test/file.md");
  });

  it("returns null for an untitled document tab", () => {
    expect(tabFilePath(untitled)).toBeNull();
  });

  it("returns null for a browser tab (a URL is not a path)", () => {
    expect(tabFilePath(browser)).toBeNull();
  });
});
