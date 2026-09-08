// @vitest-environment node
// The destination lock on its own (audit 20260907 round 2). `exportStaging.test.ts`
// exercises it through a stage; these are the cases about the LOCK FILE itself —
// what counts as one of ours, and what the takeover leaves behind when it does not
// become the holder. A takeover that fails must leave the folder exactly as it
// found it: staleness is a clock heuristic, so the holder it judged dead may only
// be slow, and deleting its lock hands the destination to a third window.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** A tiny in-memory tree — this module only ever touches four fs calls. */
const files = new Map<string, string>();
/** Every write to a lock path the takeover has just FREED is refused. */
const refuse = { freedLockWrites: false, allLockWrites: false, lockRename: "" as "" | "denied" | "race" };

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (path: string) => {
    const text = files.get(path);
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  }),
  writeTextFile: vi.fn(async (path: string, text: string, options?: { createNew?: boolean }) => {
    const free = !files.has(path);
    if (options?.createNew && !free) throw new Error(`EEXIST: ${path}`);
    if (path === LOCK && free && (refuse.allLockWrites || (refuse.freedLockWrites && !text.includes("dead-window")))) {
      throw new Error("EACCES: read-only volume");
    }
    files.set(path, text);
  }),
  exists: vi.fn(async (path: string) => files.has(path)),
  rename: vi.fn(async (from: string, to: string) => {
    const content = files.get(from);
    if (content === undefined) throw new Error(`ENOENT: ${from}`);
    if (refuse.lockRename === "denied") throw new Error("EACCES: another process holds it open");
    if (refuse.lockRename === "race") {
      // Another window moved this same stale lock a moment earlier.
      files.delete(from);
      throw new Error("ENOENT: no such file or directory");
    }
    files.delete(from);
    files.set(to, content);
  }),
  remove: vi.fn(async (path: string) => {
    if (!files.delete(path)) throw new Error(`ENOENT: ${path}`);
  }),
}));

vi.mock("@/utils/debug", () => ({ exportWarn: vi.fn() }));

import {
  acquireExportLock,
  holdsExportLock,
  releaseExportLock,
  EXPORT_LOCK_NAME,
  EXPORT_LOCK_STALE_MS,
  EXPORT_LOCK_WAIT_MS,
} from "../exportLock";

const DEST = "/users/me/Report";
const LOCK = `${DEST}/${EXPORT_LOCK_NAME}`;
const dead = () =>
  JSON.stringify({ acquiredAt: Date.now() - EXPORT_LOCK_STALE_MS - 1, owner: "dead-window" });

beforeEach(() => {
  files.clear();
  refuse.freedLockWrites = false;
  refuse.allLockWrites = false;
  refuse.lockRename = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("acquireExportLock", () => {
  it("creates the lock and hands back the owner token that holds it", async () => {
    const owner = await acquireExportLock(DEST);
    expect(JSON.parse(files.get(LOCK)!).owner).toBe(owner);
    expect(await holdsExportLock(DEST, owner)).toBe(true);
    expect(await holdsExportLock(DEST, "somebody-else")).toBe(false);
  });

  it("takes over a lock older than the stale threshold", async () => {
    files.set(LOCK, dead());
    const owner = await acquireExportLock(DEST);
    expect(await holdsExportLock(DEST, owner)).toBe(true);
  });

  it("does not take over JSON that names no owner — that file is not one of ours", async () => {
    vi.useFakeTimers();
    const foreign = JSON.stringify({ acquiredAt: Date.now() - EXPORT_LOCK_STALE_MS - 1 });
    files.set(LOCK, foreign);
    const outcome = acquireExportLock(DEST).then(
      () => "acquired",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(EXPORT_LOCK_WAIT_MS + 1_000);
    expect(await outcome).toMatch(/another export/i);
    expect(files.get(LOCK)).toBe(foreign);
  });

  it("puts the stale lock BACK when its own replacement cannot be written", async () => {
    files.set(LOCK, dead());
    const before = files.get(LOCK);
    refuse.freedLockWrites = true;
    await expect(acquireExportLock(DEST)).rejects.toThrow(/read-only volume/);
    expect(files.get(LOCK)).toBe(before);
    expect([...files.keys()].filter((p) => p.includes(".stale-"))).toEqual([]);
  });

  it("KEEPS the moved-aside lock, named, when it cannot be put back", async () => {
    // The aside is then the only copy of that lock; discarding it would unlock
    // the destination silently. Same rule as an unrestorable export backup.
    files.set(LOCK, dead());
    const before = files.get(LOCK);
    refuse.allLockWrites = true;
    await expect(acquireExportLock(DEST)).rejects.toThrow(/read-only volume/);
    const kept = [...files.keys()].filter((p) => p.startsWith(`${LOCK}.stale-`));
    expect(kept).toHaveLength(1);
    expect(files.get(kept[0])).toBe(before);
  });

  // Audit R2 (#663): every rename failure was read as a lost race, so a
  // permission denial or a read-only volume became 30 seconds of polling and
  // then a message blaming a second export that was never running — against
  // this module's own rule that only "already exists" means contention.
  it("raises a takeover failure that is NOT a lost race, instead of waiting it out", async () => {
    const stale = dead();
    files.set(LOCK, stale);
    refuse.lockRename = "denied";
    await expect(acquireExportLock(DEST)).rejects.toThrow(/EACCES/);
    // The lock is left exactly as it was found.
    expect(files.get(LOCK)).toBe(stale);
  });

  it("stands down quietly when another window moved the same stale lock first", async () => {
    files.set(LOCK, dead());
    refuse.lockRename = "race";
    // Not an error to report: the source is gone because someone else moved
    // it, which is exactly what the rename is there to arbitrate.
    const owner = await acquireExportLock(DEST);
    expect(await holdsExportLock(DEST, owner)).toBe(true);
  });
});

describe("releaseExportLock", () => {
  it("removes the lock it owns", async () => {
    const owner = await acquireExportLock(DEST);
    await releaseExportLock(DEST, owner);
    expect(files.has(LOCK)).toBe(false);
  });

  it("leaves a successor's lock alone", async () => {
    const owner = await acquireExportLock(DEST);
    const successor = JSON.stringify({ acquiredAt: Date.now(), owner: "another-window" });
    files.set(LOCK, successor);
    await releaseExportLock(DEST, owner);
    expect(files.get(LOCK)).toBe(successor);
  });

  it("leaves a lock it cannot read alone — it is not provably ours", async () => {
    const owner = await acquireExportLock(DEST);
    files.set(LOCK, "not json");
    await releaseExportLock(DEST, owner);
    expect(files.get(LOCK)).toBe("not json");
  });
});

// Audit 20260907 round 3 (#667): "already exists" was matched as /exist/i, and
// the substring "exist" is also in "does not exist" and "no such file". A
// missing parent directory therefore read as CONTENTION — the acquire loop
// spent its whole 30-second wait on it and then blamed a second export that was
// never there, against this module's own rule that only contention waits.
describe("what counts as contention", () => {
  it.each([
    "EEXIST: file already exists",
    "File exists (os error 17)",
    "Cannot create a file when that file already exists. (os error 183)",
  ])("waits for %s", async (message) => {
    vi.useFakeTimers();
    const fs = await import("@tauri-apps/plugin-fs");
    vi.mocked(fs.writeTextFile).mockRejectedValueOnce(new Error(message));
    const acquire = acquireExportLock(DEST);
    await vi.advanceTimersByTimeAsync(500);
    await expect(acquire).resolves.toEqual(expect.any(String));
  });

  it.each([
    "No such file or directory (os error 2)",
    "The destination folder does not exist",
    "EACCES: permission denied",
    "Read-only file system (os error 30)",
  ])("raises %s at once instead of waiting it out", async (message) => {
    const fs = await import("@tauri-apps/plugin-fs");
    vi.mocked(fs.writeTextFile).mockRejectedValueOnce(new Error(message));
    await expect(acquireExportLock(DEST)).rejects.toThrow(message);
  });
});
