/**
 * Executable coverage for `.githooks/pre-push` — the release gate itself.
 *
 * The hook was rewritten (WI-7) from "re-run the whole suite locally" to
 * "ask CI what it recorded for this exact commit", and nothing committed
 * executed it. A hook is a shell program with branches: tag vs branch vs
 * deletion, annotated vs lightweight tag, online vs offline. An untested
 * one fails open silently — the failure mode this whole gate exists to end.
 *
 * House pattern (scripts/check-tag-green.test.mjs, check-baseline-ratchet.test.mjs):
 * run the REAL hook as a subprocess inside a scratch git repository, with the
 * gate commands it shells out to replaced by logging stubs — on PATH for
 * `gh`/`cargo`/`pnpm`, and in the scratch repo's own `scripts/` for the two
 * repo-relative bash scripts. Every stub records its invocation to a log file,
 * so the assertions are about WHAT RAN AND IN WHICH ORDER, not merely the exit
 * code (a hook that crashed on line 1 also exits non-zero).
 *
 * Covered branches:
 *   - feature-branch push            → silent allow, no gate command runs
 *   - `v*` tag, CI green             → check-tag-green called with the COMMIT
 *                                      sha (annotated tags name a tag object)
 *   - `v*` tag, CI red               → blocked, exit 1, actionable message
 *   - tag/branch deletion            → silent allow, nothing verified
 *   - VMARK_OFFLINE_GATE=1           → the four legacy gates, in order
 *   - `main` push                    → informational only, no CI query
 */
import { describe, it, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(REPO, ".githooks", "pre-push");
const Z40 = "0".repeat(40);

/** Stub body: append a fixed label plus argv to $GATE_LOG, then exit. */
function stub(label, { exitVar = "", args = '"$*"' } = {}) {
  return [
    "#!/bin/bash",
    `printf '%s %s\\n' ${JSON.stringify(label)} ${args} >> "$GATE_LOG"`,
    exitVar ? `exit "\${${exitVar}:-0}"` : "exit 0",
    "",
  ].join("\n");
}

/**
 * A scratch git repo with one commit, a lightweight tag and an annotated tag,
 * plus stub implementations of every command the hook shells out to.
 */
function scratchRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "pre-push-hook-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "gate@example.test");
  git("config", "user.name", "Gate Fixture");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(dir, "README.md"), "scratch\n");
  git("add", "-A");
  git("commit", "-m", "base");

  const commit = git("rev-parse", "HEAD");
  git("tag", "v9.9.9-light");
  git("tag", "-a", "v9.9.9", "-m", "annotated release");
  const annotated = git("rev-parse", "v9.9.9"); // the TAG OBJECT, not the commit
  expect(annotated).not.toBe(commit); // guard: the fixture must exercise the resolve

  // Repo-relative bash scripts the hook invokes by path.
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  writeFileSync(
    path.join(dir, "scripts", "check-tag-green.sh"),
    stub("check-tag-green", { exitVar: "TAG_GREEN_EXIT", args: '"$1"' }),
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(dir, "scripts", "check-cross-target.sh"),
    stub("check-cross-target", { args: '""' }),
    { mode: 0o755 },
  );

  // PATH stubs. `cargo` logs only its subcommand so the assertion reads as the
  // gate sequence rather than as a flag soup.
  const bin = path.join(dir, "stubbin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "cargo"), stub("cargo", { args: '"$1"' }), { mode: 0o755 });
  writeFileSync(path.join(bin, "pnpm"), stub("pnpm"), { mode: 0o755 });
  writeFileSync(path.join(bin, "gh"), stub("gh"), { mode: 0o755 });

  return { dir, bin, commit, annotated, log: path.join(dir, "gate.log") };
}

/** Drive the real hook with `stdin` lines; returns exit code, output and log. */
function runHook(repo, stdin, env = {}) {
  const res = spawnSync("/bin/bash", [HOOK], {
    cwd: repo.dir,
    input: stdin,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${repo.bin}${path.delimiter}${process.env.PATH}`,
      GATE_LOG: repo.log,
      ...env,
    },
  });
  const log = existsSync(repo.log) ? readFileSync(repo.log, "utf8").trim() : "";
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    calls: log === "" ? [] : log.split("\n").map((l) => l.trim()),
  };
}

const pushLine = (ref, sha) => `${ref} ${sha} ${ref} ${Z40}\n`;

describe(".githooks/pre-push — branch legs", () => {
  it("allows a feature-branch push silently, running no gate command", () => {
    const repo = scratchRepo();
    const r = runHook(repo, pushLine("refs/heads/feat/thing", repo.commit));
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
  });

  it("lets a `main` push through with an informational note and no CI query", () => {
    // Branch protection on the remote is authoritative for main (rule 60 §10);
    // a local re-check would duplicate it and block the legitimate fresh-merge
    // case. What must NOT happen is a silent claim of verification.
    const repo = scratchRepo();
    const r = runHook(repo, pushLine("refs/heads/main", repo.commit));
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toContain("branch protection");
  });

  it("allows a deletion without verifying anything", () => {
    const repo = scratchRepo();
    const r = runHook(repo, `(delete) ${Z40} refs/tags/v9.9.9 ${repo.commit}\n`);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
  });
});

describe(".githooks/pre-push — tag leg queries CI for the tagged commit", () => {
  it("verifies a lightweight tag against the commit it names", () => {
    const repo = scratchRepo();
    const r = runHook(repo, pushLine("refs/tags/v9.9.9-light", repo.commit));
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([`check-tag-green ${repo.commit}`]);
  });

  it("resolves an ANNOTATED tag to its commit before verifying", () => {
    // local_sha is the tag OBJECT sha here; verifying that would query a sha CI
    // has never seen, and check-runs would come back empty for it.
    const repo = scratchRepo();
    const r = runHook(repo, pushLine("refs/tags/v9.9.9", repo.annotated));
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([`check-tag-green ${repo.commit}`]);
    expect(r.calls[0]).not.toContain(repo.annotated);
  });

  it("blocks the push when CI's verdict on the tagged commit is red", () => {
    const repo = scratchRepo();
    const r = runHook(repo, pushLine("refs/tags/v9.9.9", repo.annotated), { TAG_GREEN_EXIT: "1" });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([`check-tag-green ${repo.commit}`]);
    expect(r.stderr).toContain("not verified green");
    expect(r.stderr).toContain("VMARK_OFFLINE_GATE=1");
  });

  it("verifies every pushed tag, not just the first", () => {
    const repo = scratchRepo();
    const r = runHook(
      repo,
      pushLine("refs/tags/v9.9.9-light", repo.commit) + pushLine("refs/tags/v9.9.9", repo.annotated),
    );
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([`check-tag-green ${repo.commit}`, `check-tag-green ${repo.commit}`]);
  });

  it("ignores non-release tags", () => {
    const repo = scratchRepo();
    const r = runHook(repo, pushLine("refs/tags/nightly-2026-08-03", repo.commit));
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
  });
});

describe(".githooks/pre-push — VMARK_OFFLINE_GATE=1 runs the legacy local gate", () => {
  const EXPECTED = ["check-cross-target", "cargo fmt", "cargo clippy", "pnpm check:all"];

  it("runs cross-target, fmt, clippy and check:all IN ORDER for a tag push", () => {
    const repo = scratchRepo();
    const r = runHook(repo, pushLine("refs/tags/v9.9.9", repo.annotated), {
      VMARK_OFFLINE_GATE: "1",
    });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(EXPECTED);
    // The offline gate REPLACES the CI query — it must not also hit the network.
    expect(r.calls.join("\n")).not.toContain("check-tag-green");
    expect(r.calls.join("\n")).not.toContain("gh ");
  });

  it("runs the same legacy gate for a main push", () => {
    const repo = scratchRepo();
    const r = runHook(repo, pushLine("refs/heads/main", repo.commit), { VMARK_OFFLINE_GATE: "1" });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(EXPECTED);
  });

  it("blocks on the first failing leg and does not run the later ones", () => {
    // Ordering is load-bearing: cross-target fails in seconds, check:all takes
    // minutes. A gate that ran them in the other order would waste both.
    const repo = scratchRepo();
    writeFileSync(
      path.join(repo.dir, "scripts", "check-cross-target.sh"),
      stub("check-cross-target", { args: '""', exitVar: "CROSS_EXIT" }),
      { mode: 0o755 },
    );
    const r = runHook(repo, pushLine("refs/tags/v9.9.9", repo.annotated), {
      VMARK_OFFLINE_GATE: "1",
      CROSS_EXIT: "1",
    });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual(["check-cross-target"]);
    expect(r.stderr).toContain("cross-target compile check failed");
  });
});
