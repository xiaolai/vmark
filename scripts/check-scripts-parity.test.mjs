/**
 * `pnpm check:all` and CI's parallel groups must run the SAME set of gates.
 *
 * CI no longer runs `check:all` as one job. It runs the groups — `check:static`,
 * `test:coverage`, `check:servers`, `check:build` — as separate jobs so the
 * critical path is their max rather than their sum. That split introduces a
 * drift hole the moment it exists: append `pnpm lint:new-gate` directly to
 * `check:all` and it runs locally and in the pre-push hook, but NO CI job runs
 * it. The gate would look wired up, pass every local check, and be absent from
 * the only place that actually blocks a merge.
 *
 * So `check:all` may not contain steps of its own: it must be exactly the
 * composition of the groups CI runs. Adding a gate then has one correct home
 * (a group), and CI picks it up for free.
 *
 * @coordinates-with .github/workflows/ci.yml — fe-static / fe-test / fe-coverage / fe-servers / fe-build
 * @coordinates-with scripts/lib/packageScripts.mjs — transitive expansion
 * @module scripts/check-scripts-parity.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { invokedScripts } from "./lib/packageScripts.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
const ci = readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8");
/** The workflow as DATA. Text matching on `ci` is satisfiable by comments —
 *  see the note above the CI assertions below. */
const ciDoc = parseYaml(ci);

/** The groups CI runs as jobs. Each must appear verbatim in ci.yml. */
const CI_GROUPS = ["check:static", "test:coverage", "check:servers", "check:build"];

describe("check:all and CI run the same gates", () => {
  it("check:all is exactly the composition of the CI groups, in order", () => {
    const steps = pkg.scripts["check:all"].split("&&").map((s) => s.trim());
    expect(steps).toEqual(CI_GROUPS.map((g) => `pnpm ${g}`));
  });

  it("every gate check:all runs is reachable through some CI group", () => {
    const viaCheckAll = new Set(invokedScripts(pkg.scripts, "check:all"));
    const viaGroups = new Set(
      CI_GROUPS.flatMap((g) => [g, ...invokedScripts(pkg.scripts, g)]),
    );
    const orphans = [...viaCheckAll].filter((s) => !viaGroups.has(s));
    expect(orphans, `gates in check:all that no CI job runs: ${orphans.join(", ")}`).toEqual([]);
  });

  // Everything below reads the PARSED workflow, never the file's text.
  //
  // These assertions used to `expect(ci).toContain(...)` and slice the raw YAML
  // between two `indexOf` markers. That is satisfiable by prose: `ci.yml`
  // documents each of these settings in comments right beside them, so the
  // string appears whether or not the setting does. Demonstrated, not
  // theorised — deleting the real `if-no-files-found: error` key while leaving
  // the comment that explains it kept this suite GREEN. Parsed `run` and `with`
  // values cannot be satisfied by a comment.

  /** The job whose steps run `pnpm <script>` (or match a predicate). */
  function jobRunning(predicate) {
    return Object.entries(ciDoc.jobs).find(([, job]) =>
      (job.steps ?? []).some((s) => predicate(String(s.run ?? ""), s)),
    );
  }

  /** The sharded test job, located by its MATRIX rather than by step text. */
  function shardJob() {
    const found = Object.entries(ciDoc.jobs).find(
      ([, job]) => job.strategy?.matrix?.shard,
    );
    expect(found, "no CI job declares a `shard` matrix").toBeDefined();
    return found[1];
  }

  it("ci.yml actually invokes each group", () => {
    for (const group of CI_GROUPS) {
      // `test:coverage` runs sharded (`vitest run --coverage --shard=...`), so
      // accept either the script name or the sharded invocation it expands to.
      const found = jobRunning(
        (run) => run.includes(`pnpm ${group}`) || (group === "test:coverage" && run.includes("--shard=")),
      );
      expect(found, `no CI job step runs ${group}`).toBeDefined();
    }
  });

  it("the coverage gate is applied to the MERGED shard report", () => {
    // Sharding without a merge silently drops the thresholds: each shard would
    // measure a fraction of the suite and none would represent the whole.
    const merge = jobRunning((run) => run.includes("--merge-reports"));
    expect(merge, "no step merges the shard reports").toBeDefined();
    expect(
      merge[1].steps.find((s) => String(s.run ?? "").includes("--merge-reports")).run,
      "the merge step must also apply coverage",
    ).toContain("--coverage");
  });

  it("a failing shard prints why — blob must not be the only reporter", () => {
    // `--reporter=blob` REPLACES the console reporter. On its own, a red shard
    // emitted nothing but "Process completed with exit code 1": no test name,
    // no assertion, nothing to distinguish a real regression from a flake.
    const run = (shardJob().steps ?? [])
      .map((s) => String(s.run ?? ""))
      .find((r) => r.includes("--shard="));
    expect(run, "the shard job has no `--shard=` step").toBeDefined();
    expect(run).toContain("--reporter=blob");
    expect(run, "shard needs a console reporter beside blob").toContain("--reporter=default");
    // With two reporters, the blob path must be addressed per-reporter or the
    // blob silently lands somewhere else (or not at all).
    expect(run).toContain("--outputFile.blob=");
  });

  it("shard blobs actually upload — hidden dir, and a missing blob is fatal", () => {
    // vitest writes blobs into `.vitest-reports/`, a dot-directory.
    // upload-artifact@v4 skips hidden files by default, so the blob was written
    // and silently dropped; `if-no-files-found` then defaults to `warn`, so the
    // shard passed and fe-coverage failed with ENOENT instead — the error
    // naming the consumer rather than the producer.
    const upload = (shardJob().steps ?? []).find((s) =>
      String(s.uses ?? "").startsWith("actions/upload-artifact@"),
    );
    expect(upload, "the shard job uploads no artifact").toBeDefined();
    // Read as PARSED VALUES: `true` and `error`, not substrings of the file.
    expect(upload.with["include-hidden-files"], "blobs live in a dot-directory").toBe(true);
    expect(upload.with["if-no-files-found"], "a missing blob must fail the shard").toBe("error");
  });

  it("shards do NOT gate on coverage — only the merged report does", () => {
    // A shard runs a quarter of the suite and measures ~49% lines, so leaving
    // the global thresholds active makes every shard fail on every run — which
    // is exactly what happened the first time this matrix ran. Coverage is a
    // property of the whole suite; a fraction of it cannot be judged.
    const run = (shardJob().steps ?? [])
      .map((s) => String(s.run ?? ""))
      .find((r) => r.includes("--shard="));
    for (const metric of ["lines", "functions", "statements", "branches"]) {
      expect(
        run,
        `shard run must zero coverage.thresholds.${metric}`,
      ).toContain(`--coverage.thresholds.${metric}=0`);
    }
  });
});

/**
 * The test tiers must PARTITION the test files on disk: every file runs in
 * exactly one config, and none runs in two.
 *
 * This exists because splitting a suite is silent when it goes wrong. The gate
 * self-tests (`scripts/**`, `.claude/hooks/**`) moved out of `vitest.config.ts`
 * into `vitest.gates.config.ts`; had the new include glob been slightly wrong,
 * 28 files verifying the lint gates would simply have stopped running, and
 * every remaining check would still have reported green. A missing test does
 * not fail — that is the whole problem with it.
 *
 * Both directions matter. A file matched by NO tier is a dropped test; a file
 * matched by TWO is wasted work and, worse, a sign the globs overlap in a way
 * that will drop something the next time one is edited. Four tiers take part:
 * app, gates, webkit and soak.
 *
 * The configs are IMPORTED, not re-declared here — a copy of the globs would
 * pass while the real config drifted.
 *
 * THE DISK IS READ EXACTLY ONCE, and every tier's ownership is then decided
 * in memory against that one snapshot. This is not tidiness. The first version
 * globbed the tree separately for each side, and other gate self-tests create
 * probe files INSIDE `src/` while they run (`.claude/hooks/gha-tdd-guard.test.mjs`
 * writes `__guardspec_dir__.test.ts` to check the guard blocks it, then deletes
 * it). A file that existed for one glob and not the other was reported as a
 * dropped or phantom test — a ~25% flake rate, red on work that was perfectly
 * fine. One read cannot disagree with itself.
 */
describe("test tiers partition the test files on disk", () => {
  /**
   * Directories never worth walking, and never containing a routable test.
   * Matched per PATH SEGMENT, so a nested `src/**​/node_modules` is caught too.
   *
   * `worktrees` is here because `.claude/worktrees/` holds real git worktrees —
   * whole second checkouts of this repo (`git worktree list` confirms two).
   * They carry ~2,500 test files that belong to another branch's checkout and
   * are excluded from git via `.git/info/exclude`. The first repo-wide run of
   * this check found them immediately, which is the point: the previous
   * three-root version could not see them, or anything else outside the roots
   * it happened to name.
   */
  const INFRA_DIRS = new Set([
    "node_modules", "dist", "coverage", "target", "tmp", "reports", "worktrees",
    ".git", ".vitest-reports", ".vitest-attachments", ".playwright-mcp",
  ]);

  /**
   * Top-level roots whose tests are run by a DIFFERENT runner, so the four
   * vitest tiers here are not supposed to own them.
   *
   * Each entry is a claim that something else runs those tests, and the claim
   * is checked below rather than trusted — an allowlist nobody verifies is how
   * a whole package's tests go quiet.
   */
  const SEPARATELY_MANAGED = {
    server: "check:servers",
  };

  /**
   * `website` used to be exempted here as "run by the website's own
   * toolchain". It was not: `website/package.json` has no test script and there
   * is no vitest config under `website/`, so
   * `website/.vitepress/theme/cjkSpacing.test.ts` — 16 committed assertions —
   * ran nowhere at all. An allowlist entry is a claim, and that one was false;
   * it turned a real dropped test into a green partition. The app tier now
   * collects it, and the check below verifies each remaining exemption names a
   * script that `check:all` actually reaches into that root.
   */

  /** Matches the same names the tier includes do. Kept as a RegExp because the
   *  walk below tests basenames, not paths. */
  const TEST_FILE_RE = /\.(test|spec)\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/;

  /**
   * Compile one vitest include/exclude glob to a RegExp.
   *
   * Supports exactly the forms these configs use: `**`, `*`, `?`, and a single
   * flat `{a,b}` alternation. Matching in memory is what lets the whole check
   * run off one directory read — see the race described above.
   *
   * Anything richer THROWS rather than being approximated. A partition gate
   * built on a glob parser that quietly disagrees with Vitest's is worse than
   * no gate: it reports a clean partition computed from patterns that mean
   * something else. Character classes, negation, extglobs and nested braces are
   * all valid glob syntax this cannot represent, so they must be a loud error
   * the day someone writes one — not a silent mis-parse.
   */
  function globToRegExp(glob) {
    if (/\[|\]|!|\+\(|@\(|\?\(|\*\(|\|/.test(glob)) {
      throw new Error(
        `check-scripts-parity: glob "${glob}" uses syntax this matcher cannot ` +
          `represent (character class, negation, extglob or alternation). The ` +
          `partition check would silently compute the wrong answer — extend ` +
          `globToRegExp and its conformance tests, or avoid the syntax.`,
      );
    }
    if (/\{[^}]*\{/.test(glob)) {
      throw new Error(`check-scripts-parity: nested braces in "${glob}" are not supported.`);
    }
    return globToRegExpUnchecked(glob);
  }

  function globToRegExpUnchecked(glob) {
    let out = "";
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === "*") {
        if (glob[i + 1] === "*") {
          // `**/` spans any number of segments, including none.
          if (glob[i + 2] === "/") { out += "(?:[^/]+/)*"; i += 2; } else { out += ".*"; i += 1; }
        } else {
          out += "[^/]*";
        }
      } else if (c === "{") {
        const close = glob.indexOf("}", i);
        // Without this an unmatched `{` sets i = -1, the loop restarts from the
        // beginning, and the matcher spins forever instead of failing.
        if (close === -1) throw new Error(`check-scripts-parity: unmatched "{" in glob "${glob}".`);
        out += `(?:${glob.slice(i + 1, close).split(",").map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("|")})`;
        i = close;
      } else if (c === "?") {
        out += "[^/]";
      } else {
        out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
    }
    return new RegExp(`^${out}$`);
  }

  /**
   * The include/exclude regexes for one tier.
   *
   * EVERY exclude is compiled and applied — including the infrastructure ones.
   * They used to be `continue`d on the reasoning that they could not match
   * anything the includes reach, which is not a property anyone checks: a test
   * file under a nested `node_modules/` or `dist/` inside `src/` matches the
   * include, is excluded by Vitest, and was counted here as owned. That is a
   * false-green partition — the exact failure this gate exists to catch.
   */
  function tierPatterns(config) {
    const t = config.test ?? {};
    return {
      includes: (t.include ?? []).map(globToRegExp),
      excludes: (t.exclude ?? []).map(globToRegExp),
    };
  }

  /** Files a tier actually runs: matched by an include, by no exclude. */
  function filesFor(config, snapshot) {
    const { includes, excludes } = tierPatterns(config);
    return new Set(
      [...snapshot].filter(
        (f) => includes.some((r) => r.test(f)) && !excludes.some((r) => r.test(f)),
      ),
    );
  }

  /**
   * THE single disk read — and it is REPOSITORY-WIDE.
   *
   * It used to glob three hard-coded roots, while the comment beside them
   * claimed a test file outside those roots would make the check fail. It would
   * not: an unlisted root is simply never enumerated, so a new top-level
   * directory of tests would be invisible to the very gate that promises no
   * test is dropped. The claim is now true by construction — everything is
   * walked except infrastructure, and anything found must be explained.
   */
  function filesOnDisk() {
    const found = new Set();
    // A hand-rolled walk rather than a glob, for two reasons. It PRUNES
    // `INFRA_DIRS` instead of walking node_modules and filtering afterwards;
    // and it sees HIDDEN directories, which `**` does not. That second point is
    // not hypothetical — the glob version silently missed
    // `website/.vitepress/theme/cjkSpacing.test.ts`, a real test file inside a
    // nested dot-directory. A discovery pass with a blind spot is exactly the
    // thing this gate is supposed to make impossible.
    const walk = (rel) => {
      for (const entry of readdirSync(path.join(REPO, rel || "."), { withFileTypes: true })) {
        if (INFRA_DIRS.has(entry.name)) continue;
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(child);
        else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) found.add(child);
      }
    };
    walk("");
    return found;
  }

  /** Split the repo-wide snapshot into "the vitest tiers should own this" and
   *  "another runner owns this", so the allowlist is applied in one place. */
  function partitionByOwnerRunner(snapshot) {
    const ours = new Set();
    const elsewhere = new Set();
    for (const f of snapshot) {
      (SEPARATELY_MANAGED[f.split("/")[0]] ? elsewhere : ours).add(f);
    }
    return { ours, elsewhere };
  }

  it("no test file is dropped, and none runs twice", async () => {
    const tiers = {
      app: await import("../vitest.config.ts"),
      gates: await import("../vitest.gates.config.ts"),
      webkit: await import("../vitest.browser.config.ts"),
      soak: await import("../vitest.soak.config.ts"),
    };

    const { ours, elsewhere } = partitionByOwnerRunner(filesOnDisk());

    const owners = new Map();
    for (const [label, mod] of Object.entries(tiers)) {
      for (const file of filesFor(mod.default, ours)) {
        owners.set(file, [...(owners.get(file) ?? []), label]);
      }
    }

    const doubled = [...owners].filter(([, t]) => t.length > 1);
    expect(
      doubled.map(([f, t]) => `${f} -> ${t.join(" + ")}`),
      "these files run in more than one tier",
    ).toEqual([]);

    const dropped = [...ours].filter((f) => !owners.has(f)).sort();
    expect(dropped, "these test files exist but NO vitest config runs them").toEqual([]);

    // The allowlist is a claim that something else runs these; verify the
    // claim's premise rather than trusting it. An entry naming a root that has
    // no tests is a stale exemption that would hide a real drop if tests
    // returned to it.
    const emptyExemptions = Object.keys(SEPARATELY_MANAGED).filter(
      (root) => ![...elsewhere].some((f) => f.startsWith(`${root}/`)),
    );
    expect(
      emptyExemptions,
      "these roots are exempted from the partition but contain no tests — stale exemption",
    ).toEqual([]);

    // ...and that the named runner is real: reachable from `check:all` AND
    // actually operating inside that root. Checking only "the root has tests"
    // is what let `website` sit here for free while nothing ran its 16
    // assertions. An exemption has to name something that runs.
    const reachable = new Set(invokedScripts(pkg.scripts, "check:all"));
    for (const [root, script] of Object.entries(SEPARATELY_MANAGED)) {
      expect(
        reachable.has(script),
        `exemption for "${root}/" names \`${script}\`, which check:all never runs`,
      ).toBe(true);
      const body = [script, ...invokedScripts(pkg.scripts, script)]
        .map((n) => pkg.scripts[n] ?? "")
        .join("\n");
      expect(
        body.includes(`--dir ${root}/`) || body.includes(`${root}/`),
        `\`${script}\` does not operate inside "${root}/" — the exemption is unverified`,
      ).toBe(true);
    }

    // The guard must be collected by a tier itself. It is discovered through
    // the same `scripts/**` glob it polices, so narrowing that glob would
    // remove this check along with the tests it protects — silently.
    expect(
      owners.get("scripts/check-scripts-parity.test.mjs"),
      "this guard is not collected by any tier — it cannot police a partition it is not part of",
    ).toBeDefined();

    // The other direction. Ownership is derived from the snapshot, so a tier
    // cannot claim a file that is not on disk — but it CAN carry an include
    // glob that matches nothing REACHABLE, which is what a rename or a moved
    // directory leaves behind. Measured against include-minus-exclude, not the
    // raw include: a pattern whose only matches are excluded runs zero tests
    // while still looking live.
    const deadGlobs = [];
    for (const [label, mod] of Object.entries(tiers)) {
      const { excludes } = tierPatterns(mod.default);
      for (const pattern of mod.default.test?.include ?? []) {
        const re = globToRegExp(pattern);
        const reachable = [...ours].some(
          (f) => re.test(f) && !excludes.some((x) => x.test(f)),
        );
        if (!reachable) deadGlobs.push(`${label}: ${pattern}`);
      }
    }
    expect(deadGlobs, "these include globs match no runnable test file — stale after a move?").toEqual([]);
  });

  it("globToRegExp agrees with glob semantics on the forms it accepts", () => {
    // The partition rests on this matcher, so it gets conformance cases rather
    // than trust. Each pair is (glob, path, shouldMatch).
    const cases = [
      ["src/**/*.{test,spec}.{ts,tsx}", "src/a/b/x.test.ts", true],
      ["src/**/*.{test,spec}.{ts,tsx}", "src/x.spec.tsx", true],
      ["src/**/*.{test,spec}.{ts,tsx}", "src/x.test.mjs", false],
      ["src/**/*.{test,spec}.{ts,tsx}", "other/x.test.ts", false],
      // `**/` must span zero segments as well as many.
      ["src/**/*.test.ts", "src/x.test.ts", true],
      ["**/node_modules/**", "src/a/node_modules/p/x.test.ts", true],
      ["**/node_modules/**", "src/a/x.test.ts", false],
      ["scripts/**/*.test.mjs", "scripts/lib/deep/x.test.mjs", true],
      // `*` must not cross a separator.
      ["src/*.test.ts", "src/a/b.test.ts", false],
      // A dot is literal, not "any character".
      ["src/x.test.ts", "srcXtest.ts", false],
    ];
    for (const [glob, path, shouldMatch] of cases) {
      expect(globToRegExp(glob).test(path), `${glob} vs ${path}`).toBe(shouldMatch);
    }
  });

  it("globToRegExp REFUSES syntax it cannot represent, rather than guessing", () => {
    // Silently approximating one of these would compute a wrong partition and
    // still report green — strictly worse than having no gate.
    for (const glob of [
      "src/**/*.[jt]s",        // character class
      "src/!(foo)/*.test.ts",  // negation + extglob
      "src/+(a|b)/x.test.ts",  // extglob
      "src/{a,{b,c}}/x.test.ts", // nested braces
    ]) {
      expect(() => globToRegExp(glob), glob).toThrow();
    }
  });

  it("the gate self-tests run inside a REQUIRED CI job, structurally", () => {
    // Moving them out of `test:coverage` is only safe while a required CI job
    // still runs them. Asserting script reachability alone was not enough — it
    // proves `check:static` invokes `test:gates`, and says nothing about
    // whether any required check depends on `check:static`. Both halves, or the
    // name of this test is a claim nothing verifies.
    expect(invokedScripts(pkg.scripts, "check:static")).toContain("test:gates");

    const ciDoc = parseYaml(ci);
    const staticJob = Object.entries(ciDoc.jobs).find(([, j]) =>
      (j.steps ?? []).some((s) => String(s.run ?? "").includes("pnpm check:static")),
    );
    expect(staticJob, "no CI job runs `pnpm check:static`").toBeDefined();
    const [staticJobName] = staticJob;

    // Branch protection requires the check named exactly "frontend".
    const frontend = ciDoc.jobs.frontend;
    expect(frontend, "the required `frontend` gate job is gone").toBeDefined();
    expect(
      frontend.needs,
      `the required \`frontend\` gate does not depend on \`${staticJobName}\`, ` +
        `so the gate self-tests could fail without blocking a merge`,
    ).toContain(staticJobName);

    // `needs` alone is not enough: with `if: always()` the aggregator runs even
    // when a dependency failed, so it must treat any non-success as failure.
    // Reading the job's result must be WIRED, not merely mentioned. Find the
    // env var that is bound to `needs.<staticJob>.result` and require the
    // script to test that exact variable — otherwise a renamed or deleted
    // mapping leaves a passing test while fe-static failures escape the gate.
    const step = (frontend.steps ?? []).find((st) => st.env && st.run);
    expect(step, "the frontend gate has no step with env + run").toBeDefined();
    const bound = Object.entries(step.env).find(([, v]) =>
      String(v).includes(`needs.${staticJobName}.result`),
    );
    expect(
      bound,
      `no env var is bound to needs.${staticJobName}.result — the gate cannot see that job`,
    ).toBeDefined();
    const [varName] = bound;
    expect(
      step.run.includes(`$${varName}`),
      `the gate never reads $${varName}, so ${staticJobName}'s result is ignored`,
    ).toBe(true);
    expect(step.run, "the gate must fail on any non-success result").toContain('!= "success"');
  });

  it("the gate self-tests are reachable from check:all too", () => {
    // So a local `pnpm check:all` runs them as well, not just CI.
    expect(invokedScripts(pkg.scripts, "check:all")).toContain("test:gates");
  });
});
