// @vitest-environment node
/**
 * The localStorage replay `session.load` runs in the page —
 * `src-tauri/src/browser/session_restore.src.js` — executed here against a storage
 * that throws. The Rust side (`session_restore_script.rs`) can only pin the script's
 * TEXT and parse its result; quota exhaustion, a storage-disabled origin and a
 * rollback that itself fails are behaviours, and this is where they run
 * (audit 20260903 round 3, #30).
 *
 * @coordinates-with src-tauri/src/browser/session_restore_script.rs — include_str!s the asset, parses the outcome
 * @module services/browser/sessionRestoreScript.test
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const BROWSER_DIR = new URL("../../../src-tauri/src/browser/", import.meta.url);
const SRC = readFileSync(new URL("session_restore.src.js", BROWSER_DIR), "utf8");
const RUST = readFileSync(new URL("session_restore_script.rs", BROWSER_DIR), "utf8");

interface Outcome {
  applied: boolean;
  reason?: string;
  index?: number;
  count?: number;
  rollbackFailed?: number[];
}

/** A `localStorage` stand-in whose failures are scripted per key. */
class ThrowingStorage {
  readonly items = new Map<string, string>();
  readonly rejectSet = new Set<string>();
  readonly rejectRemove = new Set<string>();
  /** A storage-disabled origin: every read and write throws. */
  disabled = false;

  getItem(key: string): string | null {
    if (this.disabled) throw new Error("SecurityError: storage is disabled");
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.disabled || this.rejectSet.has(key)) throw new Error("QuotaExceededError");
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    if (this.rejectRemove.has(key)) throw new Error("SecurityError");
    this.items.delete(key);
  }
}

const ORIGIN = "https://work.example";
type Pairs = Array<[string, string]>;

/** Run the asset exactly as Rust builds it: `return (<asset>)(<pairs>,<expected>);`. */
function restore(storage: ThrowingStorage, pairs: Pairs, origin = ORIGIN, expected = `${ORIGIN}/login`): Outcome {
  const body = `return (${SRC})(${JSON.stringify(pairs)},${JSON.stringify(expected)});`;
  const run = new Function("localStorage", "location", body) as (
    storage: ThrowingStorage,
    location: { origin: string },
  ) => string;
  return JSON.parse(run(storage, { origin })) as Outcome;
}

describe("session restore script (the real asset, executed)", () => {
  it("writes every pair and reports the count", () => {
    const storage = new ThrowingStorage();
    expect(restore(storage, [["a", "1"], ["b", "2"]])).toEqual({ applied: true, count: 2 });
    expect([...storage.items]).toEqual([["a", "1"], ["b", "2"]]);
  });

  it("writes nothing when the page's origin changed under the restore", () => {
    const storage = new ThrowingStorage();
    expect(restore(storage, [["authToken", "SECRET"]], "https://attacker.example")).toEqual({
      applied: false,
      reason: "origin-changed",
    });
    expect(storage.items.size).toBe(0);
  });

  it("quota exceeded on the first write leaves storage untouched and reports index 0", () => {
    const storage = new ThrowingStorage();
    storage.items.set("z", "keep");
    storage.rejectSet.add("a");
    expect(restore(storage, [["a", "1"], ["b", "2"]])).toEqual({
      applied: false,
      reason: "write-failed",
      index: 0,
      rollbackFailed: [],
    });
    expect([...storage.items]).toEqual([["z", "keep"]]);
  });

  it("a rejected write mid-way puts the earlier writes back to their previous values", () => {
    // `a` existed before (restored to its old value); `b` did not (removed again).
    const storage = new ThrowingStorage();
    storage.items.set("a", "old");
    storage.rejectSet.add("c");
    expect(restore(storage, [["a", "1"], ["b", "2"], ["c", "3"]])).toEqual({
      applied: false,
      reason: "write-failed",
      index: 2,
      rollbackFailed: [],
    });
    expect([...storage.items]).toEqual([["a", "old"]]);
  });

  it("a rollback that itself fails is reported by index, and the true partial state stands", () => {
    // The put-back of `b` throws: the page is only partly restored — `a` is back to
    // its old value, `b` keeps the saved value — and the report says exactly that,
    // instead of the "rolled back" the swallowed exception used to imply.
    const storage = new ThrowingStorage();
    storage.items.set("a", "old");
    storage.rejectSet.add("c");
    storage.rejectRemove.add("b");
    expect(restore(storage, [["a", "1"], ["b", "2"], ["c", "3"]])).toEqual({
      applied: false,
      reason: "write-failed",
      index: 2,
      rollbackFailed: [1],
    });
    expect([...storage.items]).toEqual([["a", "old"], ["b", "2"]]);
  });

  it("a storage-disabled origin fails the first write with nothing to roll back", () => {
    const storage = new ThrowingStorage();
    storage.disabled = true;
    expect(restore(storage, [["a", "1"]])).toEqual({
      applied: false,
      reason: "write-failed",
      index: 0,
      rollbackFailed: [],
    });
    expect(storage.items.size).toBe(0);
  });

  it("never emits a key or a value — only indices", () => {
    const storage = new ThrowingStorage();
    storage.rejectSet.add("authToken");
    const raw = JSON.stringify(restore(storage, [["sid", "SECRET-1"], ["authToken", "SECRET-2"]]));
    expect(raw).not.toContain("SECRET");
    expect(raw).not.toContain("sid");
    expect(raw).not.toContain("authToken");
  });

  it("treats values and keys as data, never code", () => {
    const storage = new ThrowingStorage();
    const hostile: Pairs = [
      ['k"); localStorage.clear(); ("', '"); throw new Error("injected"); //'],
      ["</script>", "${1+1} \\u0000"],
    ];
    expect(restore(storage, hostile)).toEqual({ applied: true, count: 2 });
    expect([...storage.items]).toEqual(hostile);
  });

  it("is the asset Rust includes, called with its arguments appended", () => {
    // The harness above mirrors `restore_script`; if Rust changes how it invokes
    // the asset, this is what fails first.
    expect(RUST).toContain('include_str!("session_restore.src.js")');
    expect(RUST).toContain('format!("return ({RESTORE_SRC})({pairs},{expected});")');
    expect(SRC).toContain("(function (d, expected) {");
    expect(SRC.trimEnd().endsWith("})")).toBe(true);
  });
});
