/**
 * WI-DP0.1 — DoD checker for the baseline debt paydown plan.
 *
 * Runs the REAL `scripts/check-paydown-phase.sh` against fixture trees. Same
 * contract as its predecessor (`check-followups-phase.test.mjs`), including the
 * lesson that produced it: a phase whose assertions were SKIPPED must report
 * UNVERIFIED, never DONE. A checker that reports green over work nobody checked
 * is the defect this whole line of work exists to delete.
 *
 * The phases here assert against the REAL baseline files rather than a counter
 * of their own (plan ADR-1). A second definition of "how much debt is left" can
 * disagree with the gate's, and then neither is trusted — so the DoD reads
 * exactly what `pnpm lint:*` reads.
 *
 * @coordinates-with .claude/tdd-guardian/plan-20260809-debt-paydown.md
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-paydown-phase.sh");

function run(root, phase) {
  return spawnSync("bash", [SCRIPT, phase, `--root=${root}`], { encoding: "utf8", cwd: REPO });
}

function write(root, rel, body) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

function emptyRoot() {
  return mkdtempSync(path.join(tmpdir(), "paydown-dod-"));
}

/** A fixture tree whose baselines carry the given counts. */
// `named` + `styled` are the TWO budgets bespoke-buttons carries (88 by name,
// 80 by usage). An earlier fixture collapsed them into one number, which made
// the phase-4 case untestable — the assertion was right and the model was wrong.
function rootWith({ knip = 75, mergeDrops = 2, commandErrors = 99, mocks = 274, named = 88, styled = 80 }) {
  const root = emptyRoot();
  write(root, ".claude/tdd-guardian/plan-20260809-debt-paydown.md", "Review thread: `019fdb16`\n");
  write(root, "scripts/check-paydown-phase.sh", "#!/usr/bin/env bash\n");
  write(root, "scripts/check-paydown-phase.test.mjs", "// test\n");
  write(root, "scripts/baseline-review-schedule.json", '{ "tracked": {}, "exempt": {} }\n');

  write(root, "scripts/knip-baseline.json", JSON.stringify({ exports: knip, types: 0 }));
  const drops = { _comment: "docs" };
  for (let i = 0; i < mergeDrops; i += 1) drops[`src/f${i}.ts`] = "relocated";
  write(root, "scripts/merge-drop-allowlist.json", JSON.stringify(drops));
  write(
    root,
    "scripts/command-error-baseline.json",
    JSON.stringify({ files: commandErrors > 0 ? { "a.rs": commandErrors } : {} }),
  );
  write(
    root,
    "scripts/mock-boundaries-baseline.json",
    JSON.stringify({
      entries: Array.from({ length: mocks }, (_, i) => ({
        file: `f${i}.test.ts`,
        api: "vi.mock",
        target: "src/stores/tabStore",
      })),
    }),
  );
  write(
    root,
    "scripts/bespoke-buttons-baseline.json",
    JSON.stringify({ maxBespokeButtonClasses: named, maxStyledButtonClasses: styled }),
  );
  return root;
}

describe("invocation", () => {
  it("exits 64 with no phase", () => {
    const r = spawnSync("bash", [SCRIPT], { encoding: "utf8", cwd: REPO });
    expect(r.status).toBe(64);
  });

  it("exits 64 on an unknown phase — a typo is not a verdict", () => {
    const r = run(emptyRoot(), "9");
    expect(r.status).toBe(64);
  });
});

describe("an unstarted phase never passes", () => {
  for (const phase of [1, 2, 3, 4]) {
    it(`phase ${phase}: nothing present reports NOT STARTED`, () => {
      const r = run(emptyRoot(), String(phase));
      expect(r.status, `phase ${phase}`).not.toBe(0);
      expect(r.stdout).toMatch(/NOT STARTED/);
    });
  }
});

describe("a phase is done when the real baseline says so (ADR-1)", () => {
  it("phase 1 fails while knip and merge-drops still carry debt", () => {
    const r = run(rootWith({}), "1");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/knip/i);
  });

  it("phase 1 passes once both reach zero", () => {
    const r = run(rootWith({ knip: 0, mergeDrops: 0 }), "1");
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("phase 2 fails at 99 and passes at 0", () => {
    expect(run(rootWith({}), "2").status).toBe(1);
    expect(run(rootWith({ commandErrors: 0 }), "2").status, "at zero").toBe(0);
  });

  it("phase 3 fails at 274 and passes at 0", () => {
    expect(run(rootWith({}), "3").status).toBe(1);
    expect(run(rootWith({ mocks: 0 }), "3").status, "at zero").toBe(0);
  });

  it("phase 4 requires the budget to have come DOWN, not merely exist", () => {
    // 168 is today's reality; "down" means below it. A phase that passes at the
    // starting number would certify doing nothing.
    expect(run(rootWith({}), "4").status).toBe(1);
    expect(run(rootWith({ named: 80, styled: 70 }), "4").status, "lowered").toBe(0);
  });
});

describe("partial progress does not round up", () => {
  it("phase 3 with most mocks gone still fails", () => {
    const r = run(rootWith({ mocks: 12 }), "3");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/12/);
  });
});

describe("`all`", () => {
  it("reports every phase in one pass", () => {
    const r = run(emptyRoot(), "all");
    for (const p of [1, 2, 3, 4]) expect(r.stdout).toMatch(new RegExp(`Phase ${p}`));
  });

  it("exits non-zero while any phase is incomplete", () => {
    expect(run(rootWith({}), "all").status).not.toBe(0);
  });
});
