/**
 * WI-AF4.2 — the change-size forcing function (F4).
 *
 * Runs the REAL `scripts/check-change-size.mjs` against scratch git repos in
 * tmpdir, with a fake `gh` on PATH supplying the PR body. No in-process mocks:
 * the script's whole job is reading a diff and a PR body.
 *
 * Semantics pinned:
 *   - under both thresholds → exit 0, no acknowledgement needed;
 *   - over EITHER threshold without the token → exit 1, naming the counts;
 *   - over threshold WITH the token in the PR body → exit 0;
 *   - excluded paths (lockfiles, generated, dev-docs) do not count, so a
 *     lockfile refresh cannot look like a rewrite;
 *   - the body is read through `gh api` at run time, NOT from the event
 *     payload: `pull_request` without `types:` does not fire on body edits, so
 *     a token added after a red check would otherwise never take effect;
 *   - FAILS CLOSED when the base ref, the PR number, or the body cannot be
 *     resolved. A size gate that skips when it cannot see the diff is worse
 *     than no gate: it reports green over an unmeasured change.
 *
 * @coordinates-with .claude/rules/60-ai-governance.md §13
 * @coordinates-with scripts/change-size-policy.json — the measured thresholds
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-change-size.mjs");
const POLICY = path.join(REPO, "scripts", "change-size-policy.json");

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/**
 * A scratch repo carrying the real script + policy, a `main` baseline and a
 * feature branch whose diff is described by `files`.
 *
 * The script `cd`s to its own root, so it is COPIED in (with its policy) rather
 * than invoked from this repo — same reasoning as check-wi-linkage.test.mjs,
 * except a copy is right here because the policy file travels with it and the
 * pair is what is under test.
 */
function scratchRepo({ files, prBody = "", ghMode = "ok" }) {
  const root = mkdtempSync(path.join(tmpdir(), "change-size-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  cpSync(SCRIPT, path.join(root, "scripts", "check-change-size.mjs"));
  cpSync(POLICY, path.join(root, "scripts", "change-size-policy.json"));

  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  writeFileSync(path.join(root, "seed.txt"), "seed\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "seed");
  git(root, "checkout", "-qb", "feature");

  for (const [rel, lines] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, Array.from({ length: lines }, (_, i) => `line ${i}`).join("\n") + "\n");
  }
  git(root, "add", "-A");
  git(root, "commit", "-qm", "the change");

  // A `gh` stub on PATH. The script must go through it for the body rather
  // than trusting an env payload, so its behaviour is part of the contract.
  const bin = path.join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const stub =
    ghMode === "missing"
      ? null
      : ghMode === "error"
        ? `#!/bin/bash\necho "api error" >&2\nexit 1\n`
        : `#!/bin/bash\ncat <<'BODY_EOF'\n${prBody}\nBODY_EOF\n`;
  if (stub) {
    const p = path.join(bin, "gh");
    writeFileSync(p, stub);
    chmodSync(p, 0o755);
  }
  return { root, bin };
}

function run({ root, bin }, args = ["main"], env = {}) {
  // PATH holds the stub dir, the system basics, and node — the script parses
  // its policy with node, exactly as it does in CI. Omitting it made every case
  // fail on "node: command not found", which is a harness defect masquerading
  // as eight assertion failures.
  const nodeDir = path.dirname(process.execPath);
  return spawnSync(process.execPath, [path.join(root, "scripts", "check-change-size.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${nodeDir}:/usr/bin:/bin`,
      GITHUB_PR_NUMBER: "123",
      ...env,
    },
  });
}

/** Files spread across N paths, `lines` each. */
function spread(n, lines = 5, prefix = "src/f") {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}.ts`, lines]));
}

describe("under the thresholds", () => {
  it("passes with no acknowledgement", () => {
    const r = run(scratchRepo({ files: spread(3) }));
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe("over a threshold", () => {
  it("fails on file count without the token, and says the number", () => {
    const r = run(scratchRepo({ files: spread(160, 1) }));
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/160/);
  });

  it("fails on line count without the token", () => {
    const r = run(scratchRepo({ files: spread(5, 3000) }));
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/1[0-9]{4}|line/i);
  });

  it("passes when the PR body carries the acknowledgement", () => {
    const r = run(
      scratchRepo({
        files: spread(160, 1),
        prBody: "This is a big mechanical migration.\n\nCHANGE-SIZE-ACK: one codemod, 160 files.",
      }),
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe("exclusions", () => {
  it("does not count lockfiles, generated output or dev-docs", () => {
    const files = {
      "pnpm-lock.yaml": 40000,
      "src/services/mcpBridge/v2/generated/bridgeContracts.ts": 20000,
      "dev-docs/notes.md": 20000,
      "src/real.ts": 5,
    };
    const r = run(scratchRepo({ files }));
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe("fails closed", () => {
  it("when the base ref cannot be resolved", () => {
    const repo = scratchRepo({ files: spread(3) });
    const r = run(repo, ["no-such-base"]);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/base/i);
  });

  it("when gh is missing and the change is over threshold", () => {
    const repo = scratchRepo({ files: spread(160, 1), ghMode: "missing" });
    const r = run(repo);
    expect(r.status).not.toBe(0);
  });

  it("when gh errors and the change is over threshold", () => {
    const repo = scratchRepo({ files: spread(160, 1), ghMode: "error" });
    const r = run(repo);
    expect(r.status).not.toBe(0);
  });

  it("when the PR number is absent and the change is over threshold", () => {
    const repo = scratchRepo({ files: spread(160, 1) });
    const r = run(repo, ["main"], { GITHUB_PR_NUMBER: "" });
    expect(r.status).not.toBe(0);
  });

  it("but an UNDER-threshold change needs no PR context at all", () => {
    // Nothing to acknowledge, so a missing gh/PR number is not an error —
    // failing here would make every small PR depend on API reachability.
    const repo = scratchRepo({ files: spread(3), ghMode: "missing" });
    const r = run(repo, ["main"], { GITHUB_PR_NUMBER: "" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe("the change this gate was written for", () => {
  it("trips on a 652-file shape and passes it once acknowledged", () => {
    const shape = spread(652, 60);
    expect(run(scratchRepo({ files: shape })).status).toBe(1);
    expect(
      run(scratchRepo({ files: shape, prBody: "CHANGE-SIZE-ACK: 21-WI architecture refactor" }))
        .status,
    ).toBe(0);
  });
});
