/**
 * WI-AF0.1, WI-AF0.2 — DoD checker for the architecture-review follow-ups plan.
 *
 * WI-AF0.2 (the mandatory cross-model review) is asserted here too: phase 0
 * requires a real Codex thread id recorded in the plan, and the fixture uses a
 * hex id because the assertion is "a review happened", not "the word appears".
 *
 * Runs the REAL `scripts/check-followups-phase.sh` as a subprocess against
 * FIXTURE repo trees in tmpdir (house pattern: real script, real fs, no
 * in-process mocks). The script takes `--root=<dir>` precisely so this is
 * possible — a DoD checker that can only ever inspect the one working tree it
 * lives in cannot be tested in both directions, and a gate proven in one
 * direction is a gate that has only been proven to say yes.
 *
 * Semantics pinned here (the DoD contract):
 *   - a phase whose deliverables are absent reports NOT STARTED and exits
 *     NON-ZERO. This is the `check-wi-linkage.sh` lesson: its zero-match branch
 *     used to exit 0, so a plan whose namespace it could not parse "passed".
 *     An unstarted phase is not a satisfied phase;
 *   - a phase whose deliverables are all present AND all verified exits 0;
 *   - a PARTIALLY complete phase exits non-zero and names the missing pieces —
 *     it must never round up to done;
 *   - a phase whose behavioral assertions were SKIPPED reports UNVERIFIED and
 *     exits non-zero. Present-on-disk is not the same claim as property-holds,
 *     and conflating them is how a checker certifies work nobody did;
 *   - `all` is the conjunction: exit 0 only when every phase does;
 *   - an unknown phase argument, or none, exits 64 (bad invocation), distinct
 *     from 1 (assertions failed), so a typo can never read as a failure verdict
 *     and a script error can never read as a pass.
 *
 * @coordinates-with .claude/tdd-guardian/plan-20260809-followups.md — the phases asserted
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-followups-phase.sh");

/** Run the real script against a fixture root. */
function run(root, phase) {
  return spawnSync("bash", [SCRIPT, phase, `--root=${root}`], {
    encoding: "utf8",
    cwd: REPO,
  });
}

/**
 * APPENDS when the file already exists. Two phases legitimately deliver into
 * one file (the governance rules gain §13 in phase 4 and a reconciled §1 in
 * phase 5); overwriting would let the later phase silently un-satisfy the
 * earlier one, and the `all` case would then fail for a fixture reason rather
 * than a real one.
 */
function write(root, rel, body = "placeholder\n") {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  if (existsSync(abs)) appendFileSync(abs, body);
  else writeFileSync(abs, body);
  return abs;
}

/** An empty fixture tree: nothing delivered, every phase NOT STARTED. */
function emptyRoot() {
  return mkdtempSync(path.join(tmpdir(), "followups-dod-"));
}

/**
 * Deliverables per phase, as the fixture files that satisfy them. Kept as data
 * so a phase gaining a deliverable updates one list, and so the "partial"
 * cases below can drop exactly one entry rather than hand-rolling a tree.
 */
const DELIVERABLES = {
  0: [
    // A real Codex thread id is hex — the fixture uses one, because the
    // assertion is "a review actually happened", not "the word appears".
    [".claude/tdd-guardian/plan-20260809-followups.md", "Review thread: `019fdb16-545a`\n"],
    ["scripts/check-followups-phase.sh", "#!/usr/bin/env bash\n"],
    ["scripts/check-followups-phase.test.mjs", "// test\n"],
  ],
  1: [
    ["scripts/check-wi-linkage.test.mjs", "// WI-AF1.1\n"],
    // F6: the commit half must require the documented trailing-tag form.
    ["scripts/check-wi-linkage.sh", "COMMIT_TAG_RE='\\\\(WI-'\n"],
  ],
  2: [
    ["scripts/check-gate-liveness.mjs", "// liveness\n"],
    ["scripts/check-gate-liveness.test.mjs", "// test\n"],
    [".github/workflows/gate-liveness.yml", "name: Gate liveness\n"],
    [
      ".github/workflows/tier0-e2e.yml",
      "name: Tier-0 E2E Journeys\n# First green run: 12345678901 @ deadbeefdeadbeefdeadbeefdeadbeefdeadbeef (2026-08-09)\n",
    ],
  ],
  3: [
    ["scripts/baseline-review-schedule.json", '{ "tracked": {} }\n'],
    ["scripts/check-review-schedule.mjs", "// validator\n"],
    ["scripts/check-review-schedule.test.mjs", "// test\n"],
    ["scripts/baselineRatchetManifest.mjs", 'path: "scripts/baseline-review-schedule.json"\n'],
    [".github/workflows/baseline-review.yml", "name: Baseline review\n"],
    // Present AND free of the stale count. A negative assertion that a MISSING
    // file would satisfy is not an assertion — the file has to exist for
    // "no longer quotes 153" to mean anything.
    [
      ".claude/rules/00-engineering-principles.md",
      "freezes the pre-existing violators listed in scripts/file-size-baseline.json\n",
    ],
  ],
  4: [
    ["scripts/check-change-size.mjs", "#!/usr/bin/env node\n"],
    ["scripts/check-change-size.test.mjs", "// test\n"],
    [".github/workflows/ci.yml", "run: node scripts/check-change-size.mjs\n"],
    [".claude/rules/60-ai-governance.md", "## 13. Change size is a decision\n"],
  ],
  5: [
    ["dev-docs/README.md", "# dev-docs index\n"],
    [
      ".claude/rules/60-ai-governance.md",
      "Plans live in `dev-docs/plans/` or `.claude/tdd-guardian/`.\n",
    ],
    // AGENTS.md:303 carries the same mandate; amending one authority and not
    // the other leaves the repo contradicting itself (review 019fe450, Dim 1 #5).
    ["AGENTS.md", "Plans live in `dev-docs/plans/` or `.claude/tdd-guardian/`.\n"],
  ],
};

/** Build a fixture root satisfying every listed phase. */
function rootSatisfying(phases) {
  const root = emptyRoot();
  for (const p of phases) {
    for (const [rel, body] of DELIVERABLES[p]) write(root, rel, body);
  }
  return root;
}

describe("check-followups-phase.sh — invocation", () => {
  it("exits 64 with no phase argument", () => {
    const r = spawnSync("bash", [SCRIPT], { encoding: "utf8", cwd: REPO });
    expect(r.status).toBe(64);
    expect(r.stdout + r.stderr).toMatch(/Usage/i);
  });

  it("exits 64 on an unknown phase, NOT 1 — a typo is not a verdict", () => {
    const r = run(emptyRoot(), "9");
    expect(r.status).toBe(64);
    expect(r.stdout + r.stderr).toMatch(/unknown phase/i);
  });

  it("exits 64 when --root points at nothing", () => {
    const r = spawnSync(
      "bash",
      [SCRIPT, "1", `--root=${path.join(tmpdir(), "definitely-not-here-9f3a")}`],
      { encoding: "utf8", cwd: REPO },
    );
    expect(r.status).toBe(64);
  });
});

describe("check-followups-phase.sh — an unstarted phase never passes", () => {
  for (const phase of [1, 2, 3, 4, 5]) {
    it(`phase ${phase}: empty tree reports NOT STARTED and exits non-zero`, () => {
      const r = run(emptyRoot(), String(phase));
      expect(r.status, `phase ${phase} exit`).not.toBe(0);
      expect(r.stdout).toMatch(/NOT STARTED/);
    });
  }
});

/**
 * Phases whose DoD is entirely file/text shaped can reach DONE in a fixture.
 * Phases carrying REAL-ROOT assertions cannot, and must not — see the
 * UNVERIFIED suite below. Splitting them is the point: "every deliverable is
 * present" and "the phase's property holds" are different claims.
 */
const FIXTURE_PROVABLE = [0, 4, 5];
const NEEDS_REAL_ROOT = [1, 2, 3];

describe("check-followups-phase.sh — a fully file-shaped phase passes", () => {
  for (const phase of FIXTURE_PROVABLE) {
    it(`phase ${phase}: all deliverables present exits 0`, () => {
      const r = run(rootSatisfying([phase]), String(phase));
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).not.toMatch(/NOT STARTED|UNVERIFIED/);
    });
  }
});

describe("check-followups-phase.sh — skipped is UNVERIFIED, never DONE", () => {
  // The defect this suite exists for: with its behavioral assertions skipped,
  // the checker used to print DONE and exit 0 — a green verdict over work
  // nobody performed, in the very script written to police that class.
  // Cross-model review 019fe450 (Dim 2 #2) caught it.
  for (const phase of NEEDS_REAL_ROOT) {
    it(`phase ${phase}: every deliverable present but REAL-ROOT skipped → UNVERIFIED, non-zero`, () => {
      const r = run(rootSatisfying([phase]), String(phase));
      expect(r.status, r.stdout + r.stderr).not.toBe(0);
      expect(r.stdout).toMatch(/UNVERIFIED/);
      expect(r.stdout).not.toMatch(/DONE/);
    });
  }
});

describe("check-followups-phase.sh — a partial phase never rounds up", () => {
  it("phase 2 with the liveness gate but no recorded tier0 run fails", () => {
    const root = emptyRoot();
    // Everything except the tier0-e2e header carrying a real run ID — the
    // finding F1 exists to close. A workflow FILE is not a workflow VERDICT.
    for (const [rel, body] of DELIVERABLES[2]) {
      if (rel.endsWith("tier0-e2e.yml")) {
        write(root, rel, "name: Tier-0 E2E Journeys\n# its first live run is a workflow_dispatch\n");
      } else {
        write(root, rel, body);
      }
    }
    const r = run(root, "2");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/tier0/i);
  });

  it("phase 4 with the script but no CI wiring fails", () => {
    const root = emptyRoot();
    write(root, "scripts/check-change-size.mjs", "#!/usr/bin/env node\n");
    write(root, "scripts/check-change-size.test.mjs", "// test\n");
    write(root, ".github/workflows/ci.yml", "name: CI\n"); // present, does not invoke the gate
    const r = run(root, "4");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/ci\.yml/i);
  });

  it("phase 5 with the index but an unreconciled §1 fails", () => {
    const root = emptyRoot();
    write(root, "dev-docs/README.md", "# index\n");
    write(root, ".claude/rules/60-ai-governance.md", "Plans live in `dev-docs/plans/`.\n");
    const r = run(root, "5");
    expect(r.status).not.toBe(0);
  });
});

describe("check-followups-phase.sh — `all`", () => {
  it("exits non-zero while any phase is unstarted", () => {
    const r = run(rootSatisfying([1]), "all");
    expect(r.status).not.toBe(0);
  });

  it("reports every phase in one pass, not just the first failure", () => {
    const r = run(emptyRoot(), "all");
    for (const phase of [1, 2, 3, 4, 5]) {
      expect(r.stdout, `phase ${phase} absent from report`).toMatch(
        new RegExp(`Phase ${phase}`),
      );
    }
  });

  it("never exits 0 from a fixture root, however complete — REAL-ROOT work is unproven there", () => {
    const r = run(rootSatisfying([0, 1, 2, 3, 4, 5]), "all");
    expect(r.status, r.stdout + r.stderr).not.toBe(0);
    expect(r.stdout).toMatch(/UNVERIFIED/);
  });
});

describe("check-followups-phase.sh — phase 5 and the gitignored index", () => {
  it("treats a tree with no dev-docs/ as UNVERIFIED, not satisfied", () => {
    const root = emptyRoot();
    write(root, ".claude/rules/60-ai-governance.md", "`.claude/tdd-guardian` is a plan home\n");
    write(root, "AGENTS.md", "plans may live in `.claude/tdd-guardian/`\n");
    const r = run(root, "5");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/UNVERIFIED/);
  });

  it("fails when dev-docs/ exists but carries no index", () => {
    const root = emptyRoot();
    mkdirSync(path.join(root, "dev-docs"), { recursive: true });
    write(root, "dev-docs/plans/x.md", "a plan\n");
    write(root, ".claude/rules/60-ai-governance.md", "`.claude/tdd-guardian` is a plan home\n");
    write(root, "AGENTS.md", "plans may live in `.claude/tdd-guardian/`\n");
    const r = run(root, "5");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/README\.md/);
  });
});
