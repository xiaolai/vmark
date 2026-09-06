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
import { spawnSync } from "node:child_process";

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

  /**
   * Run an aggregate job's own shell block with a given set of job results.
   *
   * EXECUTED rather than grepped. The previous version of this test asserted
   * that the script contained the substring `!= "skipped"`, which is a claim
   * about spelling, not behavior — and the behavior it was standing in for was
   * wrong: the script accepted `skipped` from ANY job whether or not the filter
   * had actually excluded it (audit 20260906, C1).
   */
  function runAggregate(job, env) {
    const script = jobs[job].steps.map((s) => String(s.run ?? "")).join("\n");
    return spawnSync("bash", ["-c", script], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    }).status;
  }

  const ALL_SKIPPED = {
    STATIC: "success",
    TESTS: "skipped",
    COVERAGE: "skipped",
    SERVERS: "skipped",
    BUILD: "skipped",
    WEBKIT: "skipped",
    WEBSITE: "skipped",
    WEBSITE_TOUCHED: "false",
  };
  const ALL_GREEN = {
    STATIC: "success",
    TESTS: "success",
    COVERAGE: "success",
    SERVERS: "success",
    BUILD: "success",
    WEBKIT: "success",
    WEBSITE: "success",
    WEBSITE_TOUCHED: "true",
  };

  describe("the required `frontend` aggregate", () => {
    // The defect: if the filter job fails, every dependent tier skips, and the
    // aggregate used to read each skip as a pass — reporting green having run
    // no tests at all, as a required check under `enforce_admins`.
    it("fails when the change filter did not succeed", () => {
      expect(runAggregate("frontend", { CHANGES: "failure", CODE: "", ...ALL_SKIPPED }))
        .not.toBe(0);
    });

    it("fails when the change filter was cancelled", () => {
      expect(runAggregate("frontend", { CHANGES: "cancelled", CODE: "true", ...ALL_SKIPPED }))
        .not.toBe(0);
    });

    // A filter that succeeded but emitted something unusable cannot excuse a
    // skip either — an empty or malformed output is not `false`.
    it("fails when the filter output is not a boolean", () => {
      expect(runAggregate("frontend", { CHANGES: "success", CODE: "garbage", ...ALL_SKIPPED }))
        .not.toBe(0);
      expect(runAggregate("frontend", { CHANGES: "success", CODE: "", ...ALL_SKIPPED }))
        .not.toBe(0);
    });

    // The other half, and the reason the tolerance exists at all: `frontend` is
    // required under `enforce_admins`, so a genuine prose PR must be mergeable.
    it("passes a genuine docs-only PR", () => {
      expect(runAggregate("frontend", { CHANGES: "success", CODE: "false", ...ALL_SKIPPED }))
        .toBe(0);
    });

    it("passes an ordinary code PR with every tier green", () => {
      expect(runAggregate("frontend", { CHANGES: "success", CODE: "true", ...ALL_GREEN }))
        .toBe(0);
    });

    // A tier that vanishes on a CODE change is the failure the whole gate is
    // for: the filter said these tiers apply, so a skip is a missing gate.
    it("fails when a tier skips on a code PR", () => {
      expect(
        runAggregate("frontend", {
          CHANGES: "success",
          CODE: "true",
          ...ALL_GREEN,
          TESTS: "skipped",
        }),
      ).not.toBe(0);
    });

    it("fails on a real tier failure", () => {
      expect(
        runAggregate("frontend", {
          CHANGES: "success",
          CODE: "true",
          ...ALL_GREEN,
          COVERAGE: "failure",
        }),
      ).not.toBe(0);
    });

    // fe-static runs on every PR, prose included — it carries the markdown
    // gates — so it is never legitimately skipped.
    it("fails when fe-static skips, even on a docs-only PR", () => {
      expect(
        runAggregate("frontend", {
          CHANGES: "success",
          CODE: "false",
          ...ALL_SKIPPED,
          STATIC: "skipped",
        }),
      ).not.toBe(0);
    });
  });

  describe("the required `rust` aggregate", () => {
    it("fails when the change filter did not succeed", () => {
      expect(
        runAggregate("rust", {
          CHANGES: "failure",
          RUST_TOUCHED: "",
          RESULT: "skipped",
          AUDIT: "skipped",
        }),
      ).not.toBe(0);
    });

    it("passes when the filter says no Rust changed", () => {
      expect(
        runAggregate("rust", {
          CHANGES: "success",
          RUST_TOUCHED: "false",
          RESULT: "skipped",
          AUDIT: "skipped",
        }),
      ).toBe(0);
    });

    it("fails when rust-test skips despite Rust having changed", () => {
      expect(
        runAggregate("rust", {
          CHANGES: "success",
          RUST_TOUCHED: "true",
          RESULT: "skipped",
          AUDIT: "success",
        }),
      ).not.toBe(0);
    });

    it("passes when rust-test and rust-audit both succeeded", () => {
      expect(
        runAggregate("rust", {
          CHANGES: "success",
          RUST_TOUCHED: "true",
          RESULT: "success",
          AUDIT: "success",
        }),
      ).toBe(0);
    });

    it("fails on a real rust-test failure", () => {
      expect(
        runAggregate("rust", {
          CHANGES: "success",
          RUST_TOUCHED: "true",
          RESULT: "failure",
          AUDIT: "success",
        }),
      ).not.toBe(0);
    });

    // cargo audit ran on every Rust PR but reported into no REQUIRED check, so
    // a RUSTSEC finding could not block a merge (audit 20260906, C3).
    it("fails on a cargo-audit failure", () => {
      expect(
        runAggregate("rust", {
          CHANGES: "success",
          RUST_TOUCHED: "true",
          RESULT: "success",
          AUDIT: "failure",
        }),
      ).not.toBe(0);
    });

    it("keeps rust-audit in the aggregate's needs", () => {
      expect(jobs.rust.needs).toContain("rust-audit");
    });
  });

  // C7: the VitePress site was built and linted only during deployment, i.e.
  // after merge, so a broken website change passed every required check.
  describe("website validation on the PR", () => {
    it("runs a website job gated on its own filter output", () => {
      expect(jobs.website).toBeDefined();
      expect(jobs.website.if).toBe("needs.changes.outputs.website == 'true'");
      expect(jobs.website.needs).toContain("changes");
    });

    it("builds AND lints the site, not just one of them", () => {
      const runs = jobs.website.steps.map((s) => String(s.run ?? "")).join("\n");
      expect(runs).toContain("website build");
      expect(runs).toContain("website lint:md");
    });

    it("is required by the frontend aggregate", () => {
      expect(jobs.frontend.needs).toContain("website");
    });

    it("fails the aggregate when the website job fails", () => {
      expect(
        runAggregate("frontend", {
          CHANGES: "success",
          CODE: "true",
          ...ALL_GREEN,
          WEBSITE: "failure",
        }),
      ).not.toBe(0);
    });

    it("fails when the website tier skips despite website files changing", () => {
      expect(
        runAggregate("frontend", {
          CHANGES: "success",
          CODE: "true",
          ...ALL_GREEN,
          WEBSITE: "skipped",
          WEBSITE_TOUCHED: "true",
        }),
      ).not.toBe(0);
    });

    it("passes when no website file changed", () => {
      expect(
        runAggregate("frontend", {
          CHANGES: "success",
          CODE: "true",
          ...ALL_GREEN,
          WEBSITE: "skipped",
          WEBSITE_TOUCHED: "false",
        }),
      ).toBe(0);
    });

    // website/**/*.md is excluded from `code`, so if the website filter did not
    // match markdown the site would go unverified on most of its actual changes.
    it("covers website markdown, which the code filter excludes", () => {
      expect(filters.website).toContain("website/**");
      expect(filters.code).toContain("!website/**/*.md");
    });
  });

  it("keeps both aggregates depending on the change filter", () => {
    // Without this dependency the aggregate cannot see the filter's result at
    // all, which is how the skip-is-a-pass hole went unnoticed.
    expect(jobs.frontend.needs).toContain("changes");
    expect(jobs.rust.needs).toContain("changes");
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
