// WI-RA14D.1 — the app tier's coverage reports every production file under
// src/, including one no test imports, so the floors in vitest.config.ts
// measure the app rather than only the part of it the suite happens to load.
//
// Two halves. The config half asserts `coverage.include` exists and that its
// glob reaches every production source file. The fixture half runs a real
// Vitest coverage pass over a two-file tree, once with the app config's
// include/exclude and once without the include, and requires the unimported
// file to be reported at 0% with it and to be ABSENT without it. The second
// run is the control: it proves the fixture can see the defect, so the first
// run passing means the include fixed it rather than that the fixture is blind.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { globSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITEST_BIN = path.join(REPO, "node_modules", "vitest", "vitest.mjs");
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const appConfig = (await import("../vitest.config.ts")).default;

/**
 * Repo files matching `pattern` — files only. A glob also matches directories,
 * and vitest's browser mode writes failure screenshots into a gitignored
 * `__screenshots__/<test file name>/` directory, so a checkout that has run a
 * failing WebKit test holds a directory named like a `.tsx` file. An entry
 * gone by the time it is stated (a concurrent gates-tier test's own probe,
 * e.g. gha-tdd-guard's `__guardspec_*` fixtures) is not a repo file: skipped.
 */
function repoFiles(pattern) {
  return globSync(pattern, { cwd: REPO }).filter(
    (file) => statSync(path.join(REPO, file), { throwIfNoEntry: false })?.isFile() === true,
  );
}
const coverage = appConfig.test.coverage;

describe("app coverage config", () => {
  it("sets coverage.include, so unloaded files are reported instead of omitted", () => {
    expect(Array.isArray(coverage.include) && coverage.include.length > 0).toBe(true);
  });

  it("reaches every production source file under src/", () => {
    const included = new Set(repoFiles(coverage.include));
    const production = repoFiles("src/**/*.{ts,tsx}").filter(
      (file) => !TEST_FILE.test(file) && !file.endsWith(".d.ts"),
    );
    expect(production.length).toBeGreaterThan(1000);
    const unreached = production.filter((file) => !included.has(file));
    expect(unreached, "production files outside coverage.include").toEqual([]);
  });

  // The include names .ts/.tsx only. The JavaScript under src/ today is assets
  // injected into other documents (the browser agent, the HTML-export reader),
  // imported as `?raw` strings and executed outside this process, where v8
  // coverage cannot see them. A JavaScript MODULE imported for real would run
  // here and escape the floors unseen, so that shape fails this test.
  it("leaves only ?raw assets outside it — no JavaScript module escapes measurement", () => {
    const scripts = repoFiles("src/**/*.{js,jsx,mjs,cjs,mts,cts}").filter(
      (file) => !TEST_FILE.test(file),
    );
    const sources = repoFiles("src/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}");
    const specifiers = sources.flatMap((file) =>
      [...readFileSync(path.join(REPO, file), "utf8").matchAll(
        /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g,
      )].map((match) => match[1]),
    );
    const moduleImports = scripts.flatMap((file) => {
      const name = path.basename(file);
      return specifiers
        .filter((spec) => path.basename(spec.split("?")[0]) === name && !spec.endsWith("?raw"))
        .map((spec) => `${file} <- "${spec}"`);
    });
    expect(moduleImports, "JavaScript under src/ imported as a module, outside coverage.include").toEqual([]);
  });
});

/** Run Vitest with coverage over `dir` and return its summary, keyed by path relative to `dir`. */
function coverageSummary(dir, coverageOptions) {
  const config = {
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
      coverage: {
        provider: "v8",
        enabled: true,
        reporter: ["json-summary"],
        reportsDirectory: "coverage",
        ...coverageOptions,
      },
    },
  };
  const configPath = path.join(dir, "vitest.fixture.config.mjs");
  writeFileSync(configPath, `export default ${JSON.stringify(config)};\n`);
  rmSync(path.join(dir, "coverage"), { recursive: true, force: true });

  // Strip the parent run's worker identity so the child is a fresh Vitest.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
  );
  const run = spawnSync(process.execPath, [VITEST_BIN, "run", "--root", dir, "--config", configPath], {
    cwd: dir,
    env,
    encoding: "utf8",
  });
  expect(run.status, `fixture vitest failed:\n${run.stdout}\n${run.stderr}`).toBe(0);

  const summaryPath = path.join(dir, "coverage", "coverage-summary.json");
  expect(existsSync(summaryPath), "fixture run wrote no coverage summary").toBe(true);
  const raw = JSON.parse(readFileSync(summaryPath, "utf8"));
  return Object.fromEntries(
    Object.entries(raw).map(([file, value]) => [
      file === "total" ? file : path.relative(dir, file).split(path.sep).join("/"),
      value,
    ]),
  );
}

describe("an unimported production file", () => {
  let dir;

  beforeAll(() => {
    // realpath: on macOS the temp dir is a symlink (/var -> /private/var) and
    // the summary is keyed by the resolved path.
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), "vmark-coverage-include-")));
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "imported.ts"), "export function double(n: number): number {\n  return n * 2;\n}\n");
    writeFileSync(path.join(dir, "src", "orphan.ts"), "export function triple(n: number): number {\n  return n * 3;\n}\n");
    writeFileSync(
      path.join(dir, "src", "imported.test.ts"),
      'import { expect, it } from "vitest";\nimport { double } from "./imported";\nit("doubles", () => expect(double(2)).toBe(4));\n',
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is reported at 0% under the app config's include and exclude", () => {
    const summary = coverageSummary(dir, { include: coverage.include, exclude: coverage.exclude });
    expect(summary["src/imported.ts"].lines.pct).toBe(100);
    expect(summary["src/orphan.ts"], "the unimported file is missing from the summary").toBeDefined();
    expect(summary["src/orphan.ts"].lines.total).toBeGreaterThan(0);
    expect(summary["src/orphan.ts"].lines.covered).toBe(0);
    expect(summary["src/imported.test.ts"]).toBeUndefined();
  });

  it("is omitted entirely without an include — the defect the include exists for", () => {
    const summary = coverageSummary(dir, { exclude: coverage.exclude });
    expect(summary["src/imported.ts"]).toBeDefined();
    expect(summary["src/orphan.ts"]).toBeUndefined();
  });
});
