/**
 * WI-AL2.2a — the receipt fixtures' change gate: every commit that touches
 * `src-tauri/src/agent_journal/fixtures/` must cite a plan rule (`R64`, …) in
 * its message, because those bytes are the persisted receipt contract both
 * the Rust writer and the TypeScript client are pinned to.
 *
 * Runs the REAL `scripts/check-receipt-fixtures.mjs` as a subprocess against
 * scratch git repositories in tmpdir, then once against this repository's own
 * history, which is the assertion the gate exists for.
 *
 * Semantics pinned:
 *   - a fixture commit citing no R-rule fails, and the failure names it;
 *   - a fixture commit citing one passes; a commit that only mentions a rule
 *     inside a longer token (`PR64`, `R64a`) cites nothing;
 *   - commits that do not touch the fixtures are never inspected;
 *   - a shallow clone fails closed: it cannot see the history it must judge.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-receipt-fixtures.mjs");
const FIXTURE = "src-tauri/src/agent_journal/fixtures/receipts.json";

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), "receipt-fixtures-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "gate@example.invalid");
  git(root, "config", "user.name", "gate");
  git(root, "config", "commit.gpgsign", "false");
  return root;
}

function commit(root, rel, body, message) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  git(root, "add", "--", rel);
  git(root, "commit", "-q", "-m", message);
}

function run(cwd) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });
}

describe("check-receipt-fixtures", () => {
  it("fails a fixture edit whose commit cites no R-rule, naming the commit", () => {
    const root = scratch();
    commit(root, FIXTURE, "{}\n", "test: add the receipt fixtures (R64)");
    commit(root, FIXTURE, '{"a":1}\n', "test: tweak the receipt fixtures");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("tweak the receipt fixtures");
    expect(r.stderr).not.toContain("add the receipt fixtures");
  });

  it("passes when every fixture commit cites an R-rule", () => {
    const root = scratch();
    commit(root, FIXTURE, "{}\n", "test: add the receipt fixtures (R64)");
    commit(root, FIXTURE, '{"a":1}\n', "fix: re-pin the digest\n\nPer R103, the restore receipt carries its source.");
    const r = run(root);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("does not count a rule id embedded in a longer token", () => {
    for (const message of ["test: tweak fixtures for PR64", "test: tweak fixtures per R64a"]) {
      const root = scratch();
      commit(root, FIXTURE, "{}\n", message);
      expect(run(root).status).toBe(1);
    }
  });

  it("ignores commits that do not touch the fixtures", () => {
    const root = scratch();
    commit(root, FIXTURE, "{}\n", "test: add the receipt fixtures (R64)");
    commit(root, "src/other.ts", "export {};\n", "chore: unrelated change");
    expect(run(root).status).toBe(0);
  });

  it("fails closed in a shallow clone", () => {
    const origin = scratch();
    commit(origin, FIXTURE, "{}\n", "test: add the receipt fixtures (R64)");
    commit(origin, "src/other.ts", "export {};\n", "chore: unrelated change");
    const clone = mkdtempSync(path.join(tmpdir(), "receipt-fixtures-shallow-"));
    git(clone, "clone", "-q", "--depth", "1", `file://${origin}`, ".");
    const r = run(clone);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/shallow/i);
  });

  it("holds on this repository's history", () => {
    const r = run(REPO);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
