/**
 * The in-memory filesystem the export staging tests run against.
 *
 * Shared by `exportStaging.test.ts` and `exportPublishRollback.test.ts`: both
 * drive the same publish path, and a second copy of a mock this exact — a
 * `rename` that refuses an existing target the way Windows does, an `mkdir -p`
 * that leaves half a chain behind when it fails — is a mock that will drift
 * from the one the other file trusts.
 *
 * `createFsMock()` is called from each file's own `vi.mock` factory (a factory
 * cannot close over module state, but it CAN import it), so both files see the
 * same `files`/`dirs`/`ops`/`fail` this module exports.
 *
 * @module export/__tests__/exportFsHarness
 */
import { vi } from "vitest";

export type Op = [op: string, ...paths: string[]];
export const ops: Op[] = [];
/** A tiny in-memory tree: files with content, directories by name. */
export const files = new Map<string, string>();
export const dirs = new Set<string>();
/** `rename` INTO this path throws — a publish failing part-way. */
export const fail = {
  renameTo: null as string | null,
  removeOf: null as string | null,
  copyTo: null as string | null,
  /** `mkdir` of this path throws — a publish failing part-way up a chain. */
  mkdirOf: null as string | null,
  /** Every `rename` whose TARGET exists is refused — the Windows failure mode. */
  renameOntoExisting: false,
};

/** Is `p` inside `dir`? */
export const under = (dir: string, p: string) => p.startsWith(`${dir}/`);

/** Fresh tree, no recorded ops, nothing set to fail. */
export function resetFs(): void {
  ops.length = 0;
  files.clear();
  dirs.clear();
  dirs.add("/users/me");
  fail.renameTo = null;
  fail.removeOf = null;
  fail.copyTo = null;
  fail.mkdirOf = null;
  fail.renameOntoExisting = false;
}

/** The `@tauri-apps/plugin-fs` surface these tests exercise. */
export function createFsMock() {
  return {
  exists: vi.fn(async (path: string) => files.has(path) || dirs.has(path)),
  mkdir: vi.fn(async (path: string, options?: { recursive?: boolean }) => {
    ops.push(["mkdir", path]);
    if (options?.recursive === true) {
      // `mkdir -p`: every missing ANCESTOR is created too, and a failure part
      // way up leaves the levels already made standing — which is the whole
      // reason the publish records them one at a time (#676).
      const parts = path.split("/");
      for (let i = 2; i <= parts.length; i++) {
        const level = parts.slice(0, i).join("/");
        if (fail.mkdirOf === level) throw new Error(`EACCES: ${level}`);
        dirs.add(level);
      }
      return;
    }
    if (fail.mkdirOf === path) throw new Error(`EACCES: ${path}`);
    // The real `mkdir` refuses an existing directory unless asked to be
    // recursive — which is how a level created concurrently announces itself.
    if (dirs.has(path)) throw new Error(`EEXIST: ${path}`);
    dirs.add(path);
  }),
  writeTextFile: vi.fn(async (path: string, text: string, options?: { createNew?: boolean }) => {
    ops.push(["write", path]);
    const parent = path.slice(0, path.lastIndexOf("/"));
    if (!dirs.has(parent)) throw new Error(`ENOENT: ${parent}`);
    if (options?.createNew && files.has(path)) throw new Error(`EEXIST: ${path}`);
    files.set(path, text);
  }),
  readTextFile: vi.fn(async (path: string) => {
    const text = files.get(path);
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  }),
  rename: vi.fn(async (from: string, to: string) => {
    ops.push(["rename", from, to]);
    if (fail.renameTo === to) throw new Error(`EACCES: ${to}`);
    // Windows' MoveFileExW needs DELETE access to the file it replaces and is
    // refused while any other handle holds it (see atomic_replace.rs). This is
    // the shape of that refusal, and the POSIX path never sees it.
    if (fail.renameOntoExisting && files.has(to)) throw new Error(`EACCES: ${to} is in use`);
    const content = files.get(from);
    if (content === undefined) throw new Error(`ENOENT: ${from}`);
    files.delete(from);
    files.set(to, content);
  }),
  copyFile: vi.fn(async (from: string, to: string) => {
    ops.push(["copy", from, to]);
    if (fail.copyTo === to) throw new Error(`EACCES: ${to}`);
    const content = files.get(from);
    if (content === undefined) throw new Error(`ENOENT: ${from}`);
    files.set(to, content);
  }),
  lstat: vi.fn(async (path: string) => {
    if (files.has(path)) return { isFile: true, isDirectory: false, isSymlink: false };
    if (dirs.has(path)) return { isFile: false, isDirectory: true, isSymlink: false };
    throw new Error(`ENOENT: ${path}`);
  }),
  remove: vi.fn(async (path: string, options?: { recursive?: boolean }) => {
    ops.push([options?.recursive ? "remove-tree" : "remove", path]);
    if (fail.removeOf === path) throw new Error(`EACCES: ${path}`);
    if (files.has(path)) {
      files.delete(path);
      return;
    }
    if (!dirs.has(path)) throw new Error(`ENOENT: ${path}`);
    const contents = [...files.keys(), ...dirs].filter((p) => under(path, p));
    if (contents.length > 0 && !options?.recursive) throw new Error(`ENOTEMPTY: ${path}`);
    for (const p of contents) {
      files.delete(p);
      dirs.delete(p);
    }
    dirs.delete(path);
  }),
};
}
