/**
 * #1557 — both mutation tools run each mutated module against its OWN tests,
 * never against the app's or the crate's whole test suite.
 *
 * WHY THIS EXISTS. With no `testFiles`, `vitest.related: true` resolved the
 * mutate globs to every test that transitively imports them: 609 files and
 * 15,777 tests on 2026-10-12, most of them app-level integration suites. A
 * STATIC mutant (module-level code) cannot use perTest coverage, so Stryker
 * reruns that whole set for each one — its own planner put static mutants at
 * 82-93% of the run. The set grew with the integration suites, not with the
 * mutate scope, until the weekly ts-mutants job passed its 300-minute timeout
 * twice running and produced no verdict. `testFiles` removes that growth term.
 *
 * What is pinned:
 *   1. `testFiles` exists and is non-empty — deleting it silently restores the
 *      unbounded test set, and the first sign would be another lost verdict;
 *   2. every pattern matches at least one file (Stryker only WARNS on a dead
 *      pattern, and a dead pattern turns its module's mutants into NoCoverage);
 *   3. every pattern lives under a directory the mutate globs cover, so the
 *      list cannot quietly widen back into integration suites (`src/**`);
 *   4. every mutate glob has at least one listed test under its directory, so
 *      a newly scoped module cannot arrive with no tests to kill its mutants.
 *
 * The Rust twin (src-tauri/.cargo/mutants.toml) had the same growth term: each
 * mutant ran `cargo test` over the whole crate, and that phase went from ~20s
 * to ~60s per mutant until the job sat at 3h58m of its 240 minutes. Pinned:
 *   5. `--lib` in `additional_cargo_args` and a `--`-led filter list in
 *      `additional_cargo_test_args` (cargo-mutants appends the latter to the
 *      test phase only, after its own arguments — verified on 27.1.0);
 *   6. every examine_glob's module path is matched by some filter (libtest
 *      filters are substrings of the test path), and every filter names a
 *      module that exists, so neither side can go dead silently.
 *
 * @coordinates-with stryker.config.json
 * @coordinates-with src-tauri/.cargo/mutants.toml
 * @coordinates-with .github/workflows/mutation.yml
 * @module scripts/check-mutation-scope.test
 */
import { describe, it, expect } from "vitest";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

const REPO = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(path.join(REPO, "stryker.config.json"), "utf8"));

/** The literal directory prefix of a glob: `src/lib/a/**\/*.ts` → `src/lib/a`. */
function staticBase(glob) {
  const parts = glob.split("/");
  const stop = parts.findIndex((p) => /[*?{[]/.test(p));
  const literal = stop === -1 ? parts.slice(0, -1) : parts.slice(0, stop);
  return literal.join("/");
}

const matches = (glob) => globSync(glob, { cwd: REPO });
const within = (file, dir) => file === dir || file.startsWith(`${dir}/`);

const mutateGlobs = config.mutate.filter((g) => !g.startsWith("!"));
const mutateBases = mutateGlobs.map(staticBase);
const testGlobs = config.testFiles ?? [];
const listedTests = [...new Set(testGlobs.flatMap(matches))];

describe("stryker.config.json testFiles", () => {
  it("is set — without it every static mutant reruns the app's whole related graph", () => {
    expect(Array.isArray(config.testFiles)).toBe(true);
    expect(testGlobs.length).toBeGreaterThan(0);
  });

  it.each(testGlobs)("%s matches at least one test file", (glob) => {
    expect(matches(glob).filter((f) => /\.test\.[cm]?[jt]sx?$/.test(f))).not.toHaveLength(0);
  });

  it.each(testGlobs)("%s stays inside a mutated directory", (glob) => {
    const base = staticBase(glob);
    expect(
      mutateBases.some((m) => within(base, m)),
      `${glob} (base ${base}) is outside every mutate directory: ${mutateBases.join(", ")}`,
    ).toBe(true);
  });

  it.each(mutateGlobs)("mutate glob %s has a listed test under its directory", (glob) => {
    const base = staticBase(glob);
    expect(
      listedTests.filter((t) => within(t, base)),
      `no testFiles entry covers ${base}; add the module's unit tests to testFiles`,
    ).not.toHaveLength(0);
  });

  it("computes static bases the way the assertions above assume", () => {
    expect(staticBase("src/lib/a/**/*.ts")).toBe("src/lib/a");
    expect(staticBase("src/c/T/{x,y}*.test.ts")).toBe("src/c/T");
    expect(staticBase("src/lib/a/linter.ts")).toBe("src/lib/a");
  });
});

const mutants = parseToml(readFileSync(path.join(REPO, "src-tauri/.cargo/mutants.toml"), "utf8"));
const testArgs = mutants.additional_cargo_test_args ?? [];
const filters = testArgs.slice(testArgs.indexOf("--") + 1);
/** `src/workflow/expressions.rs` → `workflow::expressions`. */
const modulePath = (file) => file.replace(/^src\//, "").replace(/(\/mod)?\.rs$/, "").split("/").join("::");

describe("src-tauri/.cargo/mutants.toml test scope", () => {
  it("builds and tests the lib target only", () => {
    expect(mutants.additional_cargo_args).toContain("--lib");
  });

  it("passes a libtest filter list after `--`", () => {
    expect(testArgs[0]).toBe("--");
    expect(filters.length).toBeGreaterThan(0);
  });

  it.each(mutants.examine_globs)("examine glob %s is reached by a filter", (glob) => {
    const files = matches(path.join("src-tauri", glob)).map((f) => f.replace(/^src-tauri\//, ""));
    expect(files, `${glob} matches no file`).not.toHaveLength(0);
    for (const file of files) {
      const testPath = `${modulePath(file)}::tests::any`;
      expect(
        filters.some((f) => testPath.includes(f)),
        `no filter in additional_cargo_test_args reaches ${modulePath(file)}`,
      ).toBe(true);
    }
  });

  it.each(filters)("filter %s names a module that exists", (filter) => {
    const rel = filter.replace(/::$/, "").split("::").join("/");
    const candidates = [`${rel}.rs`, `${rel}/mod.rs`, rel].map((c) => path.join(REPO, "src-tauri/src", c));
    expect(candidates.some((c) => matches(path.relative(REPO, c)).length > 0), `${filter} matches no module`).toBe(true);
  });
});
