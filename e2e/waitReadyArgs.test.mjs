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
    // broken is not. No bridge is running here, so it fails to connect — the
    // point is that it PROBED (exit 1) instead of refusing to start (exit 2).
    const { code, output } = run("--timeout-ms", "1000");
    expect(code, output).toBe(1);
    expect(output).toContain("not ready");
  });

  it("honours the advertised timeout as an upper bound", () => {
    // The loop used to sleep a full poll interval after the budget was spent,
    // so `--timeout-ms` was a lower bound. Generous margin: this asserts the
    // budget is respected, not how fast the machine is.
    const started = Date.now();
    const { code } = run("--timeout-ms", "1500");
    const elapsed = Date.now() - started;
    expect(code).toBe(1);
    expect(elapsed).toBeLessThan(15_000);
  });
});
