/**
 * Feature-metrics generator — self-test for the spine's flag-default check.
 *
 * WHY THIS EXISTS. `scripts/feature-map.json` records each gated feature's
 * shipped default (`flagDefault`) by hand, and the generated metrics table
 * prints it in the Gate column. On 2026-09-07 the spine still said
 * `browser.enabled = false` three weeks after `defaults.ts` had flipped it to
 * `true`, so the table confidently printed a wrong gate for the feature whose
 * gate matters most. Nothing measured that cell; it was prose in JSON.
 *
 * The generator now reads `src/stores/settingsStore/defaults.ts` and refuses
 * to generate when a spine default disagrees with the shipped one — the same
 * fail-closed posture it already takes for a path or doc that no longer
 * exists. These tests pin the comparison on a fixture, not on the live file,
 * so a legitimate default change does not turn this file red; the live check
 * happens when the generator runs.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODE_EXTENSIONS,
  countLines,
  coverageEligible,
  featureCoverage,
  featureInventory,
  joinSources,
  listFiles,
  normalizePaths,
  parseArgs,
  parseSettingsDefaults,
  run,
  spineErrors,
  spineShapeErrors,
  tokeiCode,
  verifyFlagDefaults,
} from "./gen-feature-ledger.mjs";
import { codeSpan, coverageCell, escapeCell, renderLedger } from "./lib/featureLedgerRender.mjs";

const GENERATOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "gen-feature-ledger.mjs");

const DEFAULTS_FIXTURE = `
import { resolveInitialLanguage } from "@/utils/localeDetect";

export const initialState: SettingsState = {
  general: {
    autoSaveEnabled: true,
    autoSaveInterval: 30,
    // a comment line inside a section
    language: resolveInitialLanguage(),
  },
  cjkFormatting: { ...DEFAULT_CJK_FORMATTING },
  markdown: {
    pasteMode: "smart", // Default: convert HTML to Markdown
    lintEnabled: true,
  },
  advanced: {
    mcpServer: {
      port: 9223,
      autoApproveEdits: false, // Require approval by default (safer)
    },
    developerMode: false,
  },
  browser: {
    enabled: true,
  },
  showDevSection: true,
};
`;

describe("parseSettingsDefaults", () => {
  it("flattens sections, nested groups and top-level scalars into dotted keys", () => {
    const m = parseSettingsDefaults(DEFAULTS_FIXTURE);
    expect(m.get("general.autoSaveEnabled")).toBe("true");
    expect(m.get("general.autoSaveInterval")).toBe("30");
    expect(m.get("markdown.pasteMode")).toBe('"smart"');
    expect(m.get("advanced.mcpServer.autoApproveEdits")).toBe("false");
    expect(m.get("advanced.developerMode")).toBe("false");
    expect(m.get("browser.enabled")).toBe("true");
    expect(m.get("showDevSection")).toBe("true");
  });

  it("keeps a non-literal default as its raw expression rather than guessing", () => {
    const m = parseSettingsDefaults(DEFAULTS_FIXTURE);
    expect(m.get("general.language")).toBe("resolveInitialLanguage()");
  });

  it("does not invent keys from comments or spread sections", () => {
    const m = parseSettingsDefaults(DEFAULTS_FIXTURE);
    expect([...m.keys()].some((k) => k.includes("comment"))).toBe(false);
    expect(m.has("cjkFormatting")).toBe(false);
  });

  it("reads formatting the line parser dropped: wrapped values, `key:{` without its space, a fourth level, a `satisfies` cast (audit #69)", () => {
    const src = `
export const initialState = {
  a: {
    b:{
      c: {
        d: false, // fourth level
      },
    },
    wrapped:
      "long",
    list: [1,
      2],
    "quoted-key": 3,
    shorthand,
    method() {},
  },
} satisfies SettingsState;
`;
    const m = parseSettingsDefaults(src);
    expect(m.get("a.b.c.d")).toBe("false");
    expect(m.get("a.wrapped")).toBe('"long"');
    expect(JSON.parse(m.get("a.list"))).toEqual([1, 2]);
    expect(m.get("a.quoted-key")).toBe("3");
    expect(m.has("a.shorthand")).toBe(false);
    expect(m.has("a.method")).toBe(false);
    expect(m.has("a.b.c")).toBe(false); // an object literal is descended, never recorded
  });

  it("returns an empty map when there is no exported initialState object, rather than guessing", () => {
    expect(parseSettingsDefaults("const initialState = { a: 1 };\n").size).toBe(0);
    expect(parseSettingsDefaults("export const initialState = build();\n").size).toBe(0);
  });

  // audit R2 #121 — TypeScript recovers from a syntax error by inventing
  // nodes, so a malformed source yields a PARTIAL map that reads as complete.
  it("records a parse error instead of reading a recovered fragment", () => {
    const broken = 'export const initialState = {\n  a: { b: true,\n  c: "x",\n';
    const m = parseSettingsDefaults(broken);
    expect(m.parseError).toBeTruthy();
    expect(m.size).toBe(0);
    const findings = verifyFlagDefaults([{ name: "F", paths: ["src"], flag: "a.b", flagDefault: true }], broken);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/does not parse/);
  });
});

describe("verifyFlagDefaults", () => {
  const spine = (flag, flagDefault) => [{ name: "F", paths: [], flag, flagDefault }];

  it("returns no findings when every spine default matches the shipped one", () => {
    const features = [
      { name: "A", paths: [], flag: "general.autoSaveEnabled", flagDefault: true },
      { name: "B", paths: [], flag: "markdown.pasteMode", flagDefault: "smart" },
      { name: "C", paths: [], flag: "advanced.mcpServer.autoApproveEdits", flagDefault: false },
      { name: "D", paths: [] }, // ungated — skipped
    ];
    expect(verifyFlagDefaults(features, DEFAULTS_FIXTURE)).toEqual([]);
  });

  // audit R2 #122 — a spread or a computed key can override a literal that is
  // right there in the source, and the parser skipped it silently.
  it("refuses a flag inside an object composed with a spread", () => {
    const src = 'export const initialState = {\n  cjkFormatting: { enabled: true, ...DEFAULTS },\n};\n';
    const findings = verifyFlagDefaults(
      [{ name: "F", paths: ["src"], flag: "cjkFormatting.enabled", flagDefault: true }],
      src,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/composed with a spread or a computed key/);
  });

  it("reports the exact drift that shipped: spine false, defaults.ts true", () => {
    const findings = verifyFlagDefaults(spine("browser.enabled", false), DEFAULTS_FIXTURE);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("browser.enabled");
    expect(findings[0]).toContain("spine=false");
    expect(findings[0]).toContain("defaults.ts=true");
  });

  it("compares string defaults by value, so a re-quoted string is not drift", () => {
    expect(verifyFlagDefaults(spine("markdown.pasteMode", "smart"), DEFAULTS_FIXTURE)).toEqual([]);
    const findings = verifyFlagDefaults(spine("markdown.pasteMode", "plain"), DEFAULTS_FIXTURE);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('defaults.ts="smart"');
  });

  it("reports a flag whose key is not in defaults.ts as not found, never as clean", () => {
    const findings = verifyFlagDefaults(spine("general.nonexistent", true), DEFAULTS_FIXTURE);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/not found/);
  });

  it("reports a flag whose shipped default is not a literal as unverifiable", () => {
    const findings = verifyFlagDefaults(spine("general.language", "en"), DEFAULTS_FIXTURE);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/not a literal/);
  });
});

// ---------------------------------------------------------------- audit 20260907 (G2 #68, #73–#79)

describe("parseArgs", () => {
  it("accepts only --since=<git date>, and rejects an empty or table-breaking value", () => {
    expect(parseArgs([])).toEqual({ since: "180 days ago" });
    expect(parseArgs(["--since=2026-01-01"])).toEqual({ since: "2026-01-01" });
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown argument "--bogus"/);
    expect(() => parseArgs(["--since="])).toThrow(/needs a git date expression/);
    expect(() => parseArgs(["--since=a|b"])).toThrow(/needs a git date expression/);
    expect(() => parseArgs(["--since=x\ny"])).toThrow(/needs a git date expression/);
  });
});

describe("measurement commands fail loudly instead of measuring zero", () => {
  it("run() throws on a non-zero exit — an empty result is not a count", () => {
    expect(run("printf", ["x"])).toBe("x");
    expect(() => run("sh", ["-c", "exit 3"])).toThrow();
  });

  it("tokeiCode is `--` (null) only when tokei is absent; any other failure throws", () => {
    const enoent = () => { throw Object.assign(new Error("spawn tokei ENOENT"), { code: "ENOENT" }); };
    expect(tokeiCode(["src"], enoent)).toBeNull();
    const crash = () => { throw Object.assign(new Error("boom"), { status: 1, stderr: "tokei: bad path" }); };
    expect(() => tokeiCode(["src"], crash)).toThrow(/tokei failed for src: tokei: bad path/);
    const ok = () => JSON.stringify({
      TypeScript: { code: 10, children: { Tsx: [{ stats: { code: 5 } }] } },
      Rust: { code: 7 },
      JSON: { code: 900 },
      Total: { code: 999 },
    });
    expect(tokeiCode(["src"], ok)).toBe(22);
  });

  it("listFiles propagates a find failure rather than returning an empty list", () => {
    expect(() => listFiles(["/nonexistent/path/for/the/ledger"])).toThrow();
  });

  // audit R2 #127 — tokei used to be handed the feature's DIRECTORIES plus
  // `--exclude *.test.*`. Measured on tokei 15.0.0, that exclusion does NOT
  // apply to a path named explicitly as a FILE, and this spine names test
  // files explicitly (`src-tauri/src/content_search.test.rs` is one of "Find
  // in files"'s paths). 2,582 lines of test code across five features were
  // therefore counted BOTH as production Code and as Test lines, under a
  // provenance table that says "tests excluded".
  //
  // The fix is that tokei measures the EXPLICIT non-test source list, so the
  // two populations cannot differ. This test constructs the exact shape that
  // defeated the exclusion — a test file passed as its own argument.
  it("tokei measures the source files it is given, so a test file cannot slip into the Code column", () => {
    const root = mkdtempSync(join(tmpdir(), "ledger-tokei-"));
    writeFileSync(join(root, "main.ts"), "const a = 1;\n");
    writeFileSync(join(root, "main.test.ts"), "const b = 1;\nconst c = 2;\nconst d = 3;\n");
    const runner = (cmd, args) => run(cmd, args, { cwd: root });
    const { src, test, code } = featureInventory(["."], runner);
    expect(src.map((f) => f.replace(/^\.\//, ""))).toEqual(["main.ts"]);
    expect(test.map((f) => f.replace(/^\.\//, ""))).toEqual(["main.test.ts"]);
    expect(code).toHaveLength(2);
    // The Code column is the `src` view alone — one line, not four.
    expect(tokeiCode(src, runner)).toBe(1);
    // The shape that used to defeat `--exclude`: naming the test file directly
    // still counts it, whatever exclusions are passed. That is the measurement
    // behind this change, reproduced here so it cannot be argued away.
    expect(tokeiCode(test, runner)).toBe(3);
    const bypassed = JSON.parse(
      run("tokei", [join(root, "main.test.ts"), "--output", "json", "--exclude", "*.test.*"], { cwd: root }),
    );
    expect(bypassed.TypeScript.code).toBe(3);
  });

  // The mechanism, pinned directly: tokei is asked for FILES, never for a
  // directory plus an exclusion it does not honour on explicit arguments.
  it("passes tokei the source files and no --exclude flag at all", () => {
    const seen = [];
    const spy = (_cmd, args) => {
      seen.push(args);
      return JSON.stringify({ TypeScript: { code: 1 } });
    };
    expect(tokeiCode(["a/main.ts"], spy)).toBe(1);
    expect(seen[0]).toEqual(["a/main.ts", "--output", "json"]);
    expect(seen[0]).not.toContain("--exclude");
  });

  it("tokeiCode measures nothing without spawning tokei when a feature has no source file", () => {
    const never = () => { throw new Error("tokei must not be spawned for an empty list"); };
    expect(tokeiCode([], never)).toBe(0);
  });

  // audit R2 #120 — a file holding the literal `null` read as ABSENT, and a
  // malformed one threw a SyntaxError naming no path.
  it("names the unreadable source instead of throwing a pathless SyntaxError", () => {
    const root = mkdtempSync(join(tmpdir(), "ledger-json-"));
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/feature-map.json"), "{ not json");
    const broken = spawnSync(process.execPath, [GENERATOR], { cwd: root, encoding: "utf8" });
    expect(broken.status).toBe(66);
    expect(broken.stderr).toContain("scripts/feature-map.json: not valid JSON");
    writeFileSync(join(root, "scripts/feature-map.json"), "null");
    const nulled = spawnSync(process.execPath, [GENERATOR], { cwd: root, encoding: "utf8" });
    expect(nulled.status).toBe(66);
    expect(nulled.stderr).toContain("holds the literal null");
    expect(nulled.stderr).not.toContain("missing");
  });
});

// ---------------------------------------------------------------- audit 20260907 (W2 #70, #71)

describe("file enumeration", () => {
  const scratch = () => {
    const root = mkdtempSync(join(tmpdir(), "ledger-files-"));
    return { root, runner: (cmd, args) => run(cmd, args, { cwd: root }) };
  };

  it("listFiles enumerates every extension tokei counts as code — .js/.jsx/.mjs/.mts included — and nothing else", () => {
    const { root, runner } = scratch();
    const code = CODE_EXTENSIONS.map((ext) => `f.${ext}`);
    for (const name of [...code, "g.json", "h.md", "i.css", "j.yml"]) writeFileSync(join(root, name), "");
    const listed = listFiles(["."], runner).map((f) => f.replace(/^\.\//, "")).sort();
    expect(listed).toEqual([...code].sort());
    expect(CODE_EXTENSIONS).toEqual(expect.arrayContaining(["js", "jsx", "mjs", "mts"]));
  });

  it("normalizePaths drops duplicates and nested entries, and one path spelled two ways is one path", () => {
    expect(normalizePaths(["a/", "./a", "a/b", "c", "c", "cd"])).toEqual(["a", "c", "cd"]);
  });

  // audit R2 #126 — `find`, tokei and `git log` all recurse, so an equivalent
  // spelling that survives normalization measures the same files twice.
  it("normalizePaths collapses `..`, `.` and repeated separators to one canonical path", () => {
    expect(normalizePaths(["a//b", "a/./b", "a/c/../b"])).toEqual(["a/b"]);
    expect(normalizePaths(["src/x/../.."])).toEqual(["."]);
  });

  it("spineShapeErrors refuses a path that is absolute or climbs out of the repository", () => {
    expect(spineShapeErrors({ features: [{ name: "F", paths: ["../elsewhere"] }] }))
      .toEqual(["F: a path is absolute or climbs out of the repository -> ../elsewhere"]);
    expect(spineShapeErrors({ features: [{ name: "F", paths: ["/etc"] }] }))
      .toEqual(["F: a path is absolute or climbs out of the repository -> /etc"]);
  });

  // audit R2 #128 — a newline is legal in a filename; splitting `find` output
  // on one turned a single file into two paths that do not exist.
  it("listFiles reads NUL-delimited output, so a newline in a filename is one file", () => {
    const { root, runner } = scratch();
    writeFileSync(join(root, "we\nird.ts"), "");
    writeFileSync(join(root, "plain.ts"), "");
    expect(listFiles(["."], runner).map((f) => f.replace(/^\.\//, "")).sort()).toEqual(["plain.ts", "we\nird.ts"]);
  });

  it("overlapping paths list each file once after normalization — find recurses, so a a/b counted a/b twice", () => {
    const { root, runner } = scratch();
    mkdirSync(join(root, "a", "b"), { recursive: true });
    writeFileSync(join(root, "a", "b", "x.ts"), "");
    expect(listFiles(["a", "a/b"], runner)).toEqual(["a/b/x.ts", "a/b/x.ts"]);
    expect(listFiles(normalizePaths(["a", "a/b"]), runner)).toEqual(["a/b/x.ts"]);
  });
});

describe("countLines", () => {
  it.each([
    ["", 0],
    ["a", 1],
    ["a\n", 1],
    ["a\nb", 2],
    ["a\nb\n", 2],
  ])("%j → %i (a trailing newline is not an extra line)", (text, n) => {
    expect(countLines(text)).toBe(n);
  });
});

// audit R2 #123 — nothing validated the map, so `{"features": []}` produced an
// authoritative EMPTY ledger and `"paths": []` reached find/tokei/git with no
// path operand (where `find` defaults to the working directory).
describe("spineShapeErrors", () => {
  it("refuses a map with no features, and one with an empty paths array", () => {
    expect(spineShapeErrors({ features: [] })).toEqual(["feature-map.json: `features` is empty — an empty ledger is not a measurement"]);
    expect(spineShapeErrors({})).toEqual(["feature-map.json: expected a `features` array"]);
    expect(spineShapeErrors({ features: [{ name: "F", paths: [] }] })[0]).toMatch(/non-empty array/);
    expect(spineShapeErrors({ features: [{ name: "F", paths: ["./"] }] })[0]).toMatch(/normalises away to nothing/);
    expect(spineShapeErrors({ features: [{ name: "F", paths: ["."] }] })[0]).toMatch(/normalises away to nothing/);
    expect(spineShapeErrors({ features: [{ paths: ["src"] }] })[0]).toMatch(/non-empty `name`/);
    expect(spineShapeErrors({ features: [{ name: "F", paths: ["src"] }, { name: "F", paths: ["e2e"] }] })[0]).toMatch(/duplicate feature name/);
    expect(spineShapeErrors({ features: [{ name: "F", paths: ["src", ""] }] })[0]).toMatch(/not a non-empty string/);
  });

  it("accepts the real feature map", () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    expect(spineShapeErrors(JSON.parse(readFileSync(join(repo, "scripts/feature-map.json"), "utf8")))).toEqual([]);
  });
});

describe("spineErrors", () => {
  const spine = (paths, extra = {}) => ({ features: [{ name: "F", paths, ...extra }] });
  const DEFAULTS = "export const initialState = {\n};\n";
  const scratch = () => {
    const root = mkdtempSync(join(tmpdir(), "ledger-spine-"));
    mkdirSync(join(root, "empty"));
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data", "strings.json"), "{}");
    mkdirSync(join(root, "code"));
    writeFileSync(join(root, "code", "a.ts"), "");
    return { root, runner: (cmd, args) => run(cmd, args, { cwd: root }) };
  };
  it("refuses an empty directory — a path with no file measures as a misleading zero", () => {
    const { root, runner } = scratch();
    expect(spineErrors(root, spine(["empty"]), DEFAULTS, runner)).toEqual(["F: path holds no file at all (its measured zeros would be about nothing) -> empty"]);
    expect(spineErrors(root, spine(["missing"]), DEFAULTS, runner)).toEqual(["F: path does not exist -> missing"]);
    expect(spineErrors(root, spine(["code"], { doc: "website/guide/nope.md" }), DEFAULTS, runner)).toEqual(["F: doc does not exist -> website/guide/nope.md"]);
    expect(spineErrors(root, spine(["code"]), null, runner)).toEqual(["src/stores/settingsStore/defaults.ts missing — flag defaults cannot be verified"]);
  });
  it("classifies data-only paths explicitly, two-way (audit #74)", () => {
    const { root, runner } = scratch();
    // A data path is legitimate only when DECLARED: it has files, just no code.
    expect(spineErrors(root, spine(["data"]), DEFAULTS, runner)).toEqual(["F: path holds no code file — declare it under dataOnly if it is data (locales, bundled resources), else the code moved -> data"]);
    expect(spineErrors(root, spine(["data", "code"], { dataOnly: ["data"] }), DEFAULTS, runner)).toEqual([]);
    // A stale declaration is an error too, and so is declaring a path the feature does not list.
    expect(spineErrors(root, spine(["code"], { dataOnly: ["code"] }), DEFAULTS, runner)).toEqual(["F: path is declared dataOnly but holds code files -> code"]);
    expect(spineErrors(root, spine(["code"], { dataOnly: ["data"] }), DEFAULTS, runner)).toEqual(["F: dataOnly names a path that is not one of its paths -> data"]);
  });
});

describe("joinSources", () => {
  const good = {
    fileSize: { files: { "src/a.ts": 310 }, testFiles: {} },
    mockB: { "//": "prose", entries: [{ file: "src/a.test.ts", api: "vi.mock", target: "src/b" }] },
    depX: [{ from: "src/a.ts", to: "src/b.ts", rule: { name: "r" } }],
    coupling: { units: { plugin: { services: 1 }, other: 2 } },
  };
  it("accepts the shipped shapes, including EMPTY containers (a ratchet that reached zero)", () => {
    expect(joinSources(good).problems).toEqual([]);
    const empty = joinSources({ fileSize: { files: {}, testFiles: {} }, mockB: { entries: [] }, depX: [], coupling: { units: {} } });
    expect(empty.problems).toEqual([]);
    expect(empty).toMatchObject({ fileSizeFlat: {}, mockRecords: [], depRecords: [], couplingUnits: {} });
  });
  it("names a container of the wrong shape and a record missing the field the join keys on", () => {
    const { problems } = joinSources({
      fileSize: { files: [] },
      mockB: { entries: [{ api: "vi.mock" }] },
      depX: { modules: [] },
      coupling: { units: { plugin: "one" } },
    });
    expect(problems).toEqual([
      "file-size-baseline.json: expected `files` and `testFiles` objects",
      "mock-boundaries-baseline.json: entry 0 has no non-empty string `file`",
      ".dependency-cruiser-known-violations.json: expected a root array",
      "plugin-store-coupling-baseline.json: plugin is neither a count nor a map of counts",
    ]);
    expect(joinSources({ ...good, fileSize: null }).problems).toEqual(["file-size-baseline.json: expected `files` and `testFiles` objects"]);
    expect(joinSources({ ...good, depX: [{ source: "src/a.ts" }] }).problems).toEqual([".dependency-cruiser-known-violations.json: entry 0 has no non-empty string `from`"]);
  });
});

describe("coverage", () => {
  const root = "/repo";
  const abs = (rel) => `${root}/${rel}`;
  const lines = (covered, total) => ({ lines: { covered, total } });
  it("coverageEligible mirrors the coverage excludes and drops type-only modules", () => {
    expect(coverageEligible([
      "src/a.ts", "src/b.tsx", "src/c.d.ts", "src/d/index.ts", "src/e.config.ts", "src/test/f.ts", "src/assets/g.ts",
      "src/h/types.ts", "src/i.types.ts", "src-tauri/src/j.rs", "server/mcp/src/k.ts",
    ])).toEqual(["src/a.ts", "src/b.tsx"]);
  });
  it("reports a percentage only when EVERY eligible file is in the summary", () => {
    const summary = { total: lines(1, 1), [abs("src/a.ts")]: lines(8, 10), [abs("src/b.tsx")]: lines(2, 10) };
    expect(featureCoverage(summary, ["src/a.ts", "src/b.tsx"], root)).toEqual({ pct: 50, seen: 2, expected: 2 });
    expect(featureCoverage(summary, ["src/a.ts", "src/b.tsx", "src/untested.ts"], root)).toEqual({ pct: null, seen: 2, expected: 3 });
    expect(featureCoverage(null, ["src/a.ts"], root)).toEqual({ pct: null, seen: 0, expected: 1 });
    expect(featureCoverage(summary, [], root)).toEqual({ pct: null, seen: 0, expected: 0 });
    // audit R2 #132 — a record with no numeric `lines` is not a measurement of
    // that file; counting it as `seen` made a partial summary look complete.
    const partial = { ...summary, [`${root}/src/c.ts`]: { statements: { covered: 1, total: 1 } } };
    expect(featureCoverage(partial, ["src/a.ts", "src/b.tsx", "src/c.ts"], root)).toEqual({ pct: null, seen: 2, expected: 3 });
  });
  // audit R2 #131 — `/repo-old/src/a.ts` starts with `/repo`, and the prefix
  // slice keyed it as `ld/src/a.ts`; a sibling checkout is not this tree.
  it("ignores a summary entry from a sibling directory that merely shares the root prefix", () => {
    const summary = { total: lines(1, 1), [`${root}-old/src/a.ts`]: lines(10, 10) };
    expect(featureCoverage(summary, ["src/a.ts"], root)).toEqual({ pct: null, seen: 0, expected: 1 });
    expect(featureCoverage({ total: lines(1, 1), [abs("src/a.ts")]: lines(10, 10) }, ["src/a.ts"], root))
      .toEqual({ pct: 100, seen: 1, expected: 1 });
  });
  it("coverageCell says how partial a partial summary is, and stays `--` without one", () => {
    expect(coverageCell({ pct: 73.25, seen: 3, expected: 3 }, true)).toBe("73.3%");
    expect(coverageCell({ pct: null, seen: 7, expected: 12 }, true)).toBe("-- (7/12 files)");
    expect(coverageCell({ pct: null, seen: 0, expected: 0 }, true)).toBe("--");
    expect(coverageCell({ pct: null, seen: 0, expected: 5 }, false)).toBe("--");
  });
  // audit R2 #163 — every number in this table is a measurement; `NaN%` and
  // `140.0%` are not, so the cell refuses rather than printing one.
  it("refuses a coverage value that is not a percentage from 0 through 100", () => {
    expect(() => coverageCell({ pct: NaN, seen: 1, expected: 1 }, true)).toThrow(/not a percentage/);
    expect(() => coverageCell({ pct: Infinity, seen: 1, expected: 1 }, true)).toThrow(/not a percentage/);
    expect(() => coverageCell({ pct: 140, seen: 1, expected: 1 }, true)).toThrow(/not a percentage/);
    expect(() => coverageCell({ pct: -1, seen: 1, expected: 1 }, true)).toThrow(/not a percentage/);
  });
});

describe("rendering", () => {
  const row = (over = {}) => ({
    name: "F", flag: null, flagDefault: undefined, doc: null, code: 10, srcFiles: 1, testFiles: 1, testLines: 5,
    cov: { pct: null, seen: 0, expected: 0 }, bigFiles: 0, mocks: 0, dep: 0, coup: 0, commits: 1, last: "2026-09-07", ...over,
  });
  it("escapes pipes and flattens newlines in every interpolated cell", () => {
    expect(escapeCell("a|b\nc")).toBe("a\\|b c");
    const doc = renderLedger([row({ name: "Pipe|Feature", flag: "x|y", flagDefault: "v|w", last: "20|26" })], { since: "1 day|ago", defaultsRel: "d.ts", covPresent: false });
    const table = doc.split("\n").find((l) => l.startsWith("| Pipe"));
    expect(table).toBe("| Pipe\\|Feature | 10 | 1 | 1 | 0.50 | -- | 0 | 0 | 0 | 0 | 1 | 20\\|26 | `x\\|y`=\"v\\|w\" |");
    expect(doc).toContain("commits since `1 day\\|ago`");
    expect(doc).toContain("- Pipe\\|Feature (10 lines of code)");
  });
  // audit R2 #168 — `defaultsRel` is interpolated twice, once in prose and
  // once inside a table CELL, and both sites wrote it between hand-typed
  // backticks: a backtick in the path closed the span early, and a pipe split
  // the provenance row. It goes through codeSpan at both, like every other
  // value this module renders as code.
  it("renders the defaults path through codeSpan at both of its sites", () => {
    const doc = renderLedger([row()], { since: "1 day ago", defaultsRel: "de`faults|x.ts", covPresent: false });
    const fenced = codeSpan("de`faults|x.ts");
    expect(fenced).toBe("`` de`faults\\|x.ts ``");
    expect(doc.split(fenced).length - 1).toBe(2);
    expect(doc).not.toContain("`de`faults");
    // The provenance row still has its four cells, unsplit by the pipe.
    const provenance = doc.split("\n").find((l) => l.startsWith("| Gate |"));
    expect(provenance.split(/(?<!\\)\|/)).toHaveLength(5);
  });

  it("escapes Markdown and HTML openers in plain cells, and fences a code span past any backtick inside (audit #79)", () => {
    expect(escapeCell("<b>x</b> *y* _z_ [l] `c` ~s~ \\")).toBe("\\<b\\>x\\</b\\> \\*y\\* \\_z\\_ \\[l\\] \\`c\\` \\~s\\~ \\\\");
    expect(codeSpan("plain.flag")).toBe("`plain.flag`");
    expect(codeSpan("a`b")).toBe("`` a`b ``");
    expect(codeSpan("a``b|c")).toBe("``` a``b\\|c ```");
    const doc = renderLedger([row({ name: "<script>alert(1)</script>", flag: "we`ird", flagDefault: "*v*" })], { since: "1 day ago", defaultsRel: "d.ts", covPresent: false });
    expect(doc).not.toContain("<script>");
    expect(doc).toContain("| \\<script\\>alert(1)\\</script\\> |");
    expect(doc).toContain("`` we`ird ``=\"\\*v\\*\"");
  });
  // audit R2 #161/#162 — a lone CR is a CommonMark line ending, and `&copy;`
  // renders as `©` unless the ampersand is escaped; both broke the contract
  // that a plain cell renders as the value it was given.
  it("flattens a lone carriage return and escapes an entity opener", () => {
    expect(escapeCell("a\rb")).toBe("a b");
    expect(escapeCell("a\r\nb")).toBe("a b");
    // Only an entity-shaped `&` changes what a reader sees; an ordinary one
    // stays readable in the source.
    expect(escapeCell("&copy; &#169; &#xA9; A & B")).toBe("\\&copy; \\&#169; \\&#xA9; A & B");
    expect(codeSpan("a\rb")).toBe("`a b`");
  });
  // audit R2 #164 — the legend says `--` means NOT MEASURED, which is not the
  // same claim as `0`; a measured feature with no test lines is `0.00`.
  it("renders a measured zero as 0.00 and an unmeasurable ratio as --", () => {
    const zero = renderLedger([row({ name: "Z", testLines: 0 })], { since: "x", defaultsRel: "d.ts", covPresent: false });
    expect(zero.split("\n").find((l) => l.startsWith("| Z "))).toContain("| 0.00 |");
    const noCode = renderLedger([row({ name: "N", code: 0, testLines: 5 })], { since: "x", defaultsRel: "d.ts", covPresent: false });
    expect(noCode.split("\n").find((l) => l.startsWith("| N "))).toContain("| -- |");
  });
  // audit R2 #165/#166 — an absent measurement is `--`, never a confident `0`,
  // and a non-numeric one is never interpolated into the row verbatim.
  it("renders an absent or non-numeric count as --, not as 0", () => {
    const doc = renderLedger([row({ name: "M", bigFiles: undefined, mocks: NaN, dep: null, coup: "3|4", commits: undefined })], {
      since: "x", defaultsRel: "d.ts", covPresent: false,
    });
    const line = doc.split("\n").find((l) => l.startsWith("| M "));
    expect(line).toBe("| M | 10 | 1 | 1 | 0.50 | -- | -- | -- | -- | -- | -- | 2026-09-07 | always on |");
  });
});
