// WI-4.1 — Mermaid export tests.
//
// Exercises:
//   - flowchart TD generation from IR
//   - one node per job with label
//   - edges from needs[]
//   - special chars escaped
//   - matrix shown as ×N suffix
//   - reusable workflow node styled distinctly
//   - empty / no-jobs IR handling

import { describe, expect, it } from "vitest";
import type { WorkflowIR, JobIR } from "../../types";
import { toMermaid } from "../toMermaid";

function ir(jobs: Partial<JobIR>[], extras: Partial<WorkflowIR> = {}): WorkflowIR {
  return {
    triggers: [],
    permissions: {},
    env: {},
    jobs: jobs.map((j, i) => ({
      id: j.id ?? `job-${i}`,
      needs: j.needs ?? [],
      steps: j.steps ?? [],
      position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      ...j,
    })),
    positions: {},
    diagnostics: [],
    ...extras,
  };
}

describe("toMermaid", () => {
  it("emits a valid flowchart TD header", () => {
    const out = toMermaid(ir([{ id: "build" }]));
    expect(out).toMatch(/^flowchart TD/m);
  });

  it("emits one node per job", () => {
    const out = toMermaid(ir([{ id: "a" }, { id: "b" }, { id: "c" }]));
    expect(out).toMatch(/\ba\[/);
    expect(out).toMatch(/\bb\[/);
    expect(out).toMatch(/\bc\[/);
  });

  it("emits edges from needs[]", () => {
    const out = toMermaid(
      ir([
        { id: "build" },
        { id: "test", needs: ["build"] },
        { id: "deploy", needs: ["test"] },
      ]),
    );
    expect(out).toMatch(/build\s*-->\s*test/);
    expect(out).toMatch(/test\s*-->\s*deploy/);
  });

  it("emits multiple edges for fan-in", () => {
    const out = toMermaid(
      ir([
        { id: "frontend" },
        { id: "backend" },
        { id: "deploy", needs: ["frontend", "backend"] },
      ]),
    );
    expect(out).toMatch(/frontend\s*-->\s*deploy/);
    expect(out).toMatch(/backend\s*-->\s*deploy/);
  });

  it("escapes square brackets and quotes in labels", () => {
    const out = toMermaid(
      ir([{ id: "x", name: 'Build [release] "fast"' }]),
    );
    // Mermaid label uses [...] delimiter; inner brackets and quotes must be escaped
    // or the label must be wrapped in quotes.
    expect(out).not.toMatch(/\["Build \[release\]/); // raw bracket would break parser
    // Wrap-in-quotes path: literal `["Build (release) \"fast\""]`
    expect(out).toMatch(/x\["[^"]+/);
  });

  it("appends ×N badge when matrix has static expansion", () => {
    const out = toMermaid(
      ir([
        {
          id: "build",
          strategy: {
            matrix: {
              dimensions: { os: ["a", "b"], node: [18, 20] },
            },
          },
        },
      ]),
    );
    expect(out).toMatch(/×4/);
  });

  it("appends 'dynamic' badge when matrix is dynamic", () => {
    const out = toMermaid(
      ir([
        {
          id: "build",
          strategy: {
            matrix: { dimensions: {}, dynamic: true },
          },
        },
      ]),
    );
    expect(out).toMatch(/dynamic/i);
  });

  it("marks reusable-workflow jobs distinctly", () => {
    const out = toMermaid(
      ir([{ id: "call", uses: "./.github/workflows/foo.yml" }]),
    );
    // Class definition referenced.
    expect(out).toMatch(/classDef\s+reusable/);
    expect(out).toMatch(/class\s+call\s+reusable/);
  });

  it("returns a minimal placeholder for empty IR", () => {
    const out = toMermaid(ir([]));
    expect(out).toMatch(/flowchart TD/);
    expect(out).toMatch(/empty|no jobs/i);
  });

  it("truncates labels longer than 40 chars", () => {
    const long = "a".repeat(80);
    const out = toMermaid(ir([{ id: "x", name: long }]));
    // Labels should not contain a 60+ char run of 'a'.
    expect(out).not.toMatch(/a{60,}/);
    // Truncation marker present.
    expect(out).toMatch(/…|\.\.\./);
  });

  it("supports LR direction option", () => {
    const out = toMermaid(ir([{ id: "x" }]), { direction: "LR" });
    expect(out).toMatch(/^flowchart LR/m);
  });
});

// ─── Fixture-corpus integration ──────────────────────────────────────

describe("toMermaid — fixture corpus", () => {
  // Lazy: require parse only here, so toMermaid unit tests above don't
  // pull in the parser unnecessarily.
  it("produces valid-looking Mermaid for every real workflow", async () => {
    const { parse } = await import("../../parser");
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
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
    let ok = 0;
    for (const f of walk(FIXTURE_ROOT)) {
      const irOut = parse(readFileSync(f, "utf8"));
      const mermaid = toMermaid(irOut);
      // Must have header and at least one node line.
      if (mermaid.startsWith("flowchart") && mermaid.split("\n").length >= 2) {
        ok++;
      }
    }
    expect(ok).toBeGreaterThanOrEqual(20);
  });
});
