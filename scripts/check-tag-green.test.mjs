/**
 * WI-7 — Pre-push tag leg: `gh api` check-runs verification (D5).
 *
 * Runs the REAL `scripts/check-tag-green.sh` as a subprocess against a fake
 * `gh` executable prepended to PATH (house pattern: real script, tmpdir, no
 * in-process mocks). The stub validates argv EXACTLY — two arguments, `api`
 * and the api path for the SHA under test — and exits 99 on anything else.
 * The previous stub only checked that the expected path appeared SOMEWHERE in
 * argv, so `gh api --paginate <path> --jq …` (or any extra flag) would have
 * been accepted silently; a gate whose stub is loose proves the gate loosely.
 *
 * Semantics pinned here (the tag-push gate contract):
 *   - only `frontend` and `rust` gate; other red checks are ignored;
 *   - a check-run counts only when it was produced by the `github-actions`
 *     GitHub App — a NAME is not an identity, and any App with checks:write
 *     on the repo can publish a run called `frontend`;
 *   - duplicate runs per check name → the highest check-run `id` wins
 *     (monotonic and always present; `started_at` can be absent, and a
 *     missing timestamp used to sort as epoch 0);
 *   - a check-run without a numeric id → fail closed (no ordering is possible);
 *   - pending/in_progress → distinct "not finished" refusal;
 *   - check absent → distinct "missing" refusal;
 *   - gh missing / network error / malformed JSON → fail closed, pointing at
 *     VMARK_OFFLINE_GATE=1 — NEVER a silent pass.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-tag-green.sh");

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

// The stub's shebang is absolute (/bin/bash) because the tests run it under a
// PATH that contains ONLY node + the stub — `/usr/bin/env bash` would fail.
// It uses only bash builtins (read/printf) for the same reason.
const GH_STUB = `#!/bin/bash
# argv-validating gh stub — unexpected invocation exits 99 (test then fails
# on the missing per-case message, never on a lucky exit code).
#
# EXACT argv, not "contains": exactly two arguments, \`api\` then the api path.
# A stub that scanned argv for the path would accept extra flags (--paginate,
# --jq, a second --hostname) and prove nothing about what the gate really runs.
set -u
expected="repos/xiaolai/vmark/commits/\${EXPECTED_SHA}/check-runs?per_page=100"
if [ "$#" -ne 2 ] || [ "\${1}" != "api" ] || [ "\${2}" != "$expected" ]; then
  echo "unexpected gh argv (\$# args): $*" >&2
  exit 99
fi
if [ -n "\${GH_STUB_STDERR:-}" ]; then
  echo "\${GH_STUB_STDERR}" >&2
fi
if [ "\${GH_STUB_EXIT:-0}" != "0" ]; then
  exit "\${GH_STUB_EXIT}"
fi
if [ -z "\${GH_STUB_FIXTURE:-}" ]; then
  echo "gh stub: no fixture configured" >&2
  exit 99
fi
while IFS= read -r line || [ -n "$line" ]; do
  printf '%s\\n' "$line"
done < "\${GH_STUB_FIXTURE}"
`;

/** Build a bin dir holding exactly: a node symlink (+ the gh stub unless withGh=false). */
function makeBin({ withGh = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "check-tag-green-"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, path.join(bin, "node"));
  if (withGh) {
    writeFileSync(path.join(bin, "gh"), GH_STUB, { mode: 0o755 });
  }
  return { dir, bin };
}

/**
 * Run the real script with a minimal, fully-controlled env. `fixture` may be
 * an object (serialized) or a raw string (malformed-JSON case).
 */
function runScript({ fixture, ghExit = "0", ghStderr = "", withGh = true, args } = {}) {
  const { dir, bin } = makeBin({ withGh });
  const env = { PATH: bin, EXPECTED_SHA: SHA, GH_STUB_EXIT: ghExit };
  if (ghStderr) env.GH_STUB_STDERR = ghStderr;
  if (fixture !== undefined) {
    const fixturePath = path.join(dir, "fixture.json");
    writeFileSync(
      fixturePath,
      typeof fixture === "string" ? fixture : JSON.stringify(fixture, null, 2),
    );
    env.GH_STUB_FIXTURE = fixturePath;
  }
  const res = spawnSync("/bin/bash", [SCRIPT, ...(args ?? [SHA])], {
    encoding: "utf8",
    env,
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/**
 * A check-run as the API returns it. `id` and `app.slug` are load-bearing:
 * ordering is by id, and only the `github-actions` App is trusted.
 * `opts.app === null` omits the app object entirely (an anonymous run).
 */
let nextId = 1000;
const run = (name, status, conclusion, opts = {}) => {
  const r = {
    id: "id" in opts ? opts.id : nextId++,
    name,
    status,
    conclusion,
    started_at: opts.started_at ?? "2026-08-03T10:00:00Z",
  };
  if (r.id === undefined) delete r.id;
  if (opts.app !== null) r.app = { slug: opts.app ?? "github-actions" };
  return r;
};
const checkRuns = (...runs) => ({ total_count: runs.length, check_runs: runs });

const GREEN_FRONTEND = run("frontend", "completed", "success");
const GREEN_RUST = run("rust", "completed", "success");

describe("check-tag-green.sh (stubbed gh, matrix)", () => {
  // Case 1 — both required checks green → exit 0
  it("passes when frontend and rust are both completed+success", () => {
    const { status, stdout } = runScript({ fixture: checkRuns(GREEN_FRONTEND, GREEN_RUST) });
    expect(status).toBe(0);
    expect(stdout).toContain("green");
    expect(stdout).toContain(SHA);
  });

  // Case 2 — one required check failed → exit 1 naming the check + conclusion
  it("refuses when frontend failed, naming the check and its conclusion", () => {
    const { status, stderr } = runScript({
      fixture: checkRuns(run("frontend", "completed", "failure"), GREEN_RUST),
    });
    expect(status).toBe(1);
    expect(stderr).toContain("frontend");
    expect(stderr).toContain("conclusion: failure");
  });

  // Case 3 — one required check pending → exit 1, DISTINCT "not finished" message
  it("refuses when rust is in_progress with a distinct not-finished message", () => {
    const { status, stderr } = runScript({
      fixture: checkRuns(GREEN_FRONTEND, run("rust", "in_progress", null)),
    });
    expect(status).toBe(1);
    expect(stderr).toContain("rust");
    expect(stderr).toContain("not finished");
    expect(stderr).not.toContain("conclusion: failure");
  });

  // Case 4 — a required check absent entirely → exit 1, distinct "missing" message
  it("refuses when the rust check-run is absent, with a distinct missing-check message", () => {
    const { status, stderr } = runScript({ fixture: checkRuns(GREEN_FRONTEND) });
    expect(status).toBe(1);
    expect(stderr).toContain("rust");
    expect(stderr.toLowerCase()).toContain("missing");
  });

  // Case 5 — gh not on PATH → exit 1, message points at the offline flag
  it("refuses (never silently passes) when gh is not on PATH, pointing at VMARK_OFFLINE_GATE=1", () => {
    const { status, stderr } = runScript({ withGh: false });
    expect(status).toBe(1);
    expect(stderr).toContain("gh");
    expect(stderr).toContain("VMARK_OFFLINE_GATE=1");
  });

  // Case 6 — gh network error (non-zero exit with error text) → exit 1 + offline guidance
  it("refuses on a gh network error, surfacing the error and the offline flag", () => {
    const { status, stderr } = runScript({
      ghExit: "1",
      ghStderr: "error connecting to api.github.com",
    });
    expect(status).toBe(1);
    expect(stderr).toContain("error connecting to api.github.com");
    expect(stderr).toContain("VMARK_OFFLINE_GATE=1");
  });

  // Case 7 — unrelated check red → exit 0 (only frontend+rust gate)
  it("ignores unrelated red checks: webkit failed but frontend+rust green passes", () => {
    const { status, stdout } = runScript({
      fixture: checkRuns(
        GREEN_FRONTEND,
        GREEN_RUST,
        run("webkit", "completed", "failure"),
      ),
    });
    expect(status).toBe(0);
    expect(stdout).toContain("green");
  });

  // Case 8 — duplicate runs per name → highest id wins (re-run-to-green passes)
  it("passes when an older frontend failure is superseded by a newer success", () => {
    const { status, stdout } = runScript({
      fixture: checkRuns(
        run("frontend", "completed", "failure", { id: 1, started_at: "2026-08-03T09:00:00Z" }),
        run("frontend", "completed", "success", { id: 2, started_at: "2026-08-03T10:30:00Z" }),
        GREEN_RUST,
      ),
    });
    expect(status).toBe(0);
    expect(stdout).toContain("green");
  });

  // Case 8b — the timestamp ordering defect, pinned: a NEWER (higher-id) red
  // run whose started_at is EARLIER than an older green must still refuse.
  // Sorting by started_at let the stale success win; ids are monotonic.
  it("refuses when the newest run by id is red, even though an older run has a later timestamp", () => {
    const { status, stderr } = runScript({
      fixture: checkRuns(
        run("frontend", "completed", "success", { id: 2, started_at: "2026-08-03T11:00:00Z" }),
        run("frontend", "completed", "failure", { id: 5, started_at: "2026-08-03T09:00:00Z" }),
        GREEN_RUST,
      ),
    });
    expect(status).toBe(1);
    expect(stderr).toContain("frontend");
    expect(stderr).toContain("conclusion: failure");
  });

  // Case 8c — no timestamps at all: every started_at parsed to 0, so the tie
  // was broken by ARRAY ORDER. Ordering must come from the id alone.
  it("orders duplicate runs by id when started_at is absent entirely", () => {
    const noTs = (name, conclusion, id) => {
      const r = run(name, "completed", conclusion, { id });
      delete r.started_at;
      return r;
    };
    const { status, stderr } = runScript({
      fixture: checkRuns(noTs("frontend", "failure", 9), noTs("frontend", "success", 3), GREEN_RUST),
    });
    expect(status).toBe(1);
    expect(stderr).toContain("conclusion: failure");
  });

  // Case 8d — a run with no id cannot be ordered → fail closed, never "latest".
  it("fails closed when a required check-run carries no numeric id", () => {
    const { status, stderr } = runScript({
      fixture: checkRuns(run("frontend", "completed", "success", { id: undefined }), GREEN_RUST),
    });
    expect(status).toBe(1);
    expect(stderr).toContain("frontend");
    expect(stderr).toContain("id");
  });

  // Case 8e — forged check-run: any GitHub App with checks:write can publish a
  // run NAMED `frontend`. Only the `github-actions` App's runs may satisfy the
  // gate; a name is not an identity.
  it("refuses a green check-run published by an app other than github-actions", () => {
    const { status, stderr } = runScript({
      fixture: checkRuns(
        run("frontend", "completed", "success", { app: "totally-legit-ci" }),
        GREEN_RUST,
      ),
    });
    expect(status).toBe(1);
    expect(stderr).toContain("frontend");
    expect(stderr).toContain("github-actions");
    expect(stderr).toContain("totally-legit-ci");
  });

  // Case 8f — a run with no `app` object at all is equally untrusted.
  it("refuses a green check-run with no app attribution", () => {
    const { status, stderr } = runScript({
      fixture: checkRuns(run("frontend", "completed", "success", { app: null }), GREEN_RUST),
    });
    expect(status).toBe(1);
    expect(stderr).toContain("github-actions");
  });

  // Case 8g — the forged run must not be able to MASK a genuine red one either:
  // filtering happens before latest-wins, so the genuine failure still decides.
  it("ignores a forged newer success and honours the genuine github-actions failure", () => {
    const { status, stderr } = runScript({
      fixture: checkRuns(
        run("frontend", "completed", "failure", { id: 1 }),
        run("frontend", "completed", "success", { id: 99, app: "totally-legit-ci" }),
        GREEN_RUST,
      ),
    });
    expect(status).toBe(1);
    expect(stderr).toContain("conclusion: failure");
  });

  // Case 9 — malformed JSON → exit 1, fail closed
  it("fails closed on malformed check-runs JSON", () => {
    const { status, stderr } = runScript({ fixture: `{ "check_runs": [` });
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain("parse");
    expect(stderr).toContain("VMARK_OFFLINE_GATE=1");
  });

  // Guard clause (bonus) — no SHA argument → exit 1 with usage, gh never called
  it("refuses with usage when invoked without a SHA", () => {
    const { status, stderr } = runScript({ args: [] });
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain("usage");
  });
});
