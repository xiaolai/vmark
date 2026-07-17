import { describe, expect, it } from "vitest";

import { createContentHashCache, hashContent } from "./contentHashCache";

describe("hashContent", () => {
  it("is stable for identical content", () => {
    expect(hashContent("hello world")).toBe(hashContent("hello world"));
  });

  it("differs for different content", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });

  it("differs when only length differs", () => {
    expect(hashContent("ab")).not.toBe(hashContent("abc"));
  });

  it("handles empty content", () => {
    expect(hashContent("")).toBe(hashContent(""));
    expect(hashContent("")).not.toBe(hashContent(" "));
  });

  it("handles CJK / multi-byte content", () => {
    expect(hashContent("你好")).toBe(hashContent("你好"));
    expect(hashContent("你好")).not.toBe(hashContent("你們"));
  });
});

describe("createContentHashCache", () => {
  it("returns undefined for an unseen path", () => {
    expect(createContentHashCache().get("/ws/a")).toBeUndefined();
  });

  it("stores and retrieves a fingerprint", () => {
    const cache = createContentHashCache();
    cache.set("/ws/a", "h1");
    expect(cache.get("/ws/a")).toBe("h1");
    expect(cache.size()).toBe(1);
  });

  it("forgets a path", () => {
    const cache = createContentHashCache();
    cache.set("/ws/a", "h1");
    cache.forget("/ws/a");
    expect(cache.get("/ws/a")).toBeUndefined();
  });

  it("moves a fingerprint across a rename", () => {
    const cache = createContentHashCache();
    cache.set("/ws/old", "h1");
    cache.rename("/ws/old", "/ws/new");
    expect(cache.get("/ws/old")).toBeUndefined();
    expect(cache.get("/ws/new")).toBe("h1");
  });

  it("clears the new path when renaming from an untracked source", () => {
    const cache = createContentHashCache();
    cache.set("/ws/new", "stale");
    cache.rename("/ws/untracked", "/ws/new");
    expect(cache.get("/ws/new")).toBeUndefined();
  });

  it("clears every entry", () => {
    const cache = createContentHashCache();
    cache.set("/ws/a", "h1");
    cache.set("/ws/b", "h2");
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
