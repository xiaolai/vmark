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
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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

describe("check-deleted-names.mjs — against the real tree", () => {
  it("holds: no registered deleted name has reappeared", () => {
    const res = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: "utf8" });
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  });
});
