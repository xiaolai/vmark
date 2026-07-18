// SH-3 — read-merge-write helpers for multi-window persisted lists.
import { describe, it, expect, beforeEach } from "vitest";
import {
  createFieldChangeGatedStorage,
  readPersistedList,
  mergeNewestFirst,
  mergeMruList,
} from "./persistedListMerge";

describe("readPersistedList", () => {
  const KEY = "test-persist-key";

  beforeEach(() => {
    localStorage.clear();
  });

  it("returns [] when the key is missing", () => {
    expect(readPersistedList(KEY, "items")).toEqual([]);
  });

  it("returns [] for corrupt JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readPersistedList(KEY, "items")).toEqual([]);
  });

  it("returns [] when the envelope has no state object", () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 0 }));
    expect(readPersistedList(KEY, "items")).toEqual([]);
  });

  it("returns [] when the field is not an array", () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { items: "nope" }, version: 0 }));
    expect(readPersistedList(KEY, "items")).toEqual([]);
  });

  it("returns the array field from a zustand-persist envelope", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { items: ["a", "b"], other: 1 }, version: 0 }),
    );
    expect(readPersistedList<string>(KEY, "items")).toEqual(["a", "b"]);
  });
});

describe("mergeNewestFirst", () => {
  interface Entry {
    id: string;
    ts: number;
  }
  const keyOf = (e: Entry) => e.id;
  const timeOf = (e: Entry) => e.ts;
  const e = (id: string, ts: number): Entry => ({ id, ts });

  it("unions disjoint lists ordered newest-first", () => {
    const merged = mergeNewestFirst([e("a", 3)], [e("b", 2), e("c", 1)], keyOf, timeOf, 10);
    expect(merged.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("newest timestamp wins per key", () => {
    const merged = mergeNewestFirst([e("a", 1)], [e("a", 5)], keyOf, timeOf, 10);
    expect(merged).toEqual([e("a", 5)]);
  });

  it("mine wins a timestamp tie", () => {
    const mineEntry = e("a", 5);
    const merged = mergeNewestFirst([mineEntry], [e("a", 5)], keyOf, timeOf, 10);
    expect(merged[0]).toBe(mineEntry);
    expect(merged).toHaveLength(1);
  });

  it("caps the merged list, dropping the oldest entries", () => {
    const merged = mergeNewestFirst(
      [e("a", 4), e("b", 3)],
      [e("c", 2), e("d", 1)],
      keyOf,
      timeOf,
      3,
    );
    expect(merged.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("handles empty inputs", () => {
    expect(mergeNewestFirst<Entry>([], [], keyOf, timeOf, 5)).toEqual([]);
    expect(mergeNewestFirst([e("a", 1)], [], keyOf, timeOf, 5)).toEqual([e("a", 1)]);
    expect(mergeNewestFirst([], [e("a", 1)], keyOf, timeOf, 5)).toEqual([e("a", 1)]);
  });
});

describe("mergeMruList", () => {
  it("keeps mine's order and appends theirs' novel entries", () => {
    expect(mergeMruList(["z", "x"], ["y", "x"])).toEqual(["z", "x", "y"]);
  });

  it("dedupes entries present in both, keeping mine's position", () => {
    expect(mergeMruList(["a", "b"], ["b", "a"])).toEqual(["a", "b"]);
  });

  it("caps when a cap is given", () => {
    expect(mergeMruList(["a"], ["b", "c", "d"], 3)).toEqual(["a", "b", "c"]);
  });

  it("is uncapped by default", () => {
    const theirs = Array.from({ length: 50 }, (_, i) => `t${i}`);
    expect(mergeMruList(["mine"], theirs)).toHaveLength(51);
  });

  it("handles empty inputs", () => {
    expect(mergeMruList([], [])).toEqual([]);
    expect(mergeMruList(["a"], [])).toEqual(["a"]);
    expect(mergeMruList([], ["a"])).toEqual(["a"]);
  });
});

// zustand's persist middleware serializes on EVERY set(); a set() that
// doesn't touch the persisted lists (loading flags, definition reloads)
// must not push this window's stale snapshot over another window's write.
describe("createFieldChangeGatedStorage", () => {
  const KEY = "gate-key";
  const env = (state: Record<string, unknown>) =>
    JSON.stringify({ state, version: 0 });

  function makeBase() {
    const map = new Map<string, string>();
    return {
      map,
      storage: {
        getItem: (name: string) => map.get(name) ?? null,
        setItem: (name: string, value: string) => void map.set(name, value),
        removeItem: (name: string) => void map.delete(name),
      },
    };
  }

  it("skips a write when no guarded field changed since hydration", () => {
    const { map, storage } = makeBase();
    map.set(KEY, env({ recents: [], loading: false }));
    const gated = createFieldChangeGatedStorage(storage, ["recents"]);
    gated.getItem(KEY); // hydrate: recents []

    // Another window persists a recent behind this window's back.
    map.set(KEY, env({ recents: ["X"] }));
    // Unrelated set() in this window — recents still [] here.
    gated.setItem(KEY, env({ recents: [], loading: true }));

    expect(JSON.parse(map.get(KEY)!).state.recents).toEqual(["X"]);
  });

  it("skips the unchanged write even when the key was empty at hydration", () => {
    const { map, storage } = makeBase();
    const gated = createFieldChangeGatedStorage(storage, ["recents"]);
    gated.getItem(KEY); // hydrate: missing key → empty lists

    map.set(KEY, env({ recents: ["X"] }));
    gated.setItem(KEY, env({ recents: [] }));

    expect(JSON.parse(map.get(KEY)!).state.recents).toEqual(["X"]);
  });

  it("writes when a guarded field changed, then skips an identical follow-up", () => {
    const { map, storage } = makeBase();
    const gated = createFieldChangeGatedStorage(storage, ["recents"]);
    gated.getItem(KEY);

    gated.setItem(KEY, env({ recents: ["A"], loading: true }));
    expect(JSON.parse(map.get(KEY)!).state.recents).toEqual(["A"]);

    // Another window overwrites; a follow-up set() with unchanged lists
    // in THIS window must not clobber it.
    map.set(KEY, env({ recents: ["B", "A"] }));
    gated.setItem(KEY, env({ recents: ["A"], loading: false }));
    expect(JSON.parse(map.get(KEY)!).state.recents).toEqual(["B", "A"]);

    // A real change writes again.
    gated.setItem(KEY, env({ recents: ["C", "A"] }));
    expect(JSON.parse(map.get(KEY)!).state.recents).toEqual(["C", "A"]);
  });

  it("gates on every listed field independently", () => {
    const { map, storage } = makeBase();
    const gated = createFieldChangeGatedStorage(storage, ["recents", "favorites"]);
    gated.getItem(KEY);

    gated.setItem(KEY, env({ recents: [], favorites: ["F"] }));
    expect(JSON.parse(map.get(KEY)!).state.favorites).toEqual(["F"]);
  });

  it("writes before any hydration (no getItem yet)", () => {
    const { map, storage } = makeBase();
    const gated = createFieldChangeGatedStorage(storage, ["recents"]);
    gated.setItem(KEY, env({ recents: [] }));
    expect(map.has(KEY)).toBe(true);
  });

  it("treats corrupt disk JSON and non-array fields as empty lists", () => {
    const { map, storage } = makeBase();
    map.set(KEY, "{not json");
    const gated = createFieldChangeGatedStorage(storage, ["recents"]);
    gated.getItem(KEY);
    // Unchanged (still empty) → skipped; corrupt value left alone.
    gated.setItem(KEY, env({ recents: [], loading: true }));
    expect(map.get(KEY)).toBe("{not json");
    // A real mutation still writes.
    gated.setItem(KEY, env({ recents: ["A"] }));
    expect(JSON.parse(map.get(KEY)!).state.recents).toEqual(["A"]);
  });

  it("removeItem clears the key and resets the fingerprint", () => {
    const { map, storage } = makeBase();
    const gated = createFieldChangeGatedStorage(storage, ["recents"]);
    gated.getItem(KEY);
    gated.setItem(KEY, env({ recents: ["A"] }));
    gated.removeItem(KEY);
    expect(map.has(KEY)).toBe(false);
    // After removal the disk is empty; writing empty lists is a no-op…
    gated.setItem(KEY, env({ recents: [] }));
    expect(map.has(KEY)).toBe(false);
    // …but a real list write lands.
    gated.setItem(KEY, env({ recents: ["B"] }));
    expect(JSON.parse(map.get(KEY)!).state.recents).toEqual(["B"]);
  });
});
