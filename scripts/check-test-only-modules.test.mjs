// WI-FL0.1 — the production-reachability gate's own tests (gates tier, node).
import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  ROOT,
  BASELINE_PATH,
  isTestSupport,
  TEST_SUPPORT_FILES,
  parseKnipFiles,
  productionEntries,
  globToRegExp,
  globMatches,
  unmarkedPatterns,
  assertGraphDefinition,
  compareWithBaseline,
  updateDecision,
  runKnip,
  writeBaseline,
  readBaseline,
  readConfig,
} from "./check-test-only-modules.mjs";

describe("isTestSupport", () => {
  it.each([
    ["src/test/setup.ts", true],
    ["src/bench/helpers.ts", true],
    ["src/plugins/lint/__tests__/testHarness.ts", true],
    ["src/foo/__mocks__/bar.ts", true],
    ["src/theme/themes/__acceptance__/highContrast.spike.ts", true],
    ["scripts/__tests__/i18nIdenticalAllowlist.test.ts", true],
    ["src/services/workspaces/workspaceWindowActions.testUtils.ts", true],
    ["src/utils/markdownPipeline/testSchema.ts", true],
    ["src/foo/bar.test.tsx", true],
    ["e2e/journeys/01-boot.mjs", true],
    ["src/plugins/imageView/operations.ts", false],
    ["src/components/Editor/WorkflowPanel/GhaWorkflowPanel.tsx", false],
    ["server/mcp/src/utils/toolSchema.ts", false],
    ["src/utils/markdownPipeline/conformance/fixtures.ts", false],
    ["src/services/latest.ts", false],
    // audit R2 #83 — `test[A-Z]\w*` was a claim about every future filename
    // too, and these are ordinary production names.
    ["src/services/testConnection.ts", false],
    ["src/lib/testRunner.ts", false],
  ])("%s → %s", (path, expected) => {
    expect(isTestSupport(path)).toBe(expected);
  });

  it("names its exceptions one by one, and every one exists on disk", () => {
    expect([...TEST_SUPPORT_FILES]).toEqual(["src/utils/markdownPipeline/testSchema.ts"]);
    for (const rel of TEST_SUPPORT_FILES) expect(existsSync(join(ROOT, rel)), rel).toBe(true);
  });
});

describe("parseKnipFiles", () => {
  it("reads the issues[].files[].name shape knip 6 emits", () => {
    const json = JSON.stringify({
      issues: [
        { file: "b.ts", files: [{ name: "b.ts" }] },
        { file: "a.ts", files: [{ name: "a.ts" }] },
        { file: "a.ts", files: [{ name: "a.ts" }] },
      ],
    });
    expect(parseKnipFiles(json)).toEqual(["a.ts", "b.ts"]);
  });
  it("reads a top-level files array of strings or objects", () => {
    expect(parseKnipFiles(JSON.stringify({ files: ["z.ts", { name: "y.ts" }] }))).toEqual(["y.ts", "z.ts"]);
  });
  it("normalises Windows separators", () => {
    expect(parseKnipFiles(JSON.stringify({ files: ["src\\a\\b.ts"] }))).toEqual(["src/a/b.ts"]);
  });
  it("fails loudly on non-JSON and on an unexpected shape", () => {
    expect(() => parseKnipFiles("Unused files (3)\nfoo.ts")).toThrow(/did not return JSON/);
    expect(() => parseKnipFiles(JSON.stringify({ hello: 1 }))).toThrow(/neither an `issues` array nor a `files` array/);
  });
  it("validates every file record rather than reading an unknown shape as empty (audit #57)", () => {
    expect(() => parseKnipFiles(JSON.stringify({ files: [{ path: "a.ts" }] }))).toThrow(/files\[\] holds a file record of unknown shape/);
    expect(() => parseKnipFiles(JSON.stringify({ files: [""] }))).toThrow(/unknown shape/);
    expect(() => parseKnipFiles(JSON.stringify({ issues: ["a.ts"] }))).toThrow(/issues\[0\] is not an issue record/);
    expect(() => parseKnipFiles(JSON.stringify({ issues: [{ file: "a.ts", files: "a.ts" }] }))).toThrow(/carries no `files` array/);
    expect(() => parseKnipFiles(JSON.stringify({ issues: [{ file: "a.ts", files: [{ name: 3 }] }] }))).toThrow(/issues\[0\]\.files\[\] holds a file record/);
    // audit R2 #84 — an issue record with no `files` array was accepted and
    // contributed nothing, so a partial schema change read as a clean tree.
    expect(() => parseKnipFiles(JSON.stringify({ issues: [{ file: "a.ts" }] }))).toThrow(/carries no `files` array/);
  });
});

describe("the production graph definition", () => {
  const good = {
    workspaces: {
      ".": { entry: ["src/main.tsx!", "scripts/*.mjs!"], project: ["src/**/*.ts!"] },
      "server/mcp": { entry: ["src/cli.ts!"], project: ["src/**/*.ts!"] },
    },
  };
  it("lists every production entry per workspace, marking the globs", () => {
    expect(productionEntries(good)).toEqual([
      { dir: ".", pattern: "src/main.tsx", isGlob: false },
      { dir: ".", pattern: "scripts/*.mjs", isGlob: true },
      { dir: "server/mcp", pattern: "src/cli.ts", isGlob: false },
    ]);
  });
  it("expands knip's entry globs: *, **, ? and {a,b}", () => {
    expect(globToRegExp("scripts/*.{ts,mjs}").test("scripts/a.mjs")).toBe(true);
    expect(globToRegExp("scripts/*.{ts,mjs}").test("scripts/lib/a.mjs")).toBe(false);
    expect(globToRegExp("src/**/*.ts").test("src/a/b/c.ts")).toBe(true);
    expect(globToRegExp("src/**/*.ts").test("src/c.ts")).toBe(true);
    expect(globToRegExp("a?.ts").test("ab.ts")).toBe(true);
    expect(globToRegExp("a.ts").test("aXts")).toBe(false);
    // audit R2 #85 — an unterminated `{` used to reset the scan index to -1 and
    // loop forever; a bracket expression was classified as a glob and then
    // matched literally.
    expect(() => globToRegExp("scripts/*.{ts,mjs")).toThrow(/unterminated `{`/);
    expect(() => globToRegExp("scripts/[ab].mjs")).toThrow(/bracket expressions are not supported/);
    const root = mkdtempSync(join(tmpdir(), "tom-glob-"));
    mkdirSync(join(root, "scripts", "lib"), { recursive: true });
    writeFileSync(join(root, "scripts", "one.mjs"), "");
    writeFileSync(join(root, "scripts", "lib", "deep.mjs"), "");
    expect(globMatches(root, ".", "scripts/*.mjs")).toEqual(["scripts/one.mjs"]);
    expect(globMatches(root, ".", "scripts/**/*.mjs")).toEqual(["scripts/lib/deep.mjs", "scripts/one.mjs"]);
    expect(globMatches(root, ".", "nothing/*.mjs")).toEqual([]);
  });
  it("refuses a glob entry that matches no file — an unmatched root silently shrinks the graph", () => {
    const root = mkdtempSync(join(tmpdir(), "tom-"));
    mkdirSync(join(root, "server/mcp/src"), { recursive: true });
    writeFileSync(join(root, "src/main.tsx".replace("src/", "")), ""); // a stray file, not the entry
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/main.tsx"), "");
    writeFileSync(join(root, "server/mcp/src/cli.ts"), "");
    expect(() => assertGraphDefinition(good, root)).toThrow(/scripts\/\*\.mjs \(glob matches no file\)/);
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts/x.mjs"), "");
    expect(() => assertGraphDefinition(good, root)).not.toThrow();
  });
  it("reports patterns missing the `!` marker", () => {
    const bad = { workspaces: { ".": { entry: ["src/main.tsx"], project: ["src/**/*.ts!"] } } };
    expect(unmarkedPatterns(bad)).toEqual([".: entry src/main.tsx"]);
    expect(unmarkedPatterns(good)).toEqual([]);
  });
  it("refuses a config whose entry file is missing on disk (an empty graph would look like 100% findings)", () => {
    const root = mkdtempSync(join(tmpdir(), "tom-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/x.mjs"), "");
    expect(() => assertGraphDefinition(good, root)).toThrow(/production entry file\(s\) missing on disk/);
    writeFileSync(join(root, "src/main.tsx"), "");
    mkdirSync(join(root, "server/mcp/src"), { recursive: true });
    writeFileSync(join(root, "server/mcp/src/cli.ts"), "");
    expect(() => assertGraphDefinition(good, root)).not.toThrow();
  });
  it("refuses an unmarked pattern and a config with no literal entry", () => {
    expect(() => assertGraphDefinition({ workspaces: { ".": { entry: ["src/main.tsx"], project: [] } } }, ROOT)).toThrow(/production marker/);
    expect(() => assertGraphDefinition({ workspaces: { ".": { entry: ["src/*.tsx!"], project: ["src/**/*.ts!"] } } }, ROOT)).toThrow(/no literal production entry/);
  });
  it("the committed knip-production.json passes its own definition check and excludes the website workspace", () => {
    const config = readConfig(ROOT);
    expect(() => assertGraphDefinition(config, ROOT)).not.toThrow();
    expect(config.ignoreWorkspaces).toContain("website");
  });
});

describe("runKnip", () => {
  const fail = (props) => () => { throw Object.assign(new Error("spawn"), props); };
  it("accepts the report from knip's issues-found exit 1 when it lists a file, and a clean exit 0 that lists none", () => {
    // The VALIDATED list, not the raw text: `measure()` used to parse the same
    // report a second time, so one measurement had two readings (audit R3 #86).
    expect(runKnip(ROOT, fail({ status: 1, stdout: '{"files":["a.ts"]}', stderr: "" }))).toEqual(["a.ts"]);
    expect(runKnip(ROOT, () => '{"issues":[]}')).toEqual([]);
  });
  it("refuses a report that disagrees with the exit status (audit #57)", () => {
    expect(() => runKnip(ROOT, fail({ status: 1, stdout: '{"files":[]}', stderr: "" }))).toThrow(/exited 1 \(issues found\) but its JSON report lists no unused file/);
    expect(() => runKnip(ROOT, () => '{"files":["a.ts"]}')).toThrow(/exited 0 \(no issues\) but its JSON report lists 1 unused file/);
    expect(() => runKnip(ROOT, fail({ status: 1, stdout: '{"files":[{"path":"a.ts"}]}', stderr: "" }))).toThrow(/unknown shape/);
  });
  it("treats a crash as a crash even when its stdout looks like JSON, and a non-JSON exit 1 as a failure", () => {
    expect(() => runKnip(ROOT, fail({ status: 2, stdout: '{"issues":[]}', stderr: "ConfigurationError" }))).toThrow(/knip failed to run \(exit 2\): ConfigurationError/);
    expect(() => runKnip(ROOT, fail({ status: 1, stdout: "Unused files (3)", stderr: "" }))).toThrow(/knip failed to run/);
    expect(() => runKnip(ROOT, fail({ code: "ENOENT" }))).toThrow(/exit \?/);
  });
});

describe("updateDecision", () => {
  it("refuses to grow an existing baseline unless growth is explicitly allowed", () => {
    expect(updateDecision(["a.ts", "b.ts"], ["a.ts"])).toEqual({ added: ["b.ts"], removed: [], refused: true });
    expect(updateDecision(["a.ts", "b.ts"], ["a.ts"], { allowGrowth: true })).toEqual({ added: ["b.ts"], removed: [], refused: false });
    expect(updateDecision(["a.ts"], ["a.ts", "z.ts"])).toEqual({ added: [], removed: ["z.ts"], refused: false });
    // The first measurement (no baseline file yet — `null`) is never a refusal.
    expect(updateDecision(["a.ts"], null)).toEqual({ added: ["a.ts"], removed: [], refused: false });
  });
  it("still refuses growth once an existing baseline has reached zero (audit #59)", () => {
    expect(updateDecision(["a.ts"], [])).toEqual({ added: ["a.ts"], removed: [], refused: true });
    expect(updateDecision(["a.ts"], [], { allowGrowth: true })).toEqual({ added: ["a.ts"], removed: [], refused: false });
    expect(updateDecision([], [])).toEqual({ added: [], removed: [], refused: false });
  });
});

describe("compareWithBaseline", () => {
  it("is two-way: an unlisted finding and a stale entry both surface", () => {
    expect(compareWithBaseline(["a.ts", "c.ts"], ["a.ts", "b.ts"])).toEqual({ unlisted: ["c.ts"], stale: ["b.ts"] });
  });
  it("is silent on an exact match", () => {
    expect(compareWithBaseline(["a.ts", "b.ts"], ["b.ts", "a.ts"])).toEqual({ unlisted: [], stale: [] });
  });
});

describe("the baseline file", () => {
  it("--update writes a sorted, deduplicated identity list that readBaseline round-trips", () => {
    const root = mkdtempSync(join(tmpdir(), "tom-"));
    mkdirSync(join(root, "scripts"));
    writeBaseline(["z.ts", "a.ts", "a.ts"], root);
    const raw = JSON.parse(readFileSync(join(root, BASELINE_PATH), "utf8"));
    expect(raw.entries).toEqual(["a.ts", "z.ts"]);
    expect(readBaseline(root)).toEqual(["a.ts", "z.ts"]);
    // audit R2 #87 — the write goes through a sibling temp file and a rename,
    // so an interruption cannot leave a truncated baseline. The temp file must
    // not survive a successful write.
    expect(readdirSync(join(root, "scripts")).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });
  it("a missing baseline reads as null (an empty one is []); a malformed one fails loudly", () => {
    const root = mkdtempSync(join(tmpdir(), "tom-"));
    expect(readBaseline(root)).toBeNull();
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, BASELINE_PATH), JSON.stringify({ entries: [] }));
    expect(readBaseline(root)).toEqual([]);
    rmSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, BASELINE_PATH), JSON.stringify({ files: [] }));
    expect(() => readBaseline(root)).toThrow(/expected an `entries` array/);
    writeFileSync(join(root, BASELINE_PATH), JSON.stringify({ entries: ["a.ts", { name: "b.ts" }] }));
    expect(() => readBaseline(root)).toThrow(/entry is not a path string/);
    writeFileSync(join(root, BASELINE_PATH), JSON.stringify({ entries: ["a.ts", "a.ts"] }));
    expect(() => readBaseline(root)).toThrow(/duplicate entry a\.ts/);
  });
});

describe("on the live tree", () => {
  it("the gate exits 0 and its baseline holds no test-support path", () => {
    const baseline = readBaseline(ROOT) ?? [];
    expect(baseline.filter(isTestSupport)).toEqual([]);
    const out = execFileSync("node", ["scripts/check-test-only-modules.mjs"], { cwd: ROOT, encoding: "utf8" });
    expect(out).toMatch(/✓ check-test-only-modules: \d+ baselined, 0 new, 0 stale/);
  });
  it("exits 64 on an unknown flag, and on --allow-growth without --update", () => {
    for (const args of [["--bogus"], ["--allow-growth"]]) {
      let code = 0;
      try {
        execFileSync("node", ["scripts/check-test-only-modules.mjs", ...args], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
      } catch (err) {
        code = err.status;
      }
      expect(code, args.join(" ")).toBe(64);
    }
  });
});
