// WI-4.4 — bounded LRU cache (R1)
import { describe, it, expect } from "vitest";
import { LruCache } from "./lruCache";

describe("LruCache", () => {
  it("evicts the least-recently-used entry at the cap", () => {
    const c = new LruCache<string, number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.set("d", 4); // exceeds cap → evicts "a" (oldest)
    expect(c.size).toBe(3);
    expect(c.has("a")).toBe(false);
    expect([...c.keys()]).toEqual(["b", "c", "d"]);
  });

  it("get() marks an entry most-recently-used so it survives eviction", () => {
    const c = new LruCache<string, number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBe(1); // "a" is now MRU
    c.set("d", 4); // evicts the LRU, which is now "b"
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
  });

  it("re-setting an existing key updates value and recency without growing", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 11); // update + MRU
    c.set("c", 3); // evicts "b"
    expect(c.size).toBe(2);
    expect(c.get("a")).toBe(11);
    expect(c.has("b")).toBe(false);
  });

  it("never exceeds the cap across many inserts", () => {
    const c = new LruCache<number, number>(100);
    for (let i = 0; i < 1000; i++) c.set(i, i);
    expect(c.size).toBe(100);
    expect(c.has(999)).toBe(true);
    expect(c.has(0)).toBe(false);
  });

  it("rejects a maxSize below 1", () => {
    expect(() => new LruCache<string, number>(0)).toThrow();
  });
});
