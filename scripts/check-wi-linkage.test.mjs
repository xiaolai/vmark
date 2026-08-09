/**
 * WI-AF1.1 — First test harness for the WI-linkage gate (governance §2's enforcement).
 *
 * Runs the REAL `scripts/check-wi-linkage.sh` as a subprocess against scratch git
 * repositories in tmpdir — init, commit, run. No in-process mocks: the script's
 * whole job is reading a plan, a commit range and a test tree, and a fake for any
 * of those would be testing the fake.
 *
 * This file lands BEFORE the grammar changes it guards (WI-AF1.2/AF1.3/AF1.5). The
 * script carries a governance §9 notice: widening its grammar once already
 * produced a FALSE GREEN (2026-07-14 — a plan whose namespace it could not parse
 * exited 0). The fail-closed property is pinned here first so the next widening
 * cannot quietly undo it.
 *
 * Semantics pinned:
 *   - a WI links via a commit message ONLY in the documented trailing-tag form
 *     `(WI-1.2)`, not by a bare mention. A commit that DESCRIBES a work item is
 *     not evidence the work happened — found live on 2026-08-09 (F6), when this
 *     branch's own commit message discussed the WI-16 defect and the gate
 *     promptly reported WI-16 linked;
 *   - a WI links via a top-of-file comment in a test file, in ANY of the repo's
 *     four test roots — src/, src-tauri/src/, scripts/, .claude/hooks/. The
 *     gates tier was invisible before WI-AF1.2, so WI-16, whose only test lives in
 *     scripts/, read as unlinked while being correctly linked;
 *   - work-item IDs are read from DECLARATIONS ONLY — headings, bold list items,
 *     bold standalone, table rows. Prose that mentions an ID declares nothing.
 *     The predecessor plan quotes "WI-1.6 live-webview cap enforced" inside
 *     another item's description, and the gate demanded linkage for a work item
 *     that does not exist;
 *   - every ID shape the repo actually uses keeps parsing: WI-1, WI-1.2,
 *     WI-VC0.1, WI-S1.3, WI-SOC.2, trailing-letter suffixes;
 *   - zero parseable work items FAILS CLOSED. A gate that can see no work must
 *     never report success.
 *
 * @coordinates-with .claude/rules/60-ai-governance.md §2 — the linkage contract
 */
import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-wi-linkage.sh");

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0 && cmd === "git") {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r;
}

function file(root, rel, body) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

/**
 * A scratch repo with a `main` branch and a feature branch, because the script
 * resolves its commit range from the merge-base with main. Returns the root.
 *
 * The script does `cd "$(dirname "$0")/.."`, so it always operates on ITS OWN
 * repository root — passing a different cwd does nothing. It is therefore
 * SYMLINKED into the scratch repo at scripts/, which makes `$0`'s directory the
 * scratch tree while the bytes executed remain the real script's. A copy would
 * drift the day the script grows a dependency; a `--root` flag would add
 * production surface that exists only for tests.
 *
 * `plan` is written to dev-plan.md; `commits` are subjects committed on the
 * feature branch; `tests` is a {relpath: contents} map written before the last
 * commit so they are part of the tree the script scans.
 */
function scratchRepo({ plan, commits = [], tests = {} }) {
  const root = mkdtempSync(path.join(tmpdir(), "wi-linkage-"));
  sh(root, "git", ["init", "-q", "-b", "main"]);
  sh(root, "git", ["config", "user.email", "t@example.com"]);
  sh(root, "git", ["config", "user.name", "t"]);
  file(root, "README.md", "seed\n");
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-qm", "seed"]);
  sh(root, "git", ["checkout", "-qb", "feature"]);

  mkdirSync(path.join(root, "scripts"), { recursive: true });
  symlinkSync(SCRIPT, path.join(root, "scripts", "check-wi-linkage.sh"));

  file(root, "dev-plan.md", plan);
  for (const [rel, body] of Object.entries(tests)) file(root, rel, body);
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-qm", commits[0] ?? "chore: plan and tests"]);
  for (const subject of commits.slice(1)) {
    sh(root, "git", ["commit", "-q", "--allow-empty", "-m", subject]);
  }
  return root;
}

function runGate(root, args = ["dev-plan.md"]) {
  return spawnSync("bash", [path.join(root, "scripts", "check-wi-linkage.sh"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

/** Parse the "WIs found: N  linked: L  unlinked: U" summary line. */
function summary(stdout) {
  const m = stdout.match(/WIs found: *(\d+) *linked: *(\d+) *unlinked: *(\d+)/);
  return m ? { found: +m[1], linked: +m[2], unlinked: +m[3] } : null;
}

describe("invocation", () => {
  it("exits 64 with no plan argument", () => {
    const r = spawnSync("bash", [SCRIPT], { cwd: REPO, encoding: "utf8" });
    expect(r.status).toBe(64);
  });

  it("exits 64 when the plan file does not exist", () => {
    const r = spawnSync("bash", [SCRIPT, "no-such-plan.md"], { cwd: REPO, encoding: "utf8" });
    expect(r.status).toBe(64);
    expect(r.stdout + r.stderr).toMatch(/not found/i);
  });
});

describe("fail-closed on zero parseable work items (governance §9, 2026-07-14)", () => {
  it("a plan with no work items exits 1, never 0", () => {
    const root = scratchRepo({ plan: "# A plan\n\nProse only. No work items here.\n" });
    const r = runGate(root);
    expect(r.status, r.stdout).toBe(1);
    expect(r.stdout).toMatch(/no WI-IDs/i);
  });

  it("a plan whose IDs appear ONLY in prose still exits 1 — prose is not a declaration", () => {
    const root = scratchRepo({
      plan: "# A plan\n\nWe fixed the thing WI-4 broke, and WI-5 tracked it.\n",
    });
    const r = runGate(root);
    expect(r.status, r.stdout).toBe(1);
  });
});

describe("declarations, not prose (WI-AF1.3 / ADR-2)", () => {
  it("extracts a heading declaration and ignores a foreign ID quoted in prose", () => {
    const root = scratchRepo({
      plan: [
        "# Plan",
        "",
        "## WI-1",
        "",
        'The old gate ran its test under the label "WI-9.6 cap enforced", which was fiction.',
        "",
        "## WI-2",
        "",
      ].join("\n"),
      commits: ["chore: plan", "fix(a): thing (WI-1)", "fix(b): thing (WI-2)"],
    });
    const r = runGate(root);
    expect(summary(r.stdout)).toEqual({ found: 2, linked: 2, unlinked: 0 });
    expect(r.stdout).not.toMatch(/WI-9\.6/);
    expect(r.status).toBe(0);
  });

  it.each([
    ["ATX h2", "## WI-1\n"],
    ["ATX h3 with colon", "### WI-1: the title\n"],
    ["ATX h4 with em-dash", "#### WI-1 — the title\n"],
    ["bold list item", "- **WI-1** the title\n"],
    ["bold standalone with em-dash", "**WI-1 — the title**\n"],
    ["table row", "| WI-1 | the title |\n"],
  ])("recognises a %s declaration", (_label, decl) => {
    const root = scratchRepo({
      plan: `# Plan\n\n${decl}\n`,
      commits: ["chore: plan", "fix(a): thing (WI-1)"],
    });
    const r = runGate(root);
    expect(summary(r.stdout), r.stdout).toEqual({ found: 1, linked: 1, unlinked: 0 });
  });

  it("does NOT treat a bold prose bullet as a declaration", () => {
    // The near-miss that matters: a Risks section bullet naming a work item.
    // `- **WI-2.1 has unbounded cost.**` is prose about WI-2.1, not its
    // declaration — this plan's own Risks section is full of them.
    const root = scratchRepo({
      plan: [
        "# Plan",
        "",
        "## WI-1",
        "",
        "## Risks",
        "",
        "- **WI-2.1 has unbounded cost.** A first-ever run can fail for many reasons.",
        "- **WI-3.4 is as risky as WI-2.1** for a different reason.",
        "",
      ].join("\n"),
      commits: ["chore: plan", "fix(a): thing (WI-1)"],
    });
    const r = runGate(root);
    expect(summary(r.stdout), r.stdout).toEqual({ found: 1, linked: 1, unlinked: 0 });
  });

  it("ignores declarations inside fenced code blocks", () => {
    const root = scratchRepo({
      plan: ["# Plan", "", "## WI-1", "", "```md", "## WI-7", "```", ""].join("\n"),
      commits: ["chore: plan", "fix(a): thing (WI-1)"],
    });
    const r = runGate(root);
    expect(summary(r.stdout), r.stdout).toEqual({ found: 1, linked: 1, unlinked: 0 });
  });

  it("collapses a duplicate declaration to one work item", () => {
    const root = scratchRepo({
      plan: "# Plan\n\n## WI-1\n\n| WI-1 | restated in a status table |\n",
      commits: ["chore: plan", "fix(a): thing (WI-1)"],
    });
    const r = runGate(root);
    expect(summary(r.stdout), r.stdout).toEqual({ found: 1, linked: 1, unlinked: 0 });
  });
});

describe("ID shapes the repo actually uses keep parsing", () => {
  it.each(["WI-1", "WI-12", "WI-1.2", "WI-10.3", "WI-VC0.1", "WI-S1.3", "WI-SOC.2"])(
    "%s",
    (id) => {
      const root = scratchRepo({
        plan: `# Plan\n\n## ${id}\n`,
        commits: ["chore: plan", `fix(a): thing (${id})`],
      });
      const r = runGate(root);
      expect(summary(r.stdout), r.stdout).toEqual({ found: 1, linked: 1, unlinked: 0 });
    },
  );
});

describe("commit linkage requires the documented tag form (WI-AF1.5 / F6)", () => {
  it("links on a trailing (WI-N) tag", () => {
    const root = scratchRepo({
      plan: "# Plan\n\n## WI-1\n",
      commits: ["chore: plan", "feat(scope): do the thing (WI-1)"],
    });
    expect(runGate(root).status).toBe(0);
  });

  it("links every ID in a comma-separated tag", () => {
    const root = scratchRepo({
      plan: "# Plan\n\n## WI-1\n\n## WI-2\n\n## WI-3\n",
      commits: ["chore: plan", "feat(scope): three at once (WI-1, WI-2, WI-3)"],
    });
    const r = runGate(root);
    expect(summary(r.stdout), r.stdout).toEqual({ found: 3, linked: 3, unlinked: 0 });
  });

  it("does NOT link on a bare mention in the subject", () => {
    const root = scratchRepo({
      plan: "# Plan\n\n## WI-1\n",
      commits: ["chore: plan", "docs: explain why WI-1 is still broken"],
    });
    const r = runGate(root);
    expect(r.status, r.stdout).toBe(1);
    expect(summary(r.stdout)).toEqual({ found: 1, linked: 0, unlinked: 1 });
  });

  it("does NOT link on a bare mention in the body — the F6 reproducer", () => {
    // Verbatim shape of the commit that exposed this: a message DESCRIBING the
    // defect made the gate report the work item as done.
    const root = scratchRepo({
      plan: "# Plan\n\n## WI-16\n",
      commits: [
        "chore: plan",
        "docs(plan): record the findings\n\ncheck-wi-linkage.sh cannot see the gates tier,\nso WI-16 reads as unlinked.",
      ],
    });
    const r = runGate(root);
    expect(r.status, r.stdout).toBe(1);
    expect(summary(r.stdout)).toEqual({ found: 1, linked: 0, unlinked: 1 });
  });
});

describe("test-header linkage across ALL four test roots (WI-AF1.2)", () => {
  it.each([
    ["src", "src/foo/thing.test.ts", "// WI-1 — thing behaviour\n"],
    ["src-tauri", "src-tauri/src/thing.test.rs", "//! WI-1 — thing behaviour\n"],
    ["scripts (gates tier)", "scripts/check-thing.test.mjs", "/**\n * WI-1 — gate behaviour.\n */\n"],
    [".claude/hooks (gates tier)", ".claude/hooks/guard.test.mjs", "// WI-1 — hook behaviour\n"],
  ])("links from %s", (_label, rel, body) => {
    const root = scratchRepo({
      plan: "# Plan\n\n## WI-1\n",
      commits: ["chore: plan with no tag"],
      tests: { [rel]: body },
    });
    const r = runGate(root);
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toMatch(/WI-1 linked \(test\)/);
  });

  it("ignores an ID that appears below the header window", () => {
    const filler = Array.from({ length: 40 }, (_, i) => `// line ${i}`).join("\n");
    const root = scratchRepo({
      plan: "# Plan\n\n## WI-1\n",
      commits: ["chore: plan with no tag"],
      tests: { "scripts/late.test.mjs": `${filler}\n// WI-1 — mentioned too late\n` },
    });
    expect(runGate(root).status, "an ID deep in a file is not a header").toBe(1);
  });
});

describe("--phase filter", () => {
  it("checks only the requested phase's work items", () => {
    const root = scratchRepo({
      plan: "# Plan\n\n## WI-1.1\n\n## WI-1.2\n\n## WI-2.1\n",
      commits: ["chore: plan", "feat(a): phase one (WI-1.1, WI-1.2)"],
    });
    const r = runGate(root, ["dev-plan.md", "--phase=1"]);
    expect(r.status, r.stdout).toBe(0);
    expect(summary(r.stdout)).toEqual({ found: 2, linked: 2, unlinked: 0 });
  });

  it("fails closed when the phase filter matches no work items", () => {
    const root = scratchRepo({ plan: "# Plan\n\n## WI-1.1\n" });
    const r = runGate(root, ["dev-plan.md", "--phase=9"]);
    expect(r.status, r.stdout).toBe(1);
  });
});

describe("the real repository", () => {
  let out;
  beforeAll(() => {
    out = spawnSync(
      "bash",
      [SCRIPT, ".claude/tdd-guardian/plan-20260803-161713.md"],
      { cwd: REPO, encoding: "utf8" },
    ).stdout;
  });

  it("extracts exactly 21 work items from the predecessor plan, not 22", () => {
    // The 22nd was "WI-1.6", quoted as prose inside WI-6's description.
    expect(summary(out)?.found, out).toBe(21);
  });

  it("does not report the phantom WI-1.6", () => {
    expect(out).not.toMatch(/WI-1\.6/);
  });
});
