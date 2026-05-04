// WI-1.2 — parser orchestrator integration tests.
//
// Verifies the orchestrator wires every subparser correctly and that
// ALL 22 fixtures in dev-docs/fixtures/gha-workflows/ produce a
// reasonable IR with no thrown exceptions.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../index";

const FIXTURE_ROOT = "dev-docs/fixtures/gha-workflows";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (f.endsWith(".yml") || f.endsWith(".yaml")) out.push(p);
  }
  return out;
}

describe("parse — orchestrator", () => {
  it("returns a WorkflowIR for a minimal workflow", () => {
    const ir = parse(`name: minimal
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`);
    expect(ir.name).toBe("minimal");
    expect(ir.triggers).toHaveLength(1);
    expect(ir.triggers[0].event).toBe("push");
    expect(ir.jobs).toHaveLength(1);
    expect(ir.jobs[0].id).toBe("build");
    expect(ir.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("captures workflow-level env, defaults, concurrency", () => {
    const ir = parse(`name: x
on: push
env:
  NODE_ENV: production
defaults:
  run:
    shell: bash
concurrency:
  group: deploy-prod
  cancel-in-progress: true
jobs:
  a:
    runs-on: x
    steps: []
`);
    expect(ir.env).toEqual({ NODE_ENV: "production" });
    expect(ir.defaults?.run?.shell).toBe("bash");
    expect(ir.concurrency?.group).toBe("deploy-prod");
    expect(ir.concurrency?.cancelInProgress).toBe(true);
  });

  it("captures top-level positions (name, on, jobs)", () => {
    const ir = parse(`name: pos
on: push
jobs:
  a:
    runs-on: x
    steps: []
`);
    // Parser's range targets the *value* token, not the key. For block
    // mappings, jobs's value starts on the next line (the indented entry).
    expect(ir.positions.name?.startLine).toBe(1);
    expect(ir.positions.on?.startLine).toBe(2);
    expect(ir.positions.jobs?.startLine).toBeGreaterThanOrEqual(3);
  });

  it("derives needs-edges into ir.diagnostics for unknowns", () => {
    const ir = parse(`on: push
jobs:
  deploy:
    runs-on: x
    needs: phantom
    steps: []
`);
    expect(
      ir.diagnostics.some((d) => d.code === "GHA-NEEDS-001"),
    ).toBe(true);
  });

  it("forwards parser context errors as GHA-PARSE-001", () => {
    const ir = parse(`on: push
jobs:
  bad:
    runs-on: x
    steps:
      - uses: foo
        run: bar
`);
    expect(
      ir.diagnostics.some(
        (d) => d.code === "GHA-PARSE-001" || d.code === "GHA-SCHEMA-001",
      ),
    ).toBe(true);
  });

  it("emits GHA-PARSE-002 if jobs: missing", () => {
    const ir = parse(`name: x
on: push
`);
    expect(
      ir.diagnostics.some((d) => d.code === "GHA-PARSE-002"),
    ).toBe(true);
  });

  it("emits GHA-PARSE-003 if on: missing", () => {
    const ir = parse(`name: x
jobs:
  a:
    runs-on: x
    steps: []
`);
    expect(
      ir.diagnostics.some((d) => d.code === "GHA-PARSE-003"),
    ).toBe(true);
  });

  it("emits GHA-PARSE-001 for malformed YAML", () => {
    const ir = parse("not: valid:\n  bad: indentation:\n     - mixed");
    expect(
      ir.diagnostics.some((d) => d.code === "GHA-PARSE-001"),
    ).toBe(true);
  });
});

describe("parse — fixture corpus", () => {
  const fixtures = walk(FIXTURE_ROOT);

  it.each(fixtures.map((f) => [f]))(
    "parses %s without throwing",
    (path) => {
      const yaml = readFileSync(path, "utf8");
      expect(() => parse(yaml)).not.toThrow();
    },
  );

  it("produces non-empty jobs for every fixture", () => {
    let nonEmpty = 0;
    for (const f of fixtures) {
      const ir = parse(readFileSync(f, "utf8"));
      if (ir.jobs.length > 0) nonEmpty++;
    }
    // All real workflows should have at least one job.
    expect(nonEmpty).toBe(fixtures.length);
  });

  it("captures triggers for every fixture", () => {
    let withTriggers = 0;
    for (const f of fixtures) {
      const ir = parse(readFileSync(f, "utf8"));
      if (ir.triggers.length > 0) withTriggers++;
    }
    expect(withTriggers).toBe(fixtures.length);
  });
});
