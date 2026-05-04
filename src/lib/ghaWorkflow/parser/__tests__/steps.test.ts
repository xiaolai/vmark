// WI-1.3 — step parsing tests (extracted from jobs.ts to keep both ≤300 LOC).
//
// Most step semantics are covered indirectly through jobs.test.ts (which
// builds on parseSteps). This file exercises parseSteps in isolation.

import { describe, expect, it } from "vitest";
import { parseWorkflow } from "@actions/workflow-parser";
import { parseSteps } from "../steps";
import { asMapping } from "../tokens";

const trace = { error: () => {}, info: () => {}, verbose: () => {} };

function getStepsToken(yaml: string) {
  const r = parseWorkflow({ name: "t.yml", content: yaml }, trace);
  const root = asMapping(r.value)!;
  const jobs = asMapping(root.find("jobs"))!;
  const job = asMapping(jobs.get(0).value)!;
  return job.find("steps");
}

describe("parseSteps", () => {
  it("returns empty for missing steps", () => {
    const r = parseSteps(undefined);
    expect(r.steps).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  it("synthesizes ids when explicit id is missing", () => {
    const r = parseSteps(
      getStepsToken(`
on: push
jobs:
  a:
    runs-on: x
    steps:
      - run: a
      - run: b
      - run: c`),
    );
    expect(r.steps).toHaveLength(3);
    expect(r.steps.every((s) => s.idSynthesized)).toBe(true);
    expect(new Set(r.steps.map((s) => s.id)).size).toBe(3);
    expect(
      r.diagnostics.filter((d) => d.code === "GHA-STEP-003").length,
    ).toBe(3);
  });

  it("preserves explicit id without synthesis", () => {
    const r = parseSteps(
      getStepsToken(`
on: push
jobs:
  a:
    runs-on: x
    steps:
      - id: my-step
        run: echo`),
    );
    expect(r.steps[0].id).toBe("my-step");
    expect(r.steps[0].idSynthesized).toBe(false);
    expect(r.diagnostics.filter((d) => d.code === "GHA-STEP-003")).toEqual([]);
  });

  // Note: uses+run conflict is caught by the parser itself and the
  // conflicting key is stripped from the step token before parseSteps
  // sees it. The orchestrator (WI-1.2) forwards the parser's context
  // error as a GHA-PARSE-* diagnostic. GHA-STEP-002 remains a defensive
  // path in steps.ts in case a future parser change exposes both keys.

  it("flags GHA-STEP-001 when neither uses nor run present", () => {
    const r = parseSteps(
      getStepsToken(`
on: push
jobs:
  a:
    runs-on: x
    steps:
      - name: bare`),
    );
    expect(r.diagnostics.some((d) => d.code === "GHA-STEP-001")).toBe(true);
  });

  it("captures with, env, if on a uses: step", () => {
    // working-directory and shell are only valid on run: steps per GitHub
    // Actions schema; the parser drops them on uses: steps. Tested
    // separately below.
    const r = parseSteps(
      getStepsToken(`
on: push
jobs:
  a:
    runs-on: x
    steps:
      - uses: actions/setup-node@v4
        if: github.event_name == 'push'
        with:
          node-version: "20"
        env:
          DEBUG: "1"`),
    );
    const s = r.steps[0];
    expect(s.uses).toBe("actions/setup-node@v4");
    expect(s.if).toBe("github.event_name == 'push'");
    expect(s.with).toMatchObject({ "node-version": "20" });
    expect(s.env).toEqual({ DEBUG: "1" });
  });

  it("captures working-directory and shell on a run: step", () => {
    const r = parseSteps(
      getStepsToken(`
on: push
jobs:
  a:
    runs-on: x
    steps:
      - run: echo hi
        working-directory: ./app
        shell: bash`),
    );
    const s = r.steps[0];
    expect(s.run).toBe("echo hi");
    expect(s.workingDirectory).toBe("./app");
    expect(s.shell).toBe("bash");
  });

  it("captures source position for each step", () => {
    const r = parseSteps(
      getStepsToken(`
on: push
jobs:
  a:
    runs-on: x
    steps:
      - run: hi`),
    );
    expect(r.steps[0].position.startLine).toBeGreaterThan(0);
  });
});
