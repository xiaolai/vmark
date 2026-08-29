/**
 * NUL-byte gate — the assertion left behind by the silent-grep failure.
 *
 * Eleven tracked files carried a raw NUL, which made every content-sniffing
 * tool treat them as binary and SKIP them without an error. The failure mode
 * under test is therefore silence, so each case asserts the exit code AND the
 * message; a gate that passes for the wrong reason looks identical to one that
 * works.
 *
 * Fixtures build their NUL with `String.fromCharCode(0)` rather than embedding
 * one. A raw NUL in this file would make the test file itself binary — and the
 * gate would flag its own test.
 */
import { describe, it, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-no-nul-bytes.mjs");
const NUL = String.fromCharCode(0);

/** A committed scratch repo — the gate reads `git ls-files`. */
function scratchRepo(files, { untracked = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "no-nul-bytes-"));
  const write = (rel, content) => {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  for (const [rel, content] of Object.entries(files)) write(rel, content);

  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-b", "main");
  git("config", "user.email", "gate@example.test");
  git("config", "user.name", "Gate Fixture");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-m", "base");

  for (const [rel, content] of Object.entries(untracked)) write(rel, content);
  return dir;
}

function runGate(dir) {
  const res = spawnSync(process.execPath, [SCRIPT, "--root", dir], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("check-no-nul-bytes", () => {
  it("passes a tree with no NUL bytes", () => {
    const dir = scratchRepo({ "src/a.ts": "export const a = 1;\n" });
    const { status, stdout } = runGate(dir);
    expect(status).toBe(0);
    expect(stdout).toContain("No raw NUL bytes");
  });

  it("fails on a raw NUL in a source file, naming file, line and column", () => {
    const dir = scratchRepo({
      "src/a.ts": `const ok = 1;\nconst key = \`x${NUL}y\`;\n`,
    });
    const { status, stderr } = runGate(dir);
    expect(status).toBe(1);
    expect(stderr).toContain("src/a.ts:2:15");
    expect(stderr).toContain("1 NUL");
  });

  it("names the escape as the remedy", () => {
    const dir = scratchRepo({ "src/a.ts": `const k = "${NUL}";\n` });
    const { stderr } = runGate(dir);
    expect(stderr).toContain("\\u0000");
  });

  it("reports the total count when a file has several", () => {
    const dir = scratchRepo({ "src/a.ts": `a${NUL}b${NUL}c${NUL}d\n` });
    const { status, stderr } = runGate(dir);
    expect(status).toBe(1);
    expect(stderr).toContain("3 NULs");
  });

  it("skips genuinely binary extensions", () => {
    const dir = scratchRepo({
      "assets/icon.png": `PNG${NUL}${NUL}payload`,
      "assets/app.ico": `ICO${NUL}payload`,
      "assets/app.icns": `ICNS${NUL}payload`,
    });
    expect(runGate(dir).status).toBe(0);
  });

  // The load-bearing default. Skipping unknown types is how a gate goes quiet.
  it("CHECKS an unknown extension rather than skipping it", () => {
    const dir = scratchRepo({ "data/thing.weirdext": `a${NUL}b\n` });
    const { status, stderr } = runGate(dir);
    expect(status).toBe(1);
    expect(stderr).toContain("data/thing.weirdext");
  });

  it("checks extensionless tracked files", () => {
    const dir = scratchRepo({ "Makefile": `all:${NUL}\n` });
    const { status, stderr } = runGate(dir);
    expect(status).toBe(1);
    expect(stderr).toContain("Makefile");
  });

  it("scans UNTRACKED (non-ignored) files too — a new file is exactly where a NUL arrives", () => {
    // The old contract ("ignores untracked files") was the blindness itself:
    // a bare `git ls-files` cannot see a file until it is committed, so a
    // defect in a new file passes every pre-commit run and fails only in CI
    // after the commit lands (hit live on the 0.9.55 release PR, via the
    // sibling theme-names gate that shared this scan).
    const dir = scratchRepo(
      { "src/a.ts": "export const a = 1;\n" },
      { untracked: { "scratch.ts": `x${NUL}y\n` } },
    );
    const { status, stderr } = runGate(dir);
    expect(status).toBe(1);
    expect(stderr).toContain("scratch.ts");
  });

  it("fails closed when the root is not a git repository", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "no-nul-bytes-bare-"));
    const { status, stderr } = runGate(dir);
    expect(status).toBe(64);
    expect(stderr).toContain("could not scan");
  });

  it("holds on the real repository", () => {
    const { status, stdout } = runGate(REPO);
    expect(status).toBe(0);
    expect(stdout).toContain("No raw NUL bytes");
  });
});
