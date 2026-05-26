// Coverage for the C-series patches: job CRUD, step CRUD, permissions, concurrency.
// The original mutators.test.ts covers the A/B series. These are the WI-C.1/C.2/C.3
// patches added later and were missing direct coverage.

import { describe, expect, it } from "vitest";
import { parseAsCst, stringifyCst } from "../cstParser";
import { applyPatch, type IRPatch } from "../mutators";

const BASE = `name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
`;

const EMPTY = `name: ci
on: push
`;

function applyAndSave(yaml: string, patch: IRPatch): string {
  const doc = parseAsCst(yaml);
  applyPatch(doc, patch);
  return stringifyCst(doc);
}

describe("applyPatch — job.create", () => {
  it("appends a new job with default runs-on when omitted", () => {
    const out = applyAndSave(BASE, { kind: "job.create", jobId: "deploy" });
    expect(out).toMatch(/deploy:/);
    expect(out).toMatch(/runs-on: ubuntu-latest/);
  });

  it("appends a job using the requested runs-on label", () => {
    const out = applyAndSave(BASE, {
      kind: "job.create",
      jobId: "macbuild",
      runsOn: "macos-14",
    });
    expect(out).toMatch(/macbuild:\s*\n\s*runs-on: macos-14/);
  });

  it("creates the jobs: mapping when it does not exist", () => {
    const out = applyAndSave(EMPTY, { kind: "job.create", jobId: "build" });
    expect(out).toMatch(/^jobs:/m);
    expect(out).toMatch(/build:/);
  });

  it("is a no-op when the job id already exists (does not overwrite)", () => {
    const out = applyAndSave(BASE, { kind: "job.create", jobId: "build" });
    // Original 'build' job is untouched: still has the checkout step.
    expect(out).toMatch(/actions\/checkout@v4/);
    expect(out).toMatch(/pnpm test/);
    // No duplicate 'build:' entries.
    const occurrences = out.match(/^\s*build:/gm) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

describe("applyPatch — job.delete", () => {
  it("removes an existing job", () => {
    const out = applyAndSave(BASE, { kind: "job.delete", jobId: "build" });
    expect(out).not.toMatch(/^\s*build:/m);
  });

  it("is a no-op for unknown jobId", () => {
    const out = applyAndSave(BASE, { kind: "job.delete", jobId: "ghost" });
    expect(out).toMatch(/^\s*build:/m);
  });

  it("is a no-op when jobs: is missing entirely", () => {
    const out = applyAndSave(EMPTY, { kind: "job.delete", jobId: "build" });
    expect(out).toBe(EMPTY);
  });
});

describe("applyPatch — step.insert / step.delete / step.move", () => {
  it("inserts a step at the given index", () => {
    const out = applyAndSave(BASE, {
      kind: "step.insert",
      jobId: "build",
      index: 1,
      step: { name: "Setup Node", uses: "actions/setup-node@v4" },
    });
    expect(out).toMatch(/name: Setup Node/);
    expect(out).toMatch(/uses: actions\/setup-node@v4/);
  });

  it("clamps insert index to the end of the steps array", () => {
    const out = applyAndSave(BASE, {
      kind: "step.insert",
      jobId: "build",
      index: 999,
      step: { run: "echo done" },
    });
    expect(out).toMatch(/echo done/);
  });

  it("falls back to a TODO run when no step fields are provided", () => {
    const out = applyAndSave(BASE, {
      kind: "step.insert",
      jobId: "build",
      index: 0,
      step: {},
    });
    expect(out).toMatch(/echo TODO/);
  });

  it("is a no-op for unknown jobId on insert", () => {
    const out = applyAndSave(BASE, {
      kind: "step.insert",
      jobId: "ghost",
      index: 0,
      step: { run: "echo hi" },
    });
    expect(out).not.toMatch(/echo hi/);
  });

  it("deletes a step by index", () => {
    const out = applyAndSave(BASE, {
      kind: "step.delete",
      jobId: "build",
      stepIndex: 0,
    });
    expect(out).not.toMatch(/actions\/checkout@v4/);
    expect(out).toMatch(/pnpm test/);
  });

  it("is a no-op when step index is out of range", () => {
    const out = applyAndSave(BASE, {
      kind: "step.delete",
      jobId: "build",
      stepIndex: 99,
    });
    expect(out).toMatch(/actions\/checkout@v4/);
  });

  it("moves a step within a job", () => {
    const out = applyAndSave(BASE, {
      kind: "step.move",
      jobId: "build",
      fromIndex: 0,
      toIndex: 1,
    });
    // After move, run-line appears before checkout-line.
    const runIdx = out.indexOf("pnpm test");
    const checkoutIdx = out.indexOf("actions/checkout@v4");
    expect(runIdx).toBeLessThan(checkoutIdx);
  });

  it("is a no-op when fromIndex equals toIndex (after clamping)", () => {
    const out = applyAndSave(BASE, {
      kind: "step.move",
      jobId: "build",
      fromIndex: 0,
      toIndex: 0,
    });
    expect(out).toBe(stringifyCst(parseAsCst(BASE)));
  });

  it("is a no-op when fromIndex is out of range", () => {
    const out = applyAndSave(BASE, {
      kind: "step.move",
      jobId: "build",
      fromIndex: 99,
      toIndex: 0,
    });
    expect(out).toBe(stringifyCst(parseAsCst(BASE)));
  });
});

describe("applyPatch — workflow.permissions.set", () => {
  it("sets a scalar permissions value", () => {
    const out = applyAndSave(BASE, {
      kind: "workflow.permissions.set",
      value: "read-all",
    });
    expect(out).toMatch(/permissions: read-all/);
  });

  it("sets per-scope permissions as a mapping", () => {
    const out = applyAndSave(BASE, {
      kind: "workflow.permissions.set",
      value: { contents: "read", pullRequests: "write" },
    });
    expect(out).toMatch(/permissions:/);
    expect(out).toMatch(/contents: read/);
    // Scope names are converted to kebab-case (pullRequests -> pull-requests)
    expect(out).toMatch(/pull-requests: write/);
  });

  it("deletes permissions when value is null", () => {
    const withPerms = `name: ci
on: push
permissions: read-all
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: ":"
`;
    const out = applyAndSave(withPerms, {
      kind: "workflow.permissions.set",
      value: null,
    });
    expect(out).not.toMatch(/permissions:/);
  });
});

describe("applyPatch — workflow.concurrency.set", () => {
  it("sets a scalar concurrency value", () => {
    const out = applyAndSave(BASE, {
      kind: "workflow.concurrency.set",
      value: "release-group",
    });
    expect(out).toMatch(/concurrency: release-group/);
  });

  it("sets a mapping with cancel-in-progress", () => {
    const out = applyAndSave(BASE, {
      kind: "workflow.concurrency.set",
      value: { group: "ci-${{ github.ref }}", cancelInProgress: true },
    });
    expect(out).toMatch(/concurrency:/);
    expect(out).toMatch(/group:/);
    expect(out).toMatch(/cancel-in-progress: true/);
  });

  it("deletes concurrency when value is null", () => {
    const withConc = `name: ci
on: push
concurrency: group-a
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: ":"
`;
    const out = applyAndSave(withConc, {
      kind: "workflow.concurrency.set",
      value: null,
    });
    expect(out).not.toMatch(/concurrency:/);
  });
});
