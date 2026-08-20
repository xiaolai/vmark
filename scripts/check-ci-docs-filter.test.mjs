/**
 * The docs-only path filter, and the two ways it can fail silently.
 *
 * A prose-only PR used to cost ~12 runner-minutes: four sharded test jobs, a
 * coverage merge, two builds and a WebKit run, none of which read a markdown
 * file. The Rust side already skipped correctly; the frontend never got the
 * same treatment.
 *
 * Both failure modes here are silent, which is why they are asserted rather
 * than reviewed:
 *
 *   1. SKIPPING TOO MUCH. There are 50 markdown files under `src/`, including
 *      the markdown-pipeline characterization corpus that round-trip tests read
 *      at RUNTIME. A `!**\/*.md` exclusion would skip the whole app tier on
 *      exactly the change most able to break it, and every check would still be
 *      green. So the exclusion list must be an explicit allowlist, and nothing
 *      under `src/` may appear in it.
 *
 *   2. BLOCKING EVERY MERGE. `frontend` is a REQUIRED check under
 *      `enforce_admins`. Path-filtering its groups without teaching it that
 *      `skipped` is a pass makes every docs PR unmergeable — by anyone,
 *      including the repo owner. The `rust` aggregate has always had that
 *      clause; this asserts the frontend one does too.
 *
 * A third, quieter mode: `predicate-quantifier` must be `some-with-excludes`.
 * Under the default `some`, a file counts if it matches ANY pattern, so `'**'`
 * matches everything, `code` is always true, and the filter is a no-op that
 * still looks wired up — no skipping, no failure, no signal.
 *
 * @coordinates-with .github/workflows/ci.yml
 * @module scripts/check-ci-docs-filter.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ci = parseYaml(readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8"));
const jobs = ci.jobs;

/** Tiers that read no markdown and may skip on a prose-only PR. */
const SKIPPABLE = ["fe-test", "fe-coverage", "fe-servers", "fe-build", "webkit", "bench"];

const filterStep = jobs.changes.steps.find((s) => String(s.uses ?? "").includes("paths-filter"));
const filters = parseYaml(filterStep.with.filters);

describe("CI docs-only path filter", () => {
  it("uses some-with-excludes, without which the filter is a silent no-op", () => {
    expect(filterStep.with["predicate-quantifier"]).toBe("some-with-excludes");
  });

  it("exposes `code` from the changes job", () => {
    expect(jobs.changes.outputs.code).toContain("filter.outputs.code");
  });

  it("guards every skippable tier on `code`, and none of them lost a dependency", () => {
    for (const job of SKIPPABLE) {
      expect(jobs[job].if, `${job} is not guarded`).toBe("needs.changes.outputs.code == 'true'");
      expect(jobs[job].needs, `${job} must depend on changes`).toContain("changes");
    }
    // fe-coverage merges the shards' blob reports; dropping fe-test from its
    // needs while adding `changes` would make the coverage gate race the shards
    // and silently pass on nothing.
    expect(jobs["fe-coverage"].needs).toContain("fe-test");
  });

  it("never skips fe-static, which is what actually checks the prose", () => {
    // lint:emdash scans every *.md and lint:keybinding-manifest reads
    // website/guide/shortcuts.md. If this tier were filtered too, a docs PR
    // would be verified by nothing at all.
    expect(jobs["fe-static"].if).toBeUndefined();
  });

  it("treats `skipped` as a pass in the required frontend check", () => {
    const run = jobs.frontend.steps.map((s) => String(s.run ?? "")).join("\n");
    expect(run).toContain('!= "skipped"');
    // The dead post-loop webkit re-check would `exit 1` on a skipped webkit and
    // undo the tolerance above.
    expect(run).not.toMatch(/if \[ "\$WEBKIT" != "success" \]/);
  });

  it("keeps src/ out of the prose allowlist — the corpus trap", () => {
    const excludes = filters.code.filter((p) => p.startsWith("!"));
    expect(excludes.length).toBeGreaterThan(0);
    for (const e of excludes) {
      expect(e, `${e} would skip tests that read src/ markdown at runtime`).not.toMatch(/(^!src\/|^!\*\*\/\*\.md$)/);
    }
    expect(filters.code).toContain("**"); // something must match, or nothing is ever code
  });

  it("classifies real paths the way the tiers assume", () => {
    // Mirrors `some-with-excludes`: included iff it matches a positive pattern
    // and no negated one. Kept deliberately simple — this is a guard on the
    // ALLOWLIST's shape, not a reimplementation of picomatch.
    const excluded = new Set(filters.code.filter((p) => p.startsWith("!")).map((p) => p.slice(1)));
    const isProse = (f) =>
      excluded.has(f) ||
      [...excluded].some((e) => e.endsWith("/**/*.md") && f.startsWith(e.slice(0, -8)) && f.endsWith(".md"));

    expect(isProse("README.md")).toBe(true);
    expect(isProse("website/guide/shortcuts.md")).toBe(true);
    // The one that matters: a corpus fixture is CODE, so the tests still run.
    expect(isProse("src/utils/markdownPipeline/__tests__/characterization/corpus/02-lists.md")).toBe(false);
    expect(isProse("src/main.tsx")).toBe(false);
    expect(isProse("package.json")).toBe(false);
  });
});
