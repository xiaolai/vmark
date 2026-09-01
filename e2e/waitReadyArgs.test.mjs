// Argument handling for the CI readiness gate.
//
// `wait-ready.mjs` is the first thing every Tier-0 CI run executes, and a
// mis-parsed argument does not announce itself: `Number("abc")` is NaN, and a
// NaN budget makes `Date.now() < deadline` false on the FIRST check, so the
// script exits "not ready" without ever probing. On a CI log that is
// indistinguishable from an app that failed to start — which is the diagnosis
// it would send you chasing.
//
// Spawned as a real process rather than imported, because the module validates
// at load time and exits: that IS the behaviour under test.

import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";

/** Run the gate and return `{ code, output }` without throwing. */
function run(...args) {
  try {
    const output = execFileSync("node", ["e2e/wait-ready.mjs", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (e) {
    return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("wait-ready argument validation", () => {
  it.each([
    ["a non-numeric port", ["--port", "abc"]],
    ["a port above the valid range", ["--port", "70000"]],
    ["a zero port", ["--port", "0"]],
    ["a negative timeout", ["--timeout-ms", "-5"]],
    ["a zero timeout", ["--timeout-ms", "0"]],
    ["a fractional timeout", ["--timeout-ms", "1.5"]],
    ["a zero poll interval", ["--poll-ms", "0"]],
    ["a non-numeric poll interval", ["--poll-ms", "soon"]],
  ])("rejects %s with exit 2", (_label, args) => {
    const { code, output } = run(...args, "--timeout-ms", "1000");
    expect(code, output).toBe(2);
    expect(output).toContain("must be a positive integer");
  });

  it.each([
    ["a flag with no value at all", ["--port"]],
    ["a flag followed by another flag", ["--port", "--window", "main"]],
  ])("rejects %s rather than silently using the default", (_label, args) => {
    // Falling back would hide the typo exactly as well as the NaN did: the run
    // would probe 9323, fail, and report "the app never started".
    const { code, output } = run(...args);
    expect(code, output).toBe(2);
    expect(output).toContain("was given without a value");
  });

  it("treats an absent flag as a request for the default", () => {
    // The distinction that makes the rule usable: absent is fine, present-and-
    // broken is not. The property is that it PROBED instead of refusing to
    // start (exit 2). This used to also assert exit 1 ("no app"), which made
    // the test a hostage of the ENVIRONMENT: on a maintainer machine with a
    // dev VMark open, the default-port probe legitimately succeeds and the
    // gate went red with nothing wrong. Either probe outcome proves the
    // absent flag resolved to a usable default.
    const { code, output } = run("--timeout-ms", "1000");
    expect(code, output).not.toBe(2);
    expect(output, output).toMatch(/not ready|ready|drivable/);
  });

  it("honours the advertised timeout as an upper bound", () => {
    // The loop used to sleep a full poll interval after the budget was spent,
    // so `--timeout-ms` was a LOWER bound. The margin here is derived, not
    // taste: with a 9000ms interval and a 9100ms budget, the correct loop makes
    // its last sleep 100ms and finishes at ~9100ms, while the unconditional
    // version sleeps the full 9000 and finishes at ~18100. A bound of 13600
    // sits between them with ~4.5s of headroom on each side.
    //
    // The numbers have been raised TOGETHER twice (3000/3100/4500 →
    // 6000/6100/9000 → here), each time after machine load ate the spawn
    // overhead margin: 4893ms under check:predelta's 8-way pool, then >9s
    // when test:changed runs this tier beside the full app tier. That is the
    // relaxation rule this comment has always stated: raise `--poll-ms` and
    // the bound TOGETHER — widening the margin alone puts the guard back to
    // sleep, because the broken variant's finish time scales with the
    // interval too.
    // Hermetic port: the timing property needs the probe to FAIL every
    // attempt, and the default 9323 answers whenever a dev VMark is open on
    // this machine. Port 1 is reserved and never listening.
    const started = Date.now();
    const { code } = run("--timeout-ms", "9100", "--poll-ms", "9000", "--port", "1");
    const elapsed = Date.now() - started;
    expect(code).toBe(1);
    expect(elapsed).toBeLessThan(13_600);
  });
});
