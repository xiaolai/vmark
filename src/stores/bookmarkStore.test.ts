// WI-S3.1 — bookmarkStore: persisted, path-preserving, multi-window safe.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBookmarkStore, BOOKMARKS_SCHEMA_VERSION } from "./bookmarkStore";

beforeEach(() => {
  useBookmarkStore.setState({ bookmarks: [] });
  localStorage.clear();
  vi.clearAllMocks();
});

const s = () => useBookmarkStore.getState();

describe("add", () => {
  it("stores a bookmark under its canonical url", () => {
    s().add("HTTPS://Example.COM:443/Page", "A page");
    const [b] = s().bookmarks;
    expect(b.url).toBe("https://example.com/Page");
    expect(b.title).toBe("A page");
    expect(b.addedAt).toBeTypeOf("number");
  });

  it("does NOT collapse two pages on the same site", () => {
    // The bug the v2 plan shipped: origin-only dedup made a whole site one bookmark.
    s().add("https://example.com/a", "A");
    s().add("https://example.com/b", "B");
    expect(s().bookmarks).toHaveLength(2);
  });

  it("dedups the SAME page spelled differently", () => {
    s().add("https://example.com/a", "A");
    s().add("HTTPS://EXAMPLE.COM:443/a", "A again");
    expect(s().bookmarks).toHaveLength(1);
  });

  it("treats two sections of a page as two bookmarks", () => {
    s().add("https://example.com/doc#install", "Install");
    s().add("https://example.com/doc#usage", "Usage");
    expect(s().bookmarks).toHaveLength(2);
  });

  it("refuses a url that cannot be a bookmark", () => {
    expect(s().add("javascript:alert(1)", "evil")).toBe(false);
    expect(s().add("about:blank", "blank")).toBe(false);
    expect(s().bookmarks).toHaveLength(0);
  });

  it("re-adding an existing bookmark updates its title rather than duplicating", () => {
    s().add("https://example.com/a", "Old");
    s().add("https://example.com/a", "New");
    expect(s().bookmarks).toHaveLength(1);
    expect(s().bookmarks[0].title).toBe("New");
  });
});

describe("remove / has", () => {
  it("removes by url, spelled any way", () => {
    s().add("https://example.com/a", "A");
    expect(s().has("https://example.com/a")).toBe(true);
    s().remove("HTTPS://EXAMPLE.COM/a");
    expect(s().bookmarks).toHaveLength(0);
    expect(s().has("https://example.com/a")).toBe(false);
  });

  it("has() is false for an unbookmarkable url rather than throwing", () => {
    expect(s().has("not a url")).toBe(false);
  });
});

describe("persistence", () => {
  it("carries a schema version, so a future shape can be migrated rather than guessed at", () => {
    expect(BOOKMARKS_SCHEMA_VERSION).toBeTypeOf("number");
  });

  // Two windows share one localStorage but not one store instance. A blind write would
  // clobber whatever the other window added while this one was open.
  it("merges with what another window wrote, instead of overwriting it", () => {
    s().add("https://mine.com/", "Mine");

    // Another window adds a bookmark and persists it behind our back.
    const raw = JSON.parse(localStorage.getItem("vmark-bookmarks") ?? "{}");
    raw.state.bookmarks.push({
      id: "other",
      url: "https://theirs.com/",
      title: "Theirs",
      addedAt: Date.now(),
    });
    localStorage.setItem("vmark-bookmarks", JSON.stringify(raw));

    // Our next write must not erase theirs.
    s().add("https://also-mine.com/", "Also mine");
    const persisted = JSON.parse(localStorage.getItem("vmark-bookmarks") ?? "{}");
    const urls = persisted.state.bookmarks.map((b: { url: string }) => b.url);
    expect(urls).toContain("https://theirs.com/");
    expect(urls).toContain("https://mine.com/");
    expect(urls).toContain("https://also-mine.com/");
  });
});
