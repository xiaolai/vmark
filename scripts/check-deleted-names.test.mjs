/**
 * Deleted-name gate — the tombstone registry behind ADR-009's failure mode.
 *
 * The symbol tripwire matched exactly
 * `export (function|const|class|type|interface) Name`, which is one of the
 * many ways a deleted symbol comes back. Every case below is a re-introduction
 * that used to pass the gate silently. Tests run the REAL script as a
 * subprocess against scratch git repositories (git grep needs a real index),
 * asserting on the MESSAGE as well as the exit code.
 */
import { describe, it, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-deleted-names.mjs");

/** A committed scratch repo — `git grep` only sees tracked content. */
function scratchRepo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "deleted-names-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-b", "main");
  git("config", "user.email", "gate@example.test");
  git("config", "user.name", "Gate Fixture");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-m", "base");
  return dir;
}

function runGate(dir, registry) {
  const registryPath = path.join(dir, "registry.json");
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  const res = spawnSync(process.execPath, [SCRIPT, "--root", dir, "--registry", registryPath], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const TOMBSTONE = [
  {
    kind: "symbol",
    name: "usePopupStore",
    glob: "src/stores",
    deletedBy: "a decision",
    reason: "it must stay gone",
  },
];

describe("check-deleted-names.mjs — symbol tombstones", () => {
  it.each([
    ["export const", "export const usePopupStore = () => ({});\n"],
    ["export function", "export function usePopupStore() { return {}; }\n"],
    ["export async function", "export async function usePopupStore() { return {}; }\n"],
    ["export function*", "export function* usePopupStore() { yield 1; }\n"],
    ["export let", "export let usePopupStore = 1;\n"],
    ["export var", "export var usePopupStore = 1;\n"],
    ["export class", "export class usePopupStore {}\n"],
    ["export abstract class", "export abstract class usePopupStore {}\n"],
    ["export enum", "export enum usePopupStore { A }\n"],
    ["export type", "export type usePopupStore = number;\n"],
    ["export interface", "export interface usePopupStore { a: 1 }\n"],
    ["export declare const", "export declare const usePopupStore: number;\n"],
    ["export default function", "export default function usePopupStore() { return 1; }\n"],
    ["export default <binding>", "const x = 1;\nexport default usePopupStore;\n"],
    ["a plain re-export", 'export { usePopupStore } from "./impl";\n'],
    ["an aliased re-export", 'export { theStore as usePopupStore } from "./impl";\n'],
    ["a re-export in a list", 'export { other, usePopupStore, more } from "./impl";\n'],
    ["a local re-export", "const usePopupStore = 1;\nexport { usePopupStore };\n"],
    ["a namespace re-export", 'export * as usePopupStore from "./impl";\n'],
    // audit R2 #32 — standard forms the export grammar did not list.
    ["export const enum", "export const enum usePopupStore { A }\n"],
    ["export namespace", "export namespace usePopupStore { export const a = 1; }\n"],
    ["export module", "export module usePopupStore { export const a = 1; }\n"],
    ["export import (alias)", "export import usePopupStore = Other.Thing;\n"],
    ["a type-only re-export", 'export type { usePopupStore } from "./impl";\n'],
    ["a type-only aliased re-export", 'export type { Store as usePopupStore } from "./impl";\n'],
    ["a type-only namespace re-export", 'export type * as usePopupStore from "./impl";\n'],
    // audit R2 #30 — prettier wraps any clause past the print width, so this
    // is the ordinary shape of a barrel file, and git grep cannot see it.
    ["a WRAPPED re-export clause", 'export {\n  other,\n  usePopupStore,\n} from "./impl";\n'],
    ["a wrapped clause with an alias", 'export {\n  theStore as usePopupStore,\n} from "./impl";\n'],
    ["a wrapped type-only clause", 'export type {\n  usePopupStore,\n} from "./impl";\n'],
  ])("catches a deleted symbol reintroduced as %s", (_label, source) => {
    const dir = scratchRepo({ "src/stores/newName.ts": source });
    const { status, stderr } = runGate(dir, TOMBSTONE);
    expect(status, stderr).toBe(1);
    expect(stderr).toContain("usePopupStore");
    expect(stderr).toContain("src/stores/newName.ts");
    expect(stderr).toContain("it must stay gone");
  });

  it.each([
    ["a longer name that merely starts with it", "export const usePopupStoreLegacy = 1;\n"],
    ["a longer name that merely ends with it", "export const myUsePopupStore = 1;\n"],
    ["an IMPORT of the name", 'import { usePopupStore } from "./elsewhere";\nexport const x = 1;\n'],
    ["a non-exported local", "const usePopupStore = 1;\nexport const y = usePopupStore;\n"],
    // The wrapped-clause probe finds lone-identifier lines; stage 2 reads the
    // file, so an import clause and an array element must not confirm.
    ["a WRAPPED import clause", 'import {\n  usePopupStore,\n} from "./elsewhere";\nexport const x = 1;\n'],
    ["a lone identifier in an array", "const a = [\n  usePopupStore,\n];\nexport const x = a;\n"],
  ])("does not fire on %s", (_label, source) => {
    const dir = scratchRepo({ "src/stores/newName.ts": source });
    const { status, stdout } = runGate(dir, TOMBSTONE);
    expect(status).toBe(0);
    expect(stdout).toContain("✅");
  });

  it("honours the glob — the same symbol outside the scoped directory is not a hit", () => {
    const dir = scratchRepo({ "src/hooks/other.ts": "export function usePopupStore() {}\n" });
    expect(runGate(dir, TOMBSTONE).status).toBe(0);
  });

  it("still catches a deleted PATH that came back", () => {
    const dir = scratchRepo({ "src/stores/popupStore.ts": "export const a = 1;\n" });
    const { status, stderr } = runGate(dir, [
      {
        kind: "path",
        path: "src/stores/popupStore.ts",
        deletedBy: "a decision",
        reason: "the mega-store facade is gone",
      },
    ]);
    expect(status).toBe(1);
    expect(stderr).toContain("src/stores/popupStore.ts");
  });
});

// WI-FL3.2 / WI-FL3.6 delete Rust items (`list_directory_entries`,
// `window_manager::request_quit`, the slidev arg builder). The gate's grammar
// was TypeScript-only, so registering those names would have been a tombstone
// nothing could trip over — green with no coverage, the exact failure mode the
// gate exists to remove. Rust item forms are first-class now.
const RUST_TOMBSTONE = [
  {
    kind: "symbol",
    name: "request_quit",
    glob: "src-tauri/src/window_manager",
    deletedBy: "a decision",
    reason: "the unwired command must stay gone",
  },
];

describe("check-deleted-names.mjs — Rust tombstones", () => {
  it.each([
    ["pub fn", "pub fn request_quit(app: AppHandle) {}\n"],
    ["pub async fn", "pub async fn request_quit(app: AppHandle) {}\n"],
    ["pub(crate) fn", "pub(crate) fn request_quit() {}\n"],
    ["a private fn", "fn request_quit() {}\n"],
    ["a #[tauri::command] fn", "#[tauri::command]\npub fn request_quit(app: AppHandle) {}\n"],
    ["a generic fn", "pub fn request_quit<R: Runtime>(app: AppHandle<R>) {}\n"],
    ["pub struct", "pub struct request_quit;\n"],
    ["pub enum", "pub enum request_quit { A }\n"],
    ["pub const", "pub const request_quit: u8 = 1;\n"],
    ["pub type", "pub type request_quit = u8;\n"],
    ["a module", "pub mod request_quit;\n"],
    ["pub(super) fn", "pub(super) fn request_quit() {}\n"],
    ["pub(in path) fn", "pub(in crate::window_manager) fn request_quit() {}\n"],
    ["pub const fn", "pub const fn request_quit() -> u8 { 1 }\n"],
    ["pub(crate) const fn", "pub(crate) const fn request_quit() -> u8 { 1 }\n"],
    ["pub unsafe fn", "pub unsafe fn request_quit() {}\n"],
    ["pub async unsafe fn", "pub async unsafe fn request_quit() {}\n"],
    ["extern \"C\" fn", 'extern "C" fn request_quit() {}\n'],
    ["pub unsafe extern \"C\" fn", 'pub unsafe extern "C" fn request_quit() {}\n'],
    ["pub static", "pub static request_quit: u8 = 1;\n"],
    ["a trait", "pub trait request_quit {}\n"],
    ["a union", "pub union request_quit { a: u8 }\n"],
    // Audit 20260907 #15: legal token spacing and raw identifiers are the same
    // items spelled differently; a grammar that only knew the compact forms
    // let each of these back in unnoticed.
    ["pub ( crate ) fn — spaced visibility", "pub ( crate ) fn request_quit() {}\n"],
    ["pub(in  crate::window_manager ) fn — spaced path", "pub(in  crate::window_manager ) fn request_quit() {}\n"],
    ["pub(crate)  const  fn — multiple spaces between qualifiers", "pub(crate)  const  fn request_quit() -> u8 { 1 }\n"],
    ["fn r#name — a raw identifier", "fn r#request_quit() {}\n"],
    ["pub struct r#name", "pub struct r#request_quit;\n"],
    ["an indented item (inside an impl or a mod block)", "mod inner {\n    pub fn request_quit() {}\n}\n"],
  ])("catches a deleted Rust item reintroduced as %s", (_label, source) => {
    const dir = scratchRepo({ "src-tauri/src/window_manager/commands.rs": source });
    const { status, stderr } = runGate(dir, RUST_TOMBSTONE);
    expect(status, stderr).toBe(1);
    expect(stderr).toContain("request_quit");
    expect(stderr).toContain("src-tauri/src/window_manager/commands.rs");
    expect(stderr).toContain("the unwired command must stay gone");
  });

  it.each([
    ["a CALL of the name", "pub fn on_quit(app: &AppHandle) {\n    crate::quit::request_quit(app);\n}\n"],
    ["a longer name", "pub fn request_quit_now() {}\n"],
    ["a name that merely ends with it", "pub fn force_request_quit() {}\n"],
    ["a use of the name", "use crate::quit::request_quit;\npub fn x() {}\n"],
    ["a raw identifier that merely starts with it", "fn r#request_quit_later() {}\n"],
  ])("does not fire on %s", (_label, source) => {
    const dir = scratchRepo({ "src-tauri/src/window_manager/commands.rs": source });
    const { status, stdout } = runGate(dir, RUST_TOMBSTONE);
    expect(status).toBe(0);
    expect(stdout).toContain("✅");
  });

  it("honours the glob for Rust too — quit::request_quit outside the scope stays legal", () => {
    const dir = scratchRepo({ "src-tauri/src/quit.rs": "pub fn request_quit(app: &AppHandle) {}\n" });
    expect(runGate(dir, RUST_TOMBSTONE).status).toBe(0);
  });
});

// Audit 20260907 #14: `$` is legal in a TypeScript identifier and is ERE's
// end-of-line anchor. Interpolated raw, `use$Store(…)` could never match, so a
// tombstone carrying such a name was green with no coverage — the fail-open
// mode this gate exists to remove.
describe("check-deleted-names.mjs — a `$` in a registered name", () => {
  const DOLLAR = [{ ...TOMBSTONE[0], name: "use$Store" }];

  it("catches the name when it comes back — the `$` is a literal, not end-of-line", () => {
    const dir = scratchRepo({ "src/stores/newName.ts": "export const use$Store = 1;\n" });
    const { status, stderr } = runGate(dir, DOLLAR);
    expect(status, stderr).toBe(1);
    expect(stderr).toContain("use$Store");
  });

  it("does not fire on a name that differs only at the `$`", () => {
    const dir = scratchRepo({ "src/stores/newName.ts": "export const useXStore = 1;\n" });
    expect(runGate(dir, DOLLAR).status).toBe(0);
  });
});

// audit R3 #38 — the failure guidance told maintainers to remove the entry from
// `scripts/check-deleted-names.mjs`, where the registry has not lived since it
// moved to `scripts/lib/deletedNamesRegistry.mjs`. A remedy that names the wrong
// file is a remedy nobody can follow, and the header already named the right one.
describe("check-deleted-names.mjs — the failure guidance names the real registry", () => {
  it("points at scripts/lib/deletedNamesRegistry.mjs, and the file it names exists", () => {
    const dir = scratchRepo({ "src/stores/newName.ts": "export const usePopupStore = 1;\n" });
    const { status, stderr } = runGate(dir, TOMBSTONE);
    expect(status).toBe(1);
    expect(stderr).toContain("scripts/lib/deletedNamesRegistry.mjs");
    expect(stderr).not.toContain("remove the entry from scripts/check-deleted-names.mjs");
    expect(existsSync(path.join(REPO, "scripts", "lib", "deletedNamesRegistry.mjs"))).toBe(true);
  });
});

// Audit 20260907 #18: `--root`/`--registry` consumed the next argument without
// checking one existed, so a bare flag died in `resolve(undefined)` with a
// stack trace instead of a usage exit. Misuse is 64 — the code every sibling
// gate uses — so a caller can tell it from a finding (1) or a gate that could
// not run (2).
describe("check-deleted-names.mjs — bad arguments", () => {
  it.each(["--root", "--registry"])("refuses %s without a value with the usage code 64, not a stack trace", (flag) => {
    const res = spawnSync(process.execPath, [SCRIPT, flag], { encoding: "utf8" });
    expect(res.status).toBe(64);
    expect(res.stderr).toContain(`${flag} requires a value`);
    expect(res.stderr).not.toContain("TypeError");
  });

  it("refuses an unknown argument with 64, and an unreadable registry file with 2", () => {
    expect(spawnSync(process.execPath, [SCRIPT, "--bogus"], { encoding: "utf8" }).status).toBe(64);
    const dir = mkdtempSync(path.join(tmpdir(), "deleted-names-badreg-"));
    const bad = path.join(dir, "registry.json");
    writeFileSync(bad, "{ not json");
    const res = spawnSync(process.execPath, [SCRIPT, "--registry", bad], { encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("cannot read registry");
    expect(res.stderr).not.toContain("SyntaxError:\n");
  });
});

describe("check-deleted-names.mjs — fails closed when it cannot check", () => {
  it("exits 2 on a registry entry of unknown kind instead of skipping it", () => {
    const dir = scratchRepo({ "src/stores/newName.ts": "export const usePopupStore = 1;\n" });
    const { status, stderr } = runGate(dir, [{ ...TOMBSTONE[0], kind: "symbols" }]);
    expect(status).toBe(2);
    expect(stderr).toContain('unknown kind "symbols"');
  });

  it("exits 2 on a symbol entry with no glob instead of grepping nothing", () => {
    const dir = scratchRepo({ "src/stores/newName.ts": "export const usePopupStore = 1;\n" });
    const { glob: _glob, ...noGlob } = TOMBSTONE[0];
    const { status, stderr } = runGate(dir, [noGlob]);
    expect(status).toBe(2);
    expect(stderr).toContain('missing string field "glob"');
  });

  it("exits 2 when git grep cannot run (not a repository) instead of reporting a clean tree", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "deleted-names-nogit-"));
    mkdirSync(path.join(dir, "src", "stores"), { recursive: true });
    writeFileSync(path.join(dir, "src", "stores", "newName.ts"), "export const usePopupStore = 1;\n");
    const { status, stderr, stdout } = runGate(dir, TOMBSTONE);
    expect(status).toBe(2);
    expect(stderr).toContain("git grep failed");
    expect(stdout).not.toContain("✅");
  });
});

describe("check-deleted-names.mjs — the working tree, not just the index", () => {
  // audit R2 #34 — `git grep` searches TRACKED content, so a symbol
  // reintroduced in a new file was invisible until it was staged: the gate
  // fired on a later run, or never.
  it("sees a deleted symbol reintroduced in an untracked file", () => {
    const dir = scratchRepo({ "src/stores/other.ts": "export const keep = 1;\n" });
    writeFileSync(path.join(dir, "src/stores/popupStore.ts"), "export const usePopupStore = () => ({});\n");
    const res = runGate(dir, TOMBSTONE);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("src/stores/popupStore.ts");
  });

  it("still ignores an IGNORED file — .gitignore is the boundary, not the index", () => {
    const dir = scratchRepo({ ".gitignore": "generated/\n", "src/stores/other.ts": "export const keep = 1;\n" });
    mkdirSync(path.join(dir, "generated", "src", "stores"), { recursive: true });
    writeFileSync(path.join(dir, "generated/src/stores/popupStore.ts"), "export const usePopupStore = () => ({});\n");
    expect(runGate(dir, [{ ...TOMBSTONE[0], glob: "generated/src/stores" }]).status).toBe(0);
  });

  // audit R2 #36 — `existsSync` FOLLOWS a symlink, so a broken one standing
  // where the deleted file was reported the path as still gone.
  it("sees a tombstoned path that came back as a broken symlink", () => {
    const dir = scratchRepo({ "src/keep.ts": "export const keep = 1;\n" });
    const entry = { kind: "path", path: "src/gone.ts", deletedBy: "a decision", reason: "it must stay gone" };
    expect(runGate(dir, [entry]).status).toBe(0);
    symlinkSync("nowhere.ts", path.join(dir, "src/gone.ts"));
    const res = runGate(dir, [entry]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("src/gone.ts was deleted by a decision but exists again");
  });
});

describe("check-deleted-names.mjs — against the real tree", () => {
  it("holds: no registered deleted name has reappeared", () => {
    const res = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: "utf8" });
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  });
});
