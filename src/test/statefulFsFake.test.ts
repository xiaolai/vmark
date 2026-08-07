// @vitest-environment node
// WI-17 — contract tests for the Tier-0 stateful fs fake (matrix cases 10, 11).
// The four flow suites in src/test/tier0/ are only as trustworthy as this fake:
// a fake that resolved `undefined` for an unmodelled operation would green
// every one of them vacuously — the src/test/setup.ts false-confidence class.
// Concurrency/protocol context for the flows: decision ledger D6
// (.claude/tdd-guardian/decisions-20260803.md).
import { describe, it, expect, beforeEach } from "vitest";
import { statefulFs } from "./statefulFsFake";

beforeEach(() => {
  statefulFs.reset();
});

describe("statefulFsFake — statefulness (case 11)", () => {
  it("write → read returns the written bytes, byte-identical", async () => {
    const fs = statefulFs.fsModule() as {
      writeTextFile: (p: string, c: string) => Promise<void>;
      readTextFile: (p: string) => Promise<string>;
    };
    const body = "# 标题\r\n混合 CJK 与 latin\n\u{FEFF}tail";
    statefulFs.mkdirp("/repo");

    await fs.writeTextFile("/repo/doc.md", body);

    await expect(fs.readTextFile("/repo/doc.md")).resolves.toBe(body);
    expect(statefulFs.read("/repo/doc.md")).toBe(body);
  });

  it("routes the app's real write surface (`atomic_write_file`) to the same disk", async () => {
    statefulFs.mkdirp("/repo");
    await statefulFs.invoke("atomic_write_file", { path: "/repo/a.md", content: "one" });

    expect(statefulFs.read("/repo/a.md")).toBe("one");
    expect(statefulFs.writesTo("/repo/a.md")).toEqual([
      { path: "/repo/a.md", content: "one", via: "atomic_write_file" },
    ]);
  });

  it("mtime is settable and observable through stat, and advances on write", async () => {
    const fs = statefulFs.fsModule() as {
      stat: (p: string) => Promise<{ mtime: Date | null; size: number; isFile: boolean }>;
      writeTextFile: (p: string, c: string) => Promise<void>;
    };
    statefulFs.seed("/repo/doc.md", "v1", { mtimeMs: 1_700_000_000_000 });

    const first = await fs.stat("/repo/doc.md");
    expect(first.mtime?.getTime()).toBe(1_700_000_000_000);
    expect(first.isFile).toBe(true);

    statefulFs.setMtime("/repo/doc.md", 1_700_000_500_000);
    expect((await fs.stat("/repo/doc.md")).mtime?.getTime()).toBe(1_700_000_500_000);

    await fs.writeTextFile("/repo/doc.md", "v2");
    const afterWrite = await fs.stat("/repo/doc.md");
    expect(afterWrite.mtime?.getTime()).toBeGreaterThan(1_700_000_500_000);
    expect(afterWrite.size).toBe(2);
  });

  it("an external write replaces bytes and moves mtime without recording an app write", () => {
    statefulFs.seed("/repo/doc.md", "local", { mtimeMs: 10 });

    statefulFs.externalWrite("/repo/doc.md", "from git", { mtimeMs: 999 });

    expect(statefulFs.read("/repo/doc.md")).toBe("from git");
    expect(statefulFs.mtimeOf("/repo/doc.md")).toBe(999);
    expect(statefulFs.writes).toEqual([]); // the app did not write this
  });

  it("reset() clears files, dirs, writes, failures and stubs", async () => {
    statefulFs.seed("/repo/doc.md", "x");
    statefulFs.failWrites(new Error("disk"));
    statefulFs.stubCommand("custom", () => 1);

    statefulFs.reset();

    expect(statefulFs.paths()).toEqual([]);
    expect(statefulFs.writes).toEqual([]);
    await expect(statefulFs.invoke("custom")).rejects.toThrow(/unexpected invoke/);
    statefulFs.mkdirp("/repo");
    await expect(
      statefulFs.invoke("atomic_write_file", { path: "/repo/y.md", content: "ok" }),
    ).resolves.toBeUndefined();
  });
});

describe("statefulFsFake — no silent success (case 10)", () => {
  it("reading an unknown path rejects the way the real plugin does", async () => {
    const fs = statefulFs.fsModule() as { readTextFile: (p: string) => Promise<string> };
    await expect(fs.readTextFile("/repo/ghost.md")).rejects.toThrow(
      /No such file or directory/,
    );
  });

  it("stat / readDir / remove / rename on unknown paths all reject", async () => {
    const fs = statefulFs.fsModule() as Record<string, (...a: never[]) => Promise<unknown>>;
    await expect(fs.stat("/repo/ghost.md" as never)).rejects.toThrow(/No such file/);
    await expect(fs.readDir("/nope" as never)).rejects.toThrow(/No such file/);
    await expect(fs.remove("/repo/ghost.md" as never)).rejects.toThrow(/No such file/);
    await expect(fs.rename("/repo/ghost.md" as never, "/repo/x.md" as never)).rejects.toThrow(
      /No such file/,
    );
  });

  it("an unmodelled fs export throws on ACCESS, never reads as undefined", () => {
    const fs = statefulFs.fsModule() as Record<string, unknown>;
    expect(() => fs.copyFile).toThrow(/export "copyFile" is not modelled/);
  });

  it("an unstubbed invoke command rejects naming the command", async () => {
    await expect(statefulFs.invoke("force_quit")).rejects.toThrow(
      /unexpected invoke\("force_quit"\)/,
    );
  });

  it("a stubbed command is used, and its args reach the handler", async () => {
    const seen: unknown[] = [];
    statefulFs.stubCommand("force_quit", (args) => {
      seen.push(args);
      return "done";
    });
    await expect(statefulFs.invoke("force_quit", { why: "test" })).resolves.toBe("done");
    expect(seen).toEqual([{ why: "test" }]);
  });

  it("a write into a directory that does not exist rejects with the typed parent-missing shape", async () => {
    await expect(
      statefulFs.invoke("atomic_write_file", { path: "/gone/doc.md", content: "x" }),
    ).rejects.toMatchObject({ code: "not-found", detail: { dir: "/gone" } });
    expect(statefulFs.has("/gone/doc.md")).toBe(false);
    expect(statefulFs.writes).toEqual([]);
  });

  it("plugin-fs writeTextFile into a missing directory rejects as a plain io error", async () => {
    const fs = statefulFs.fsModule() as { writeTextFile: (p: string, c: string) => Promise<void> };
    await expect(fs.writeTextFile("/gone/doc.md", "x")).rejects.toThrow(
      /No such file or directory/,
    );
    expect(statefulFs.has("/gone/doc.md")).toBe(false);
  });

  it("failWrites() makes every write reject and leaves the previous bytes intact", async () => {
    statefulFs.seed("/repo/doc.md", "original");
    statefulFs.failWrites(new Error("disk full"));

    await expect(
      statefulFs.invoke("atomic_write_file", { path: "/repo/doc.md", content: "new" }),
    ).rejects.toThrow(/disk full/);

    expect(statefulFs.read("/repo/doc.md")).toBe("original");
    expect(statefulFs.writes).toEqual([]);

    statefulFs.failWrites(null);
    await statefulFs.invoke("atomic_write_file", { path: "/repo/doc.md", content: "new" });
    expect(statefulFs.read("/repo/doc.md")).toBe("new");
  });

  it("synchronous test-side reads of an absent path throw rather than return undefined", () => {
    expect(() => statefulFs.read("/repo/ghost.md")).toThrow(/no such file on the fake disk/);
    expect(() => statefulFs.mtimeOf("/repo/ghost.md")).toThrow(/no such file on the fake disk/);
    expect(() => statefulFs.setMtime("/repo/ghost.md", 1)).toThrow(/no such file on the fake disk/);
  });

  it("get_file_size_bytes reports real byte length (multibyte-aware) and rejects for holes", async () => {
    statefulFs.seed("/repo/cjk.md", "中文"); // 6 bytes UTF-8, 2 UTF-16 units
    await expect(statefulFs.invoke("get_file_size_bytes", { path: "/repo/cjk.md" })).resolves.toBe(6);
    await expect(
      statefulFs.invoke("get_file_size_bytes", { path: "/repo/ghost.md" }),
    ).rejects.toThrow(/ENOENT/);
  });
});
