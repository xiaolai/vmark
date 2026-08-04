/**
 * WI-5 — Stryker break-threshold canary (durable meta-test).
 *
 * Proves `thresholds.break` actually BITES: runs REAL Stryker on a committed
 * fixture project (scripts/fixtures/stryker-canary/) whose one deliberately
 * untested function leaves known SURVIVING mutants, under a fixture config
 * whose `break` threshold that survival violates — and asserts the run exits
 * non-zero for the break reason. A one-time gutted-test PR demo proves one
 * version of the gate bit once; this canary proves it keeps biting on every
 * suite run (e.g. against a Stryker upgrade that changes exit-code behavior).
 *
 * The repo suite stays green because the expected failure lives INSIDE this
 * meta-test. The fixture's own test file is named `*.canary.js` so the root
 * vitest include (which collects only .test./.spec. suffixes) never runs it —
 * only the fixture's vitest config does, inside Stryker's sandbox.
 *
 * No mocking anywhere: real Stryker, real vitest runner, real fixture tree
 * (the meta-test that certifies a gate must not prove it with fakes).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(REPO, "scripts", "fixtures", "stryker-canary");
const STRYKER_BIN = path.join(
  REPO,
  "node_modules",
  "@stryker-mutator",
  "core",
  "bin",
  "stryker.js",
);

/**
 * Real-Stryker startup + dry run + a handful of mutants measured ~30–60 s on
 * a dev machine; the generous ceiling absorbs loaded-CI contention without
 * hiding a hang (a genuine break-gate regression fails on the assertions in
 * the same run, not by running long).
 */
const CANARY_TIMEOUT_MS = 240_000;

describe("stryker break-threshold canary (real Stryker on a fixture project)", () => {
  it("fails the run (non-zero exit) when the mutation score is under `break`", () => {
    const res = spawnSync(
      process.execPath,
      [STRYKER_BIN, "run", "stryker.conf.json"],
      { cwd: FIXTURE, encoding: "utf8", timeout: CANARY_TIMEOUT_MS },
    );
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;

    // The run must REACH the scoring phase — a crash or config error also
    // exits non-zero and must not be able to fake this canary green.
    expect(out).toMatch(/mutation score/i);
    // …and it must fail FOR THE BREAK REASON, naming the threshold.
    expect(out).toMatch(/break/i);
    // Surviving mutants are the mechanism — the report must show them.
    expect(out).toMatch(/survived/i);
    expect(res.status).not.toBeNull(); // null = killed by our timeout
    expect(res.status).not.toBe(0);
  }, CANARY_TIMEOUT_MS + 30_000);
});
