/**
 * GitHub Actions Workflow Benchmarks
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md §6 Phase 9.
 *
 * Measures the load-bearing operations on the workflow read + edit
 * paths against a synthetic 100-job fixture. The plan's targets:
 *
 *   - Parse:        < 50ms
 *   - toGraph:      < 200ms (initial render proxy — actual xyflow
 *                   render is webkit-side and not measured here)
 *   - Edit patch:   < 16ms (one frame)
 *   - CST save:     < 50ms (parse + apply N patches + stringify)
 *
 * Run: pnpm bench src/bench/workflow.bench.ts
 *
 * @module bench/workflow
 */

import { bench, describe } from "vitest";
import { parse } from "@/lib/ghaWorkflow/parser";
import { toGraph } from "@/lib/ghaWorkflow/render/toGraph";
import {
  parseAsCst,
  stringifyCst,
} from "@/lib/ghaWorkflow/save/cstParser";
import { applyPatch, type IRPatch } from "@/lib/ghaWorkflow/save/mutators";

/** Synthesize a workflow YAML with N jobs in a fan-out + fan-in shape. */
function generateWorkflowYaml(jobCount: number): string {
  const lines: string[] = [
    "name: bench",
    "on: push",
    "jobs:",
    "  prepare:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: pnpm install",
  ];
  // Middle jobs all need prepare and have a few steps each.
  for (let i = 0; i < jobCount - 2; i++) {
    lines.push(`  job-${i}:`);
    lines.push("    runs-on: ubuntu-latest");
    lines.push("    needs: prepare");
    lines.push("    steps:");
    lines.push("      - uses: actions/checkout@v4");
    lines.push(`      - run: pnpm test --filter pkg-${i}`);
    lines.push(`      - if: failure()`);
    lines.push(`        run: echo "job-${i} failed"`);
  }
  // Tail job depends on everyone.
  const allDeps = Array.from({ length: jobCount - 2 }, (_, i) => `job-${i}`);
  lines.push("  finalize:");
  lines.push("    runs-on: ubuntu-latest");
  lines.push(`    needs: [${allDeps.join(", ")}]`);
  lines.push("    steps:");
  lines.push("      - run: echo done");
  return lines.join("\n") + "\n";
}

const yaml100 = generateWorkflowYaml(100);
const ir100 = parse(yaml100);

const editPatches: IRPatch[] = [
  { kind: "workflow.set", path: "name", value: "renamed" },
  {
    kind: "job.set",
    jobId: "prepare",
    path: "runs-on",
    value: "ubuntu-22.04",
  },
  { kind: "job.set", jobId: "job-50", path: "if", value: "github.event_name == 'push'" },
  {
    kind: "with.set",
    jobId: "prepare",
    stepIndex: 0,
    key: "fetch-depth",
    value: "0",
  },
  { kind: "needs.add", jobId: "job-99", ref: "job-0" },
];

describe("parse — IR construction", () => {
  bench("100-job workflow → IR", () => {
    parse(yaml100);
  });
});

describe("toGraph — render adapter", () => {
  bench("100-job IR → nodes + edges", () => {
    toGraph(ir100);
  });
});

describe("CST round-trip — save pipeline", () => {
  bench("parseAsCst + stringifyCst (no patches)", () => {
    stringifyCst(parseAsCst(yaml100));
  });

  bench("parseAsCst + 5 patches + stringifyCst", () => {
    const doc = parseAsCst(yaml100);
    for (const p of editPatches) applyPatch(doc, p);
    stringifyCst(doc);
  });
});

describe("single-patch latency", () => {
  // Parse once outside the bench to isolate patch cost.
  const doc = parseAsCst(yaml100);
  bench("applyPatch (single)", () => {
    applyPatch(doc, {
      kind: "job.set",
      jobId: "job-25",
      path: "runs-on",
      value: "macos-latest",
    });
  });
});
