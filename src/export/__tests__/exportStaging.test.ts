// @vitest-environment node
// Audit 20260907 (#332/#334/#335): the staging tree behind a folder export —
// written under a private directory inside the destination, published by
// rename over the final paths, discarded whole on failure — the per-webview
// queue that keeps two exports in ONE window from interleaving, and (round 3)
// the lock file that keeps two WINDOWS from publishing into one folder at
// once, plus the backup-and-restore that a publish failure rolls back through.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { dirs, under, fail, files, ops, resetFs } from "./exportFsHarness";

vi.mock("@tauri-apps/plugin-fs", async () => (await import("./exportFsHarness")).createFsMock());

vi.mock("@/utils/debug", () => ({ exportWarn: vi.fn() }));

import {
  openStage,
  runExclusive,
  EXPORT_LOCK_NAME,
  EXPORT_LOCK_STALE_MS,
  EXPORT_LOCK_WAIT_MS,
  type ExportStage,
} from "../exportStaging";

const DEST = "/users/me/Report";
const LOCK = `${DEST}/${EXPORT_LOCK_NAME}`;
const named = (op: string) => ops.filter((o) => o[0] === op);
/** Stage a file: the content lives under the staging root until publish. */
const stageFile = (root: string, relative: string, content = `staged ${relative}`) => {
  const path = `${root}/${relative}`;
  dirs.add(path.slice(0, path.lastIndexOf("/")));
  files.set(path, content);
};

beforeEach(() => {
  resetFs();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("openStage", () => {
  it("creates a missing destination and a private staging root inside it", async () => {
    const stage = await openStage(DEST);
    expect(stage.root).toMatch(/^\/users\/me\/Report\/\.vmark-export-[^/]+$/);
    expect(named("mkdir").map((o) => o[1])).toEqual([DEST, stage.root]);
    expect(stage.path("assets/vmark-reader.css")).toBe(`${stage.root}/assets/vmark-reader.css`);
  });

  it("leaves a pre-existing destination alone and stages inside it", async () => {
    dirs.add(DEST);
    const stage = await openStage(DEST);
    expect(named("mkdir").map((o) => o[1])).toEqual([stage.root]);
  });

  it("two stages for one destination never share a root", async () => {
    dirs.add(DEST);
    const a = await openStage(DEST);
    await a.discard();
    const b = await openStage(DEST);
    expect(a.root).not.toBe(b.root);
  });
});

describe("publish", () => {
  it("renames every tracked file over its final path, in order, creating missing parents, then removes the tree", async () => {
    dirs.add(DEST);
    const stage = await openStage(DEST);
    for (const rel of ["assets/vmark-reader.css", "assets/images/cat.png", "index.html"]) {
      stageFile(stage.root, rel);
      stage.track(rel);
    }

    await stage.publish();

    expect(named("rename")).toEqual([
      ["rename", `${stage.root}/assets/vmark-reader.css`, `${DEST}/assets/vmark-reader.css`],
      ["rename", `${stage.root}/assets/images/cat.png`, `${DEST}/assets/images/cat.png`],
      ["rename", `${stage.root}/index.html`, `${DEST}/index.html`],
    ]);
    // The destination's assets/ and assets/images/ did not exist; the root did.
    expect(named("mkdir").map((o) => o[1])).toEqual([stage.root, `${DEST}/assets`, `${DEST}/assets/images`]);
    expect(named("remove-tree")).toEqual([["remove-tree", stage.root]]);
    expect(files.get(`${DEST}/index.html`)).toBe("staged index.html");
    expect(dirs.has(stage.root)).toBe(false);
  });

  it("does not recreate a destination directory that already exists", async () => {
    dirs.add(DEST);
    dirs.add(`${DEST}/assets`);
    const stage = await openStage(DEST);
    stageFile(stage.root, "assets/vmark-reader.js");
    stage.track("assets/vmark-reader.js");
    await stage.publish();
    expect(named("mkdir").map((o) => o[1])).toEqual([stage.root]);
  });

  // #334: a file the destination already had is moved aside into the staging
  // tree before the new one takes its path, so a later failure can put it back.
  it("keeps a pre-existing file as a backup inside the staging tree until the publish completes", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "old index");
    const stage = await openStage(DEST);
    stageFile(stage.root, "index.html", "new index");
    stage.track("index.html");

    await stage.publish();

    expect(named("rename")).toEqual([
      ["rename", `${DEST}/index.html`, `${stage.root}/.replaced/index.html`],
      ["rename", `${stage.root}/index.html`, `${DEST}/index.html`],
    ]);
    expect(files.get(`${DEST}/index.html`)).toBe("new index");
    // The backup went with the staging tree.
    expect([...files.keys()].filter((p) => under(stage.root, p))).toEqual([]);
  });
});

// Audit 20260907 round 2. Publication renames each tracked path over
// `<destination>/<relative>`, so the STRING decides where the export writes and
// what it may replace. Three ways that went wrong, each silent.
describe("what a stage may address", () => {
  it.each([
    ["..", "../escape.html"],
    ["a nested ..", "assets/../../escape.html"],
    ["a backslash .. (Windows takes either separator)", "assets\\..\\..\\escape.html"],
    ["an absolute POSIX path", "/etc/passwd"],
    ["an absolute Windows path", "C:/Windows/System32/x.dll"],
    ["the empty path", ""],
    ["a bare dot", "."],
    ["the destination lock", ".vmark-export.lock"],
    ["another export's staging root", ".vmark-export-abc/index.html"],
  ])("refuses %s", async (_name, relative) => {
    dirs.add(DEST);
    const stage = await openStage(DEST);
    expect(() => stage.track(relative)).toThrow(/contained relative path/);
    expect(() => stage.path(relative)).toThrow(/contained relative path/);
    await stage.discard();
  });

  it("accepts a backslash inside a FILENAME — it is an ordinary character off Windows", async () => {
    // Validation only, never rewriting: normalizing `we\\ird.png` into a
    // directory would send the publish looking for a path nothing staged.
    dirs.add(DEST);
    const stage = await openStage(DEST);
    const odd = "assets/images/we\\ird.png";
    expect(stage.path(odd)).toBe(`${stage.root}/${odd}`);
    stageFile(stage.root, odd);
    stage.track(odd);
    await stage.publish();
    expect(files.get(`${DEST}/${odd}`)).toBe(`staged ${odd}`);
  });

  it("publishing one path twice publishes it ONCE, and keeps the user's file", async () => {
    // The second pass would move the FIRST pass's backup — the user's own
    // index.html — aside under its own output, and the rollback would then
    // restore this export's file over it. That is the data loss the staging
    // design exists to prevent.
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "the user's index");
    const stage = await openStage(DEST);
    stageFile(stage.root, "index.html", "new index");
    stage.track("index.html");
    stage.track("index.html");

    await stage.publish();

    expect(named("rename")).toEqual([
      ["rename", `${DEST}/index.html`, `${stage.root}/.replaced/index.html`],
      ["rename", `${stage.root}/index.html`, `${DEST}/index.html`],
    ]);
    expect(files.get(`${DEST}/index.html`)).toBe("new index");
  });

  it("refuses to publish over a DIRECTORY, and restores what it had already published", async () => {
    // `exists()` cannot tell the two apart, so the directory was moved into the
    // staging tree — and deleted with it on success, the subtree gone with no
    // word to the user.
    dirs.add(DEST);
    dirs.add(`${DEST}/index.html`);
    files.set(`${DEST}/index.html/keep.txt`, "someone's file");
    files.set(`${DEST}/standalone.html`, "old standalone");
    const stage = await openStage(DEST);
    for (const rel of ["standalone.html", "index.html"]) {
      stageFile(stage.root, rel, `new ${rel}`);
      stage.track(rel);
    }

    await expect(stage.publish()).rejects.toThrow(/is a directory/);

    expect(files.get(`${DEST}/index.html/keep.txt`)).toBe("someone's file");
    expect(files.get(`${DEST}/standalone.html`)).toBe("old standalone");
  });
});

describe("publish failure (#334/#335)", () => {
  it("restores every file it had already replaced and removes the ones it had added", async () => {
    dirs.add(DEST);
    dirs.add(`${DEST}/assets`);
    files.set(`${DEST}/index.html`, "old index");
    files.set(`${DEST}/assets/vmark-reader.css`, "old css");
    const stage = await openStage(DEST);
    for (const rel of ["assets/vmark-reader.css", "assets/images/cat.png", "index.html", "standalone.html"]) {
      stageFile(stage.root, rel, `new ${rel}`);
      stage.track(rel);
    }
    fail.renameTo = `${DEST}/standalone.html`;

    await expect(stage.publish()).rejects.toThrow(/standalone\.html/);

    // Replaced files are back; the added image is gone; nothing else remains.
    expect(files.get(`${DEST}/index.html`)).toBe("old index");
    expect(files.get(`${DEST}/assets/vmark-reader.css`)).toBe("old css");
    expect(files.has(`${DEST}/assets/images/cat.png`)).toBe(false);
    expect(files.has(`${DEST}/standalone.html`)).toBe(false);
    // The directory the publish created is removed; the pre-existing one stays.
    expect(dirs.has(`${DEST}/assets/images`)).toBe(false);
    expect(dirs.has(`${DEST}/assets`)).toBe(true);
  });

  it("rolls back in reverse order — the last file replaced is the first restored", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/a.html`, "old a");
    files.set(`${DEST}/b.html`, "old b");
    const stage = await openStage(DEST);
    for (const rel of ["a.html", "b.html", "c.html"]) {
      stageFile(stage.root, rel);
      stage.track(rel);
    }
    fail.renameTo = `${DEST}/c.html`;

    await expect(stage.publish()).rejects.toThrow();

    const restores = named("rename").filter((o) => o[1].startsWith(`${stage.root}/.replaced/`));
    expect(restores.map((o) => o[2])).toEqual([`${DEST}/b.html`, `${DEST}/a.html`]);
  });

  it("says that the folder was restored when every rollback step succeeded", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "old index");
    const stage = await openStage(DEST);
    for (const rel of ["index.html", "standalone.html"]) {
      stageFile(stage.root, rel);
      stage.track(rel);
    }
    fail.renameTo = `${DEST}/standalone.html`;

    await expect(stage.publish()).rejects.toThrow(/the folder was restored/);
  });

  it("names exactly the files it could not put back when the rollback itself fails", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "old index");
    const stage = await openStage(DEST);
    for (const rel of ["index.html", "assets/x.css", "standalone.html"]) {
      stageFile(stage.root, rel);
      stage.track(rel);
    }
    // The publish fails at standalone.html; restoring index.html then fails
    // too — BOTH ways, since a refused rename falls back to a copy (#334).
    fail.renameTo = `${DEST}/standalone.html`;
    fail.removeOf = `${DEST}/assets/x.css`;
    fail.copyTo = `${DEST}/index.html`;
    let error: Error | null = null;
    // A second failure point: the restore of index.html is a rename INTO it.
    const { rename } = await import("@tauri-apps/plugin-fs");
    const real = vi.mocked(rename).getMockImplementation()!;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).includes("/.replaced/index.html")) throw new Error("EACCES restore");
      return real(from, to);
    });
    try {
      await stage.publish();
    } catch (e) {
      error = e as Error;
    } finally {
      vi.mocked(rename).mockImplementation(real);
    }
    expect(error?.message).toMatch(/could not be restored/);
    expect(error?.message).toContain(`${DEST}/index.html`);
    expect(error?.message).toContain(`${DEST}/assets/x.css`);
    expect(error?.message).not.toContain("standalone.html (");
  });
});

// Audit R2 (#674/#675/#676): what the rejection CLAIMS about the destination
// has to be true — a backup that is gone is not "kept", a folder with the
// export's own leftover directories in it was not "restored to its previous
// contents", and a directory chain half-created by a failed publish is still
// this publish's to remove.
describe("publish failure — the rollback tells the truth", () => {
  it("does not claim a backup is kept when the backup is gone too (#674)", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "old index");
    const stage = await openStage(DEST);
    for (const rel of ["index.html", "standalone.html"]) {
      stageFile(stage.root, rel, `new ${rel}`);
      stage.track(rel);
    }
    fail.renameTo = `${DEST}/standalone.html`;
    const backup = `${stage.root}/.replaced/index.html`;
    // Interference: the backup disappears before the rollback reaches it, so
    // both the rename and the copyFile fall over on a missing source.
    const { rename } = await import("@tauri-apps/plugin-fs");
    const real = vi.mocked(rename).getMockImplementation()!;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(to) === `${DEST}/standalone.html`) files.delete(backup);
      return real(from, to);
    });

    const error = await stage.publish().then(
      () => null,
      (e: Error) => e,
    );
    vi.mocked(rename).mockImplementation(real);

    expect(error?.message).toContain("is gone too");
    expect(error?.message).not.toContain("previous contents are kept at");
    // Nothing was retained, so the staging tree is not held open for it.
    await stage.discard();
    expect(dirs.has(stage.root)).toBe(false);
  });

  it("says which folders it created and could not remove (#675)", async () => {
    dirs.add(DEST);
    const stage = await openStage(DEST);
    for (const rel of ["assets/x.css", "index.html"]) {
      stageFile(stage.root, rel);
      stage.track(rel);
    }
    fail.renameTo = `${DEST}/index.html`;
    fail.removeOf = `${DEST}/assets`;

    const error = await stage.publish().then(
      () => null,
      (e: Error) => e,
    );

    expect(error?.message).toContain(`${DEST}/assets`);
    expect(error?.message).not.toMatch(/the folder was restored/);
  });

  it("removes the levels it DID create when a deeper mkdir fails (#676)", async () => {
    dirs.add(DEST);
    const stage = await openStage(DEST);
    stageFile(stage.root, "assets/images/logo.png");
    stage.track("assets/images/logo.png");
    fail.mkdirOf = `${DEST}/assets/images`;

    await expect(stage.publish()).rejects.toThrow(/EACCES/);

    // `assets` was created by this publish and is recorded even though the
    // level below it never came into existence.
    expect(dirs.has(`${DEST}/assets`)).toBe(false);
  });

  it("never removes a directory another export created in the meantime (#676)", async () => {
    dirs.add(DEST);
    const stage = await openStage(DEST);
    for (const rel of ["assets/x.css", "index.html"]) {
      stageFile(stage.root, rel);
      stage.track(rel);
    }
    // Between the walk and the mkdir, somebody else makes the directory.
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    const realMkdir = vi.mocked(mkdir).getMockImplementation()!;
    vi.mocked(mkdir).mockImplementation(async (path, options) => {
      if (String(path) === `${DEST}/assets`) dirs.add(`${DEST}/assets`);
      return realMkdir(path, options);
    });
    fail.renameTo = `${DEST}/index.html`;

    await expect(stage.publish()).rejects.toThrow(/the folder was restored/);
    vi.mocked(mkdir).mockImplementation(realMkdir);

    // Not this publish's directory, so the rollback leaves it alone.
    expect(dirs.has(`${DEST}/assets`)).toBe(true);
  });
});

describe("discard", () => {
  it("removes the staging tree and NOTHING at a pre-existing destination", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "old");
    const stage = await openStage(DEST);
    stageFile(stage.root, "index.html");
    stage.track("index.html");
    await stage.discard();
    expect(named("remove-tree")).toEqual([["remove-tree", stage.root]]);
    expect(named("rename")).toEqual([]);
    expect(files.get(`${DEST}/index.html`)).toBe("old");
    expect(dirs.has(DEST)).toBe(true);
  });

  it("also removes the (still empty) destination folder this stage created", async () => {
    const stage = await openStage(DEST);
    await stage.discard();
    expect(dirs.has(stage.root)).toBe(false);
    expect(dirs.has(DEST)).toBe(false);
    expect(files.has(LOCK)).toBe(false);
  });
});

// #332, round 3: `runExclusive` serializes exports within one webview. A second
// WINDOW has its own queue, so two windows could publish into one folder at
// once. The lock is a file the destination itself holds, created exclusively
// (`createNew`), so every process sees the same one.
describe("the destination lock (#332)", () => {
  it("is taken when the stage opens and released when it publishes", async () => {
    dirs.add(DEST);
    const stage = await openStage(DEST);
    expect(files.has(LOCK)).toBe(true);
    expect(JSON.parse(files.get(LOCK)!)).toEqual({
      acquiredAt: expect.any(Number),
      owner: expect.any(String),
    });
    await stage.publish();
    expect(files.has(LOCK)).toBe(false);
  });

  it("is released by discard too", async () => {
    dirs.add(DEST);
    const stage = await openStage(DEST);
    await stage.discard();
    expect(files.has(LOCK)).toBe(false);
  });

  it("a second stage for the same destination waits until the first releases the lock", async () => {
    vi.useFakeTimers();
    dirs.add(DEST);
    const first = await openStage(DEST);
    let opened = false;
    const second = openStage(DEST).then((stage) => {
      opened = true;
      return stage;
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(opened).toBe(false);

    await first.publish();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(opened).toBe(true);
    const stage = await second;
    expect(files.has(LOCK)).toBe(true);
    await stage.discard();
  });

  it("takes over a lock older than the stale threshold — a window that died mid-export", async () => {
    dirs.add(DEST);
    files.set(LOCK, JSON.stringify({ acquiredAt: Date.now() - EXPORT_LOCK_STALE_MS - 1, owner: "dead-window" }));
    const stage = await openStage(DEST);
    expect(JSON.parse(files.get(LOCK)!).acquiredAt).toBeGreaterThan(Date.now() - 1_000);
    await stage.discard();
  });

  it("gives up after the wait limit, naming the lock file, when the holder never releases it", async () => {
    vi.useFakeTimers();
    dirs.add(DEST);
    files.set(LOCK, JSON.stringify({ acquiredAt: Date.now(), owner: "live-window" }));
    const attempt = openStage(DEST);
    const outcome = attempt.then(
      () => "opened",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(EXPORT_LOCK_WAIT_MS + 1_000);
    expect(await outcome).toMatch(/another export/i);
    expect(await outcome).toContain(LOCK);
    // The holder's lock is untouched.
    expect(files.has(LOCK)).toBe(true);
  });

  it("does not take over a lock it cannot read as its own — a foreign file is not a stale lock", async () => {
    vi.useFakeTimers();
    dirs.add(DEST);
    files.set(LOCK, "not json");
    const outcome = openStage(DEST).then(
      () => "opened",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(EXPORT_LOCK_WAIT_MS + 1_000);
    expect(await outcome).toMatch(/another export/i);
    expect(files.get(LOCK)).toBe("not json");
  });

  it("reports a lock write that failed for any other reason at once, rather than waiting it out", async () => {
    vi.useFakeTimers();
    // The destination cannot be created: mkdir "succeeds" in the mock, so make
    // the lock's parent vanish instead.
    dirs.add(DEST);
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const real = vi.mocked(writeTextFile).getMockImplementation()!;
    vi.mocked(writeTextFile).mockImplementationOnce(async () => {
      throw new Error("EACCES: read-only volume");
    });
    const outcome = openStage(DEST).then(
      () => "opened",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toBe("EACCES: read-only volume");
    vi.mocked(writeTextFile).mockImplementation(real);
  });

  it("removes a destination it created when the lock cannot be taken", async () => {
    vi.useFakeTimers();
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const real = vi.mocked(writeTextFile).getMockImplementation()!;
    vi.mocked(writeTextFile).mockImplementationOnce(async () => {
      throw new Error("EACCES");
    });
    const outcome = openStage(DEST).then(
      () => "opened",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toBe("EACCES");
    expect(dirs.has(DEST)).toBe(false);
    vi.mocked(writeTextFile).mockImplementation(real);
  });
});

describe("runExclusive", () => {
  it("runs tasks under one key strictly one after another, even when the earlier one rejects", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = runExclusive("k", async () => {
      order.push("first:start");
      await new Promise<void>((r) => {
        releaseFirst = r;
      });
      order.push("first:end");
      throw new Error("first failed");
    });
    const second = runExclusive("k", async () => {
      order.push("second:start");
      return "second done";
    });
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    releaseFirst();
    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe("second done");
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("lets tasks under different keys run concurrently", async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = runExclusive("a", async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      order.push("a");
    });
    const other = runExclusive("b", async () => {
      order.push("b");
    });
    await other;
    expect(order).toEqual(["b"]);
    release();
    await held;
    expect(order).toEqual(["b", "a"]);
  });
});

// Round 4 (audit 20260907, verifier): the round-3 fix introduced three of its
// own. Each test below is one of them, reproducing the exact scenario named.
describe("openStage — the lock is released on EVERY path out (#335)", () => {
  it("releases the lock and removes a destination it created when the staging root cannot be made", async () => {
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    const real = vi.mocked(mkdir).getMockImplementation()!;
    vi.mocked(mkdir).mockImplementation(async (path, options) => {
      if (String(path).includes("/.vmark-export-")) throw new Error("EACCES: staging root");
      return real(path, options);
    });

    try {
      await expect(openStage(DEST)).rejects.toThrow("EACCES: staging root");
    } finally {
      vi.mocked(mkdir).mockImplementation(real);
    }

    // The lock is taken BEFORE the staging root is made, so this path used to
    // leave it behind — the folder un-exportable until the stale timeout.
    expect(files.has(LOCK)).toBe(false);
    expect(dirs.has(DEST)).toBe(false);
  });

  it("leaves a pre-existing destination in place when the staging root cannot be made", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "the user's own file");
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    const real = vi.mocked(mkdir).getMockImplementation()!;
    vi.mocked(mkdir).mockImplementation(async (path, options) => {
      if (String(path).includes("/.vmark-export-")) throw new Error("EACCES: staging root");
      return real(path, options);
    });

    try {
      await expect(openStage(DEST)).rejects.toThrow("EACCES: staging root");
    } finally {
      vi.mocked(mkdir).mockImplementation(real);
    }

    expect(files.has(LOCK)).toBe(false);
    expect(dirs.has(DEST)).toBe(true);
    expect(files.get(`${DEST}/index.html`)).toBe("the user's own file");
  });
});

// #334, round 4: the restoring rename was assumed to replace whatever sits at
// the final path. It usually does — `std::fs::rename` is MoveFileExW with
// MOVEFILE_REPLACE_EXISTING on Windows — but that call needs DELETE access to
// the file it replaces and is refused while any other handle holds it. When
// the restore failed, `discard` then removed the staging tree WITH the backup
// in it: the user's file gone and the half-written export left in its place.
describe("publish failure — the original survives a refused restore (#334)", () => {
  const publishOverExisting = async (stage: ExportStage) => {
    for (const rel of ["index.html", "standalone.html"]) {
      stageFile(stage.root, rel, `new ${rel}`);
      stage.track(rel);
    }
    fail.renameTo = `${DEST}/standalone.html`;
    fail.renameOntoExisting = true;
  };

  it("puts the original back when the restoring rename is refused because the final file exists", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "old index");
    const stage = await openStage(DEST);
    await publishOverExisting(stage);

    await expect(stage.publish()).rejects.toThrow(/the folder was restored/);

    expect(files.get(`${DEST}/index.html`)).toBe("old index");
    // ...and the export's own cleanup does not then take it away again.
    await stage.discard();
    expect(files.get(`${DEST}/index.html`)).toBe("old index");
  });

  it("keeps the backup, and says where it is, when nothing can put the original back", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "old index");
    const stage = await openStage(DEST);
    await publishOverExisting(stage);
    fail.copyTo = `${DEST}/index.html`;
    const backup = `${stage.root}/.replaced/index.html`;

    const error = await stage.publish().then(
      () => null,
      (e: Error) => e,
    );

    expect(error?.message).toMatch(/could not be restored/);
    expect(error?.message).toContain(backup);
    // The one thing that must never happen: the backup discarded while the
    // original is gone. `discard` leaves the tree standing when it holds the
    // only copy of a file the user had.
    await stage.discard();
    expect(files.get(backup)).toBe("old index");
  });
});

// #332, round 4: the stale takeover was a read, a decision and a write with no
// atomicity between them, so two windows that both found one dead lock both
// "took" it and published into the folder together.
describe("the destination lock — stale takeover (#332)", () => {
  it("lets exactly one of two windows take over one stale lock", async () => {
    vi.useFakeTimers();
    dirs.add(DEST);
    files.set(LOCK, JSON.stringify({ acquiredAt: Date.now() - EXPORT_LOCK_STALE_MS - 1, owner: "dead-window" }));

    // Hold BOTH readers at the dead lock so each judges it stale before either
    // acts. That interleaving is the whole finding: a per-webview queue cannot
    // order two windows, and nothing else did.
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const real = vi.mocked(readTextFile).getMockImplementation()!;
    let arrived = 0;
    let bothArrived!: () => void;
    const barrier = new Promise<void>((resolve) => {
      bothArrived = resolve;
    });
    vi.mocked(readTextFile).mockImplementation(async (path) => {
      const text = await real(path);
      if (String(path) === LOCK && ++arrived <= 2) {
        if (arrived === 2) bothArrived();
        await barrier;
      }
      return text;
    });

    const opened: ExportStage[] = [];
    let refused = 0;
    const record = (p: Promise<ExportStage>) =>
      p.then(
        (stage) => {
          opened.push(stage);
        },
        () => {
          refused += 1;
        },
      );
    const first = record(openStage(DEST));
    const second = record(openStage(DEST));

    try {
      await vi.advanceTimersByTimeAsync(1_000);
      // Exactly one publisher. The other is QUEUED behind it, not refused.
      expect(opened.length).toBe(1);
      expect(refused).toBe(0);

      await opened[0].discard();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(opened.length).toBe(2);
      await opened[1].discard();
      await Promise.all([first, second]);
    } finally {
      // Restored even on a failed assertion: a leaked barrier would hang the
      // rest of the file rather than report this test.
      bothArrived();
      vi.mocked(readTextFile).mockImplementation(real);
    }
  });

  it("puts a lock back and stands down when it was retaken between the read and the move", async () => {
    vi.useFakeTimers();
    dirs.add(DEST);
    files.set(LOCK, JSON.stringify({ acquiredAt: Date.now() - EXPORT_LOCK_STALE_MS - 1, owner: "dead-window" }));
    const live = JSON.stringify({ acquiredAt: Date.now(), owner: "another-window" });
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const real = vi.mocked(readTextFile).getMockImplementation()!;
    vi.mocked(readTextFile).mockImplementation(async (path) => {
      const text = await real(path);
      // The dead holder's lock was released and a live window took it, in the
      // instant between this read and the move that acts on it.
      if (String(path) === LOCK) files.set(LOCK, live);
      return text;
    });

    const outcome = openStage(DEST).then(
      () => "opened",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(EXPORT_LOCK_WAIT_MS + 1_000);
    vi.mocked(readTextFile).mockImplementation(real);

    expect(await outcome).toMatch(/another export/i);
    // The live lock is back where it was, byte for byte, and unowned by us.
    expect(files.get(LOCK)).toBe(live);
  });

  it("refuses to publish once its own lock has been taken over", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "the other window's index");
    const stage = await openStage(DEST);
    stageFile(stage.root, "index.html", "our index");
    stage.track("index.html");
    // Five minutes passed, another window judged this lock dead and took the
    // folder. Publishing now would interleave two exports' files.
    files.set(LOCK, JSON.stringify({ acquiredAt: Date.now(), owner: "another-window" }));

    await expect(stage.publish()).rejects.toThrow(/took over/);

    expect(named("rename")).toEqual([]);
    expect(files.get(`${DEST}/index.html`)).toBe("the other window's index");
  });

  it("does not remove a lock another window has since taken over", async () => {
    dirs.add(DEST);
    const stage = await openStage(DEST);
    const mine = files.get(LOCK);
    // The window that took over wrote its own lock; ours is long gone.
    files.set(LOCK, JSON.stringify({ acquiredAt: Date.now(), owner: "another-window" }));

    await stage.discard();

    expect(files.get(LOCK)).not.toBe(mine);
    expect(JSON.parse(files.get(LOCK)!).owner).toBe("another-window");
  });
});
