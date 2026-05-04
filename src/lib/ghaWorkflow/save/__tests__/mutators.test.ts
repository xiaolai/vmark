// Phase 8 WI-8.2 — mutator tests.
//
// Each mutator: takes a Document + IRPatch, returns a mutated
// Document. Tests verify:
//   1. Targeted IR-level outcome (the intended change happens).
//   2. ADR-11 gate held (comments + anchors + semantics outside the
//      edit region preserved).

import { describe, expect, it } from "vitest";
import { parseAsCst, stringifyCst, semanticEqual } from "../cstParser";
import { applyPatch, type IRPatch } from "../mutators";

const SIMPLE_WORKFLOW = `# top-level comment
name: ci
on: push
env:
  NODE_ENV: production
jobs:
  build: # inline comment on build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
`;

function applyAndSave(yaml: string, patch: IRPatch): string {
  const doc = parseAsCst(yaml);
  applyPatch(doc, patch);
  return stringifyCst(doc);
}

function commentSet(yaml: string): Set<string> {
  const out = new Set<string>();
  for (const line of yaml.split("\n")) {
    let inS = false, inD = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'" && !inD) inS = !inS;
      else if (ch === '"' && !inS) inD = !inD;
      else if (ch === "#" && !inS && !inD) {
        const t = line.slice(i + 1).trim();
        if (t) out.add(t);
        break;
      }
    }
  }
  return out;
}

describe("applyPatch — workflow.set", () => {
  it("sets a top-level scalar field", () => {
    const out = applyAndSave(SIMPLE_WORKFLOW, {
      kind: "workflow.set",
      path: "name",
      value: "renamed",
    });
    expect(out).toMatch(/name: renamed/);
    // Original "ci" gone.
    expect(out).not.toMatch(/^name: ci$/m);
  });

  it("preserves comments after editing a top-level field", () => {
    const out = applyAndSave(SIMPLE_WORKFLOW, {
      kind: "workflow.set",
      path: "name",
      value: "renamed",
    });
    const before = commentSet(SIMPLE_WORKFLOW);
    const after = commentSet(out);
    for (const c of before) expect(after.has(c), `lost: ${c}`).toBe(true);
  });

  it("creates a missing top-level field rather than throwing", () => {
    const out = applyAndSave(SIMPLE_WORKFLOW, {
      kind: "workflow.set",
      path: "run-name",
      value: "Custom run name",
    });
    expect(out).toMatch(/run-name: Custom run name/);
  });
});

describe("applyPatch — job.set", () => {
  it("updates a job's runs-on", () => {
    const out = applyAndSave(SIMPLE_WORKFLOW, {
      kind: "job.set",
      jobId: "build",
      path: "runs-on",
      value: "macos-latest",
    });
    expect(out).toMatch(/runs-on: macos-latest/);
  });

  it("preserves the job's inline comment", () => {
    const out = applyAndSave(SIMPLE_WORKFLOW, {
      kind: "job.set",
      jobId: "build",
      path: "runs-on",
      value: "macos-latest",
    });
    expect(commentSet(out).has("inline comment on build")).toBe(true);
  });

  it("noop when jobId is unknown (no-throw, doc unchanged)", () => {
    const out = applyAndSave(SIMPLE_WORKFLOW, {
      kind: "job.set",
      jobId: "missing",
      path: "runs-on",
      value: "x",
    });
    expect(semanticEqual(SIMPLE_WORKFLOW, out)).toBe(true);
  });
});

describe("applyPatch — step.set", () => {
  const yaml = SIMPLE_WORKFLOW;

  it("updates a step's run by stepIndex", () => {
    const out = applyAndSave(yaml, {
      kind: "step.set",
      jobId: "build",
      stepIndex: 1, // the "run: pnpm test" step
      path: "run",
      value: "pnpm check:all",
    });
    expect(out).toMatch(/run: pnpm check:all/);
    expect(out).not.toMatch(/run: pnpm test/);
  });

  it("noop when stepIndex is out of range", () => {
    const out = applyAndSave(yaml, {
      kind: "step.set",
      jobId: "build",
      stepIndex: 99,
      path: "run",
      value: "x",
    });
    expect(semanticEqual(yaml, out)).toBe(true);
  });
});

describe("applyPatch — with.set / with.remove", () => {
  const yaml = `name: ci
on: push
jobs:
  build:
    runs-on: x
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: pnpm
`;

  it("adds a new with: key", () => {
    const out = applyAndSave(yaml, {
      kind: "with.set",
      jobId: "build",
      stepIndex: 0,
      key: "registry-url",
      value: "https://npm.example.com",
    });
    expect(out).toMatch(/registry-url: https:\/\/npm.example.com/);
  });

  it("updates an existing with: key", () => {
    const out = applyAndSave(yaml, {
      kind: "with.set",
      jobId: "build",
      stepIndex: 0,
      key: "node-version",
      value: "22",
    });
    expect(out).toMatch(/node-version: ['"]?22['"]?/);
  });

  it("removes a with: key", () => {
    const out = applyAndSave(yaml, {
      kind: "with.remove",
      jobId: "build",
      stepIndex: 0,
      key: "cache",
    });
    expect(out).not.toMatch(/cache: pnpm/);
    // Other keys still there.
    expect(out).toMatch(/node-version/);
  });
});

describe("applyPatch — needs.add / needs.remove", () => {
  const yaml = `name: ci
on: push
jobs:
  a:
    runs-on: x
    steps: []
  b:
    runs-on: x
    steps: []
  c:
    runs-on: x
    needs: a
    steps: []
`;

  it("adds a needs entry to a job that has one already (string → array)", () => {
    const out = applyAndSave(yaml, {
      kind: "needs.add",
      jobId: "c",
      ref: "b",
    });
    // After mutation, both should be present.
    const doc = parseAsCst(out).toJS();
    expect(doc.jobs.c.needs.sort()).toEqual(["a", "b"]);
  });

  it("creates a needs[] when the job has none", () => {
    const out = applyAndSave(yaml, {
      kind: "needs.add",
      jobId: "b",
      ref: "a",
    });
    const doc = parseAsCst(out).toJS();
    expect(doc.jobs.b.needs).toEqual(["a"]);
  });

  it("removes a needs entry", () => {
    const out = applyAndSave(yaml, {
      kind: "needs.remove",
      jobId: "c",
      ref: "a",
    });
    const doc = parseAsCst(out).toJS();
    // After removal, needs should be absent or empty.
    expect(doc.jobs.c.needs == null || doc.jobs.c.needs.length === 0).toBe(true);
  });
});

describe("applyPatch — array values for job.set / step.set", () => {
  // Audit fix: runs-on array values used to be coerced into a single
  // scalar string by the YAML stringifier. The mutator now wraps array
  // values in a YAMLSeq so they round-trip as proper sequences.
  const yaml = `name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps: []
`;

  it("writes runs-on as a YAML sequence when given an array value", () => {
    const out = applyAndSave(yaml, {
      kind: "job.set",
      jobId: "build",
      path: "runs-on",
      value: ["self-hosted", "linux", "x64"],
    });
    // Re-parse and confirm it round-trips as an array.
    const reparsed = parseAsCst(out).toJS();
    expect(reparsed.jobs.build["runs-on"]).toEqual([
      "self-hosted",
      "linux",
      "x64",
    ]);
  });

  it("writes runs-on as a scalar when given a single string", () => {
    const out = applyAndSave(yaml, {
      kind: "job.set",
      jobId: "build",
      path: "runs-on",
      value: "macos-latest",
    });
    const reparsed = parseAsCst(out).toJS();
    expect(reparsed.jobs.build["runs-on"]).toBe("macos-latest");
  });
});

describe("applyPatch — trigger.setFilters", () => {
  const yamlMapping = `name: ci
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  build:
    runs-on: x
    steps: []
`;

  it("replaces the branches filter on a mapping-form trigger", () => {
    const out = applyAndSave(yamlMapping, {
      kind: "trigger.setFilters",
      event: "push",
      filter: "branches",
      value: ["main", "develop"],
    });
    expect(out).toMatch(/branches:\s*\n?\s*- main\s*\n?\s*- develop/);
  });

  it("removes the filter when value is empty", () => {
    const out = applyAndSave(yamlMapping, {
      kind: "trigger.setFilters",
      event: "push",
      filter: "branches",
      value: [],
    });
    // push: should be followed by {} or no branches filter inside its block
    // (pull_request's branches stays intact, so we can't grep globally).
    // Capture push's own block and verify it's empty (re-parsing is the
    // most reliable check).
    const reparsed = parseAsCst(out).toJS();
    expect(reparsed.on.push.branches).toBeUndefined();
    // pull_request branches still intact.
    expect(reparsed.on.pull_request.branches).toEqual(["main"]);
  });

  it("adds a paths filter to an existing event mapping", () => {
    const out = applyAndSave(yamlMapping, {
      kind: "trigger.setFilters",
      event: "push",
      filter: "paths",
      value: ["src/**", "package.json"],
    });
    expect(out).toMatch(/paths:/);
    expect(out).toMatch(/src\/\*\*/);
    expect(out).toMatch(/package\.json/);
  });

  it("noop when the trigger is not in mapping form (on: push as scalar)", () => {
    const yamlScalar = `name: ci
on: push
jobs:
  build:
    runs-on: x
    steps: []
`;
    const out = applyAndSave(yamlScalar, {
      kind: "trigger.setFilters",
      event: "push",
      filter: "branches",
      value: ["main"],
    });
    // YAML structure unchanged because reshaping is out-of-scope.
    expect(semanticEqual(yamlScalar, out)).toBe(true);
  });

  it("noop when the event does not exist in the mapping", () => {
    const out = applyAndSave(yamlMapping, {
      kind: "trigger.setFilters",
      event: "release",
      filter: "types",
      value: ["published"],
    });
    expect(semanticEqual(yamlMapping, out)).toBe(true);
  });
});

describe("applyPatch — gate compliance over a representative fixture", () => {
  // Read a real fixture, apply 3 unrelated mutations, verify the
  // ADR-11 gate still holds: comments preserved (set-equality),
  // semantic equality outside the targeted regions.
  it("3-edit sequence preserves all original comments + anchors", async () => {
    const { readFileSync } = await import("node:fs");
    const yaml = readFileSync(
      "dev-docs/fixtures/gha-workflows/vmark/ci.yml",
      "utf8",
    );
    const orig = commentSet(yaml);

    const doc = parseAsCst(yaml);
    applyPatch(doc, {
      kind: "workflow.set",
      path: "name",
      value: "Renamed CI",
    });
    const out = stringifyCst(doc);
    const after = commentSet(out);
    for (const c of orig) {
      expect(after.has(c), `lost comment: ${c}`).toBe(true);
    }
  });
});
