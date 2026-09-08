// @vitest-environment node
// exportHtml's failure and publish semantics (audit 20260907, #332/#334).
//
// The export used to write straight into the destination and, on failure,
// delete every path it had written — which, over a previous export, meant
// overwriting index.html and the assets first and then deleting them. It now
// writes under a staging tree inside the destination and publishes by rename
// once every file exists; a failure removes the staging tree alone.
//
// Round 3 adds two things these assertions have to account for: a destination
// file the publish is about to replace is renamed ASIDE into `.replaced/` first
// (#334), and the destination carries a LOCK file for the duration so a second
// WINDOW cannot publish into it (#332). The lock's own write/remove is filtered
// out of the op streams below and pinned separately, so the two concerns stay
// legible apart.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Op = [op: string, ...paths: string[]];
const ops: Op[] = [];
/** Declared above the fs mock, which reads the lock back by name. */
const LOCK_NAME = ".vmark-export.lock";
/** Paths that exist BEFORE the export runs. */
const existing = new Set<string>();
const control = {
  failStandalone: true,
  /** The lock's own bytes: release reads them back to check it is still ours. */
  lockText: null as string | null,
  /** When set, the standalone.html write of the FIRST export waits on it. */
  holdStandalone: null as null | Promise<void>,
};

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async (path: string) => existing.has(path)),
  // Publication asks what an existing final path IS: a directory is refused
  // rather than moved aside. Everything this suite creates is a file.
  lstat: vi.fn(async (path: string) => {
    if (!existing.has(path)) throw new Error(`ENOENT: ${path}`);
    return { isFile: true, isDirectory: false, isSymlink: false };
  }),
  mkdir: vi.fn(async (path: string) => {
    ops.push(["mkdir", path]);
    existing.add(path);
  }),
  readTextFile: vi.fn(async (path: string) => {
    // The destination lock is the only file this suite writes and reads back:
    // `releaseExportLock` refuses to remove a lock that is not its own (#332).
    if (path.endsWith(LOCK_NAME) && control.lockText !== null) return control.lockText;
    throw new Error(`ENOENT: ${path}`);
  }),
  copyFile: vi.fn(),
  writeTextFile: vi.fn(async (path: string, text: string) => {
    ops.push(["write", path]);
    if (path.endsWith(LOCK_NAME)) control.lockText = text;
    if (path.endsWith("standalone.html")) {
      if (control.holdStandalone) {
        const hold = control.holdStandalone;
        control.holdStandalone = null;
        await hold;
      }
      if (control.failStandalone) throw new Error("Simulated write failure");
    }
  }),
  writeFile: vi.fn(),
  rename: vi.fn(async (from: string, to: string) => {
    ops.push(["rename", from, to]);
  }),
  remove: vi.fn(async (path: string, options?: { recursive?: boolean }) => {
    ops.push([options?.recursive ? "remove-tree" : "remove", path]);
    if (path.endsWith(LOCK_NAME)) control.lockText = null;
  }),
}));

vi.mock("../themeSnapshot", () => ({
  captureThemeCSS: () => "/* theme */",
  isDarkTheme: () => false,
}));

vi.mock("../resourceResolver", () => ({
  resolveResources: async (_html: string) => ({
    html: "<p>test</p>",
    report: { resources: [], missing: [] },
  }),
  getDocumentBaseDir: async () => "/tmp",
}));

vi.mock("../fontEmbedder", () => ({
  contentHasMath: () => false,
  getKaTeXFontFiles: () => [],
  getUserFontFile: () => null,
  downloadFont: async () => null,
  generateLocalFontCSS: () => "",
  generateEmbeddedFontCSS: () => "",
  fontDataToDataUri: () => "",
}));

vi.mock("../htmlSanitizer", () => ({
  sanitizeExportHtml: (html: string) => html,
}));

vi.mock("../htmlTemplates", () => ({
  generateIndexHtml: () => "<html>index</html>",
  generateStandaloneHtml: () => "<html>standalone</html>",
}));

vi.mock("../htmlExportStyles", () => ({
  getEditorContentCSS: () => "/* content */",
}));

vi.mock("../reader", () => ({
  getReaderCSS: () => "/* reader css */",
  getReaderJS: () => "/* reader js */",
}));

vi.mock("@/utils/debug", () => ({ exportWarn: vi.fn() }));

import { exportHtml } from "../htmlExport";

const DEST = "/users/me/MyReport";
const STAGING = /^\/users\/me\/MyReport\/\.vmark-export-[^/]+/;
const LOCK = `${DEST}/${LOCK_NAME}`;
const isLockOp = (o: Op) => o.some((p) => p.endsWith(`/${LOCK_NAME}`));
/** Every op except the destination lock's, which has its own describe below. */
const opsNoLock = () => ops.filter((o) => !isLockOp(o));
const named = (op: string) => opsNoLock().filter((o) => o[0] === op);
const stagingRootOf = (path: string) => STAGING.exec(path)?.[0] ?? null;

beforeEach(() => {
  ops.length = 0;
  existing.clear();
  control.failStandalone = true;
  control.holdStandalone = null;
  control.lockText = null;
  // The user picked an existing document folder holding a previous export.
  existing.add(DEST);
  existing.add(`${DEST}/index.html`);
  existing.add(`${DEST}/assets`);
});

describe("exportHtml — a failed export leaves the destination exactly as it was (#334)", () => {
  it("writes every file under a staging tree inside the destination, never into it directly", async () => {
    const result = await exportHtml("<p>test</p>", { outputPath: DEST });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Simulated write failure");

    const writes = named("write").map((o) => o[1]);
    expect(writes.length).toBeGreaterThan(0);
    for (const path of writes) expect(path).toMatch(STAGING);
    expect(named("rename")).toEqual([]);
  });

  it("removes the staging tree and nothing else — the previous export's files survive", async () => {
    await exportHtml("<p>test</p>", { outputPath: DEST });

    const root = stagingRootOf(named("write")[0][1]);
    expect(root).not.toBeNull();
    expect(named("remove-tree")).toEqual([["remove-tree", root]]);
    expect(named("remove")).toEqual([]);
    // Nothing the user had is touched: not the folder, not its index.html, not assets/.
    const removed = [...named("remove"), ...named("remove-tree")].map((o) => o[1]);
    expect(removed).not.toContain(DEST);
    expect(removed).not.toContain(`${DEST}/index.html`);
    expect(removed).not.toContain(`${DEST}/assets`);
  });

  it("removes a destination folder it created itself, after the staging tree, when nothing existed before", async () => {
    existing.clear();
    await exportHtml("<p>test</p>", { outputPath: "/users/me/Fresh" });

    const tail = opsNoLock().slice(-2);
    expect(tail[0][0]).toBe("remove-tree");
    expect(tail[1]).toEqual(["remove", "/users/me/Fresh"]);
  });
});

describe("exportHtml — a successful export is published by rename (#334)", () => {
  beforeEach(() => {
    control.failStandalone = false;
  });

  it("renames every staged file over its final path and then removes the staging tree", async () => {
    const result = await exportHtml("<p>test</p>", { outputPath: DEST });
    expect(result.success).toBe(true);

    const root = stagingRootOf(named("write")[0][1]);
    expect(named("rename")).toEqual([
      ["rename", `${root}/assets/vmark-reader.css`, `${DEST}/assets/vmark-reader.css`],
      ["rename", `${root}/assets/vmark-reader.js`, `${DEST}/assets/vmark-reader.js`],
      // index.html was already there (a previous export): it is moved ASIDE
      // into the staging tree before the new one takes its path, so a failure
      // later in the publish can put it back (#334).
      ["rename", `${DEST}/index.html`, `${root}/.replaced/index.html`],
      ["rename", `${root}/index.html`, `${DEST}/index.html`],
      ["rename", `${root}/standalone.html`, `${DEST}/standalone.html`],
    ]);
    expect(opsNoLock().at(-1)).toEqual(["remove-tree", root]);
    expect(named("remove")).toEqual([]);
    expect(result.indexPath).toBe(`${DEST}/index.html`);
    expect(result.standalonePath).toBe(`${DEST}/standalone.html`);
  });

  it("publishes only after the last file is staged", async () => {
    await exportHtml("<p>test</p>", { outputPath: DEST });
    const lastWrite = ops.findLastIndex((o) => o[0] === "write");
    const firstRename = ops.findIndex((o) => o[0] === "rename");
    expect(firstRename).toBeGreaterThan(lastWrite);
  });
});

describe("exportHtml — two exports to one destination never interleave (#332)", () => {
  it("the second export starts only after the first has published", async () => {
    control.failStandalone = false;
    let release!: () => void;
    control.holdStandalone = new Promise<void>((r) => {
      release = r;
    });

    const first = exportHtml("<p>one</p>", { outputPath: DEST });
    const second = exportHtml("<p>two</p>", { outputPath: DEST });
    // Let the first export reach its held standalone write.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const writesWhileHeld = named("write").length;
    expect(writesWhileHeld).toBeGreaterThan(0);
    expect(new Set(named("write").map((o) => stagingRootOf(o[1]))).size).toBe(1);

    release();
    await Promise.all([first, second]);

    const roots = named("write").map((o) => stagingRootOf(o[1]));
    expect(new Set(roots).size).toBe(2);
    // Every op of the first export — its publish and its cleanup included —
    // precedes the second export's first write.
    const firstRoot = roots[0]!;
    const rest = opsNoLock();
    const firstsLastOp = rest.findLastIndex((o) => o.some((p) => p.startsWith(firstRoot)));
    const secondsFirstOp = rest.findIndex((o) => o[0] === "write" && stagingRootOf(o[1]) !== firstRoot);
    expect(secondsFirstOp).toBeGreaterThan(firstsLastOp);
  });

  it("a failing first export does not stop the second, and removes only its own tree", async () => {
    control.failStandalone = true;
    const first = exportHtml("<p>one</p>", { outputPath: DEST });
    control.failStandalone = true;
    const second = exportHtml("<p>two</p>", { outputPath: DEST });
    const [a, b] = await Promise.all([first, second]);
    expect(a.success).toBe(false);
    expect(b.success).toBe(false);
    const roots = new Set(named("write").map((o) => stagingRootOf(o[1])));
    expect(roots.size).toBe(2);
    expect(named("remove-tree").map((o) => o[1]).sort()).toEqual([...roots].sort());
  });
});

// #332, round 3: `runExclusive` is per-webview, and VMark opens a window per
// document — so the destination itself holds the lock. Taken when the stage
// opens, released whichever way the export ends; an export that left it behind
// would make the folder un-exportable until the stale timeout.
describe("exportHtml — the destination lock (#332)", () => {
  it("takes the lock for the duration of a successful export", async () => {
    control.failStandalone = false;
    const result = await exportHtml("<p>test</p>", { outputPath: DEST });
    expect(result.success).toBe(true);
    expect(ops.filter(isLockOp)).toEqual([
      ["write", LOCK],
      ["remove", LOCK],
    ]);
    // Released only once the publish is done, never before it.
    expect(ops.findIndex((o) => o[0] === "remove" && o[1] === LOCK)).toBeGreaterThan(
      ops.findLastIndex((o) => o[0] === "rename"),
    );
  });

  it("releases the lock when the export fails", async () => {
    control.failStandalone = true;
    const result = await exportHtml("<p>test</p>", { outputPath: DEST });
    expect(result.success).toBe(false);
    expect(ops.filter(isLockOp)).toEqual([
      ["write", LOCK],
      ["remove", LOCK],
    ]);
  });
});
