/**
 * The release-smoke step that launches the STAGED app clean and records the
 * Knowledge Base runtime state (WI-FL0.8 / WI-FL1.1) — and the ways it could be
 * weakened while still looking wired up.
 *
 * Every release up to v0.9.65 shipped View → Knowledge Base while no packaged
 * build could start it, and nothing observed that: release.yml never runs what
 * it uploads, and the local machine that would have noticed has `node` and a
 * checkout with `VMARK_CONTENT_SERVER_CLI`. The step closes that by running the
 * mounted DMG's binary under `env -i` — no `node` on PATH, no repo
 * `node_modules`, no CLI override — and reading the one startup log line the
 * app writes (`content_server/runtime.rs`).
 *
 * What is pinned here, and why each is a silent failure mode:
 *
 *   1. The PATH handed to the app. A runner has node at /usr/local/bin or
 *      /opt/homebrew/bin; if either creeps into the `env -i` line the step
 *      measures the runner, not a user's machine, and still reports a state.
 *   2. No `VMARK_CONTENT_SERVER_CLI`. Set anywhere in the step, the "clean"
 *      launch resolves the CLI from the checkout and `cli=ready` means nothing.
 *   3. The log-line prefix, read from the Rust source rather than restated:
 *      a renamed prefix would make the poll time out — loudly, but only after a
 *      release — where this fails in seconds.
 *   4. The assertion itself is EXECUTED against sample lines, not grepped for
 *      its spelling: the `case` pattern must accept `cli=missing` and refuse
 *      `cli=ready` (the D1 interim; flips together with option (b)).
 *
 * @coordinates-with .github/workflows/release-smoke.yml
 * @coordinates-with src-tauri/src/content_server/runtime.rs — LOG_PREFIX
 * @module scripts/release-smoke-kb-runtime.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = parseYaml(
  readFileSync(path.join(REPO, ".github/workflows/release-smoke.yml"), "utf8"),
);
const steps = workflow.jobs.artefact.steps;
const stepIndex = steps.findIndex((s) => s.id === "kb-runtime-state");
const step = steps[stepIndex];
const run = String(step?.run ?? "");
const lines = run.split("\n");
const launchLine = lines.find((l) => /\benv -i\b/.test(l));

/** Directories where a macOS runner (or a developer) has node installed. */
const NODE_HOMES = ["/usr/local/bin", "/opt/homebrew/bin", "/opt/homebrew/sbin", "/opt/local/bin"];

/** The Rust half of the join: the prefix the app logs and the step polls for. */
const runtimeRs = readFileSync(
  path.join(REPO, "src-tauri/src/content_server/runtime.rs"),
  "utf8",
);
const logPrefix = runtimeRs.match(/pub const LOG_PREFIX: &str = "([^"]+)";/)?.[1];

/**
 * Extract the step's assertion function and run it under bash against one
 * sample line. Returns the exit status.
 */
function assertState(line) {
  const start = lines.findIndex((l) => /^\s*assert_kb_runtime_state\(\)\s*\{/.test(l));
  expect(start, "the step must define assert_kb_runtime_state()").toBeGreaterThan(-1);
  const end = lines.findIndex((l, i) => i > start && l.trim() === "}");
  expect(end, "assert_kb_runtime_state() must close with a bare `}`").toBeGreaterThan(start);
  const fn = lines.slice(start, end + 1).join("\n");
  return spawnSync("bash", ["-c", `${fn}\nassert_kb_runtime_state "$LINE"`], {
    env: { ...process.env, LINE: line },
    encoding: "utf8",
  }).status;
}

describe("release-smoke: kb-runtime-state", () => {
  it("exists, runs after the mount step, and is bounded", () => {
    expect(stepIndex, "no step with id kb-runtime-state").toBeGreaterThan(-1);
    const mount = steps.findIndex((s) => s.id === "mount");
    expect(mount).toBeGreaterThan(-1);
    expect(stepIndex).toBeGreaterThan(mount);
    expect(step["timeout-minutes"]).toBe(3);
    // The app under test is the one the mount step found inside the DMG.
    expect(step.env?.APP).toBe("${{ steps.mount.outputs.app }}");
    expect(run).toMatch(/\$APP\/Contents\/MacOS\//);
  });

  it("launches the staged binary under env -i with a PATH that has no node", () => {
    expect(launchLine, "no `env -i` launch line in the step").toBeDefined();
    expect(launchLine).toMatch(/\$APP\/Contents\/MacOS\//);
    const pathValue = launchLine.match(/\bPATH=("[^"]*"|'[^']*'|\S+)/)?.[1]?.replace(/^["']|["']$/g, "");
    expect(pathValue, "env -i must set PATH explicitly").toBeDefined();
    expect(pathValue).toBe("/usr/bin:/bin");
    for (const dir of pathValue.split(":")) {
      expect(NODE_HOMES, `${dir} is where node lives on a runner`).not.toContain(dir);
    }
  });

  it("hands the app no content-server CLI through the environment", () => {
    expect(run).not.toMatch(/VMARK_CONTENT_SERVER_CLI=/);
    expect(JSON.stringify(step.env ?? {})).not.toContain("VMARK_CONTENT_SERVER_CLI");
    // env -i drops the runner's environment; only what is assigned on the line
    // reaches the app.
    const assigned = [...launchLine.matchAll(/\b([A-Z_][A-Z0-9_]*)=/g)].map((m) => m[1]);
    expect(assigned).toEqual(expect.arrayContaining(["HOME", "PATH"]));
    expect(assigned).not.toContain("VMARK_CONTENT_SERVER_CLI");
    expect(assigned).not.toContain("NODE_PATH");
  });

  it("polls for the exact log-line prefix runtime.rs declares", () => {
    expect(logPrefix, "runtime.rs no longer declares LOG_PREFIX").toBeDefined();
    expect(run).toContain(logPrefix);
  });

  it("asserts the D1 interim state: cli=missing passes, anything else fails", () => {
    expect(assertState(`${logPrefix} node=ready cli=missing detail="content-server runtime not provisioned"`)).toBe(0);
    expect(assertState(`${logPrefix} node=missing cli=missing detail="node not found on PATH; content-server runtime not provisioned"`)).toBe(0);
    expect(assertState(`${logPrefix} node=ready cli=ready node_path=/usr/local/bin/node cli_source=provisioned`)).not.toBe(0);
    expect(assertState("")).not.toBe(0);
    expect(assertState("something unrelated")).not.toBe(0);
    // The step documents that this flips with D1 option (b).
    expect(run).toMatch(/D1/);
  });

  it("fails the step, not just the poll, when no line appears", () => {
    // A missing line must be `exit 1`, never a warning — a gate that hangs or
    // shrugs is the failure mode this workflow exists to remove.
    expect(run).toMatch(/exit 1/);
    expect(run).toMatch(/kill /);
  });
});
