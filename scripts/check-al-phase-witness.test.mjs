// WI-AL2.0g — every phase 2 and phase 3 Definition-of-Done row maps to one named executable witness: the named test exists under exactly that title in a file linked to its work item, is not skipped, focused or a table, its own code matches every assertion, and it runs alone to exactly one pass | AL2.2g: an e2e journey witnesses a native row by its exported name, and its run step needs the journey runner's one PASS (red with no live app)
/**
 * Runs the REAL `scripts/check-al-phase.sh <2|3>` against fixture trees
 * (`--root`) built from scripts/al-witnesses.json and the per-assertion
 * fixture lines of scripts/check-al-phase-witness.samples.mjs. The positive
 * tree passes every witness; a tree written without assertion k fails every
 * row that has one, by name; each variant (skipped, focused, table, comment
 * only, unlinked, unmounted, uncalled helper, duplicate, ignored, missing)
 * fails its row and only its row. With `--no-exec` the run step is
 * UNVERIFIED; with stub `pnpm`/`cargo` on PATH it runs one test and reads
 * vitest's JSON report or cargo's per-test lines, so a skip, a duplicate or a
 * zero-test run is red.
 *
 * Also under WI-AL0.7: the phase gate self-tests share the stub pattern of
 * scripts/check-al-phase.test.mjs.
 *
 * @coordinates-with scripts/al-witnesses.json — the rows under test
 * @coordinates-with scripts/al-witness.mjs — the static check and the report readers
 * @coordinates-with scripts/lib/al-witness.sh — al_witnesses, the gate helper
 * @module scripts/check-al-phase-witness.test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SAMPLES } from "./check-al-phase-witness.samples.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const PHASE = path.join(REPO, "scripts", "check-al-phase.sh");
const CLI = path.join(REPO, "scripts", "al-witness.mjs");
const MANIFEST = JSON.parse(readFileSync(path.join(REPO, "scripts", "al-witnesses.json"), "utf8"));
const ROWS = Object.entries(MANIFEST.phases).flatMap(([phase, rows]) => rows.map((r) => ({ ...r, phase })));
const byRow = (name) => ROWS.find((r) => r.row === name) ?? (() => { throw new Error(`no manifest row ${name}`); })();
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function write(root, rel, body) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}

// pnpm: `e2e:journeys --only <name>` prints the journey runner's line for
// that name, shaped by SHIM_E2E (pass, skip, fail, none: no app running); a
// `--reporter=json` run writes a report for the title its `-t` pattern names,
// shaped by SHIM_VITEST (pass, skip, dup, fail, none); any other run exits 0.
// cargo: a run whose filter is a fn name prints that test's line, shaped by
// SHIM_CARGO (ok, ignored, dup, none); a module filter prints a 3-test
// result, as in scripts/check-al-phase.test.mjs.
const STUB = `#!/usr/bin/env bash
echo "$(basename "$0") $*" >> "$STUB_LOG"
if [[ "$(basename "$0")" == pnpm && "$1" == e2e:journeys ]]; then
  name="$3"
  case "\${SHIM_E2E:-pass}" in
    pass) echo "  PASS  $name (1ms)"; echo "JOURNEYS PASSED — 1 passed, 0 failed" ;;
    skip) echo "  SKIP  $name (1ms) — no workspace"; echo "JOURNEYS PASSED — 0 passed, 0 failed" ;;
    fail) echo "  FAIL  $name (1ms)"; echo "JOURNEYS FAILED — 0 passed, 1 failed"; exit 1 ;;
    none) echo "could not connect to the automation bridge"; exit 1 ;;
  esac
  exit 0
fi
if [[ "$(basename "$0")" == pnpm ]]; then
  out=""; pat=""; prev=""
  for a in "$@"; do
    case "$a" in --outputFile=*) out="\${a#--outputFile=}" ;; esac
    [[ "$prev" == -t ]] && pat="$a"
    prev="$a"
  done
  [[ -n "$out" ]] || exit 0
  mode="\${SHIM_VITEST:-pass}"
  [[ "$mode" == none ]] && exit 0
  node "$(dirname "$0")/report.mjs" "$out" "$pat" "$mode"
  [[ "$mode" == fail ]] && exit 1
  exit 0
fi
last="\${*: -1}"
if [[ "$last" == *:: ]]; then echo "test result: ok. 3 passed; 0 failed"; exit 0; fi
case "\${SHIM_CARGO:-ok}" in
  ok) echo "test agent_journal::w_tests::$last ... ok"; echo "test result: ok. 1 passed; 0 failed" ;;
  ignored) echo "test agent_journal::w_tests::$last ... ignored"; echo "test result: ok. 0 passed; 0 failed; 1 ignored" ;;
  dup) echo "test agent_journal::w_tests::$last ... ok"; echo "test agent_journal::v_tests::$last ... ok"; echo "test result: ok. 2 passed; 0 failed" ;;
  none) echo "test result: ok. 0 passed; 0 failed" ;;
esac
exit 0
`;

/**
 * The pnpm stub's report writer: the `-t` pattern `(^| )<escaped title>$` back
 * to its title, one result shaped by the mode. Its source is written out as a
 * script, so it names no import: vitest's transform renames imported bindings
 * inside this file, and the written copy would call a name that does not exist.
 */
function stubReport(write, out, pat, mode) {
  let title = "";
  const body = pat.slice("(^| )".length, -1);
  for (let i = 0; i < body.length; i++) title += body[i] === "\\" ? body[++i] : body[i];
  const status = mode === "skip" ? "skipped" : mode === "fail" ? "failed" : "passed";
  const results = [{ title, status }];
  if (mode === "dup") results.push({ title, status: "passed" });
  write(out, JSON.stringify({
    numPassedTests: results.filter((r) => r.status === "passed").length, numFailedTests: status === "failed" ? 1 : 0,
    numPendingTests: status === "skipped" ? 1 : 0, testResults: [{ assertionResults: results }],
  }));
}

const isRust = (row) => row.runner === "cargo";
const isJourney = (row) => row.runner === "e2e";
const indent = (lines) => lines.map((l) => `  ${l}`).join("\n");
const tsCase = (row, lines, how = "it") => `${how}(${JSON.stringify(row.title)}, async () => {\n${indent(lines)}\n});\n`;
const rustCase = (row, lines, attrs = "#[test]\n") => `${attrs}fn ${row.title}() {\n${indent(lines)}\n}\n`;
const journeyCase = (row, lines, run = `  async run(client, ctx) {\n${lines.map((l) => `    ${l}`).join("\n")}\n  },\n`) =>
  `export default {\n  name: ${JSON.stringify(row.title)},\n${run}};\n`;
const mountLine = (file) => `#[cfg(test)]\n#[path = "${path.basename(file)}"]\nmod ${path.basename(file, ".test.rs")}_tests;\n`;

/**
 * A fixture tree with every witness file of the manifest. `drop: k` writes
 * every row without its k-th assertion line; `cases[row]` replaces a row's
 * case text (given the row and its lines); `headers[file]` replaces a file's
 * header; `skip` leaves files out; `unmounted` leaves Rust files unmounted.
 */
function tree({ drop, cases = {}, headers = {}, skip = [], unmounted = [] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "al-witness-"));
  made.push(root);
  for (const tool of ["pnpm", "cargo"]) {
    write(root, `bin/${tool}`, STUB);
    chmodSync(path.join(root, "bin", tool), 0o755);
  }
  write(root, "bin/report.mjs", `import { writeFileSync } from "node:fs";\n${stubReport}\nstubReport(writeFileSync, ...process.argv.slice(2));\n`);
  const files = Map.groupBy(ROWS, (r) => r.file);
  const mounts = [];
  for (const [file, rows] of files) {
    if (skip.includes(file)) continue;
    const header = headers[file] ?? `// ${[...new Set(rows.map((r) => r.wi))].join(" ")} — witness fixture\n`;
    const prelude = file.endsWith(".rs") || file.endsWith(".mjs") ? "" : 'import { describe, expect, it } from "vitest";\n';
    const body = rows.map((r) => {
      const lines = SAMPLES[r.row].filter((_, i) => i !== drop);
      return (cases[r.row] ?? (isRust(r) ? rustCase : isJourney(r) ? journeyCase : tsCase))(r, lines);
    });
    write(root, file, `${header}${prelude}\n${body.join("\n")}`);
    if (file.endsWith(".rs") && !unmounted.includes(file)) mounts.push(mountLine(file));
  }
  write(root, "src-tauri/src/lib.rs", "pub mod agent_journal;\n");
  write(root, "src-tauri/src/agent_journal/mod.rs", mounts.join("\n"));
  return root;
}

/** The phase gate's output; `exec` drops `--no-exec` and puts the stubs first on PATH. */
function run(phase, root, { exec = false, env = {} } = {}) {
  const log = path.join(root, "stub.log");
  writeFileSync(log, "");
  const args = [PHASE, String(phase), `--root=${root}`, ...(exec ? [] : ["--no-exec"])];
  const r = spawnSync("bash", args, {
    encoding: "utf8",
    cwd: REPO,
    timeout: 300_000,
    killSignal: "SIGKILL",
    env: { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH}`, STUB_LOG: log, ...env },
  });
  if (r.error) throw r.error;
  return { out: `${r.stdout}${r.stderr}`, status: r.status, log: readFileSync(log, "utf8") };
}

const lineOf = (out, prefix) => out.split("\n").find((l) => l.includes(prefix)) ?? "";
const staticLine = (out, row) => lineOf(out, `phase ${row.phase} witness — ${row.row}`);
const runLine = (out, row) => lineOf(out, `phase ${row.phase} witness run — ${row.row}`);

describe("the witness manifest and its fixture lines", () => {
  it("every manifest row has one fixture line per assertion, and no fixture line is orphaned", () => {
    for (const r of ROWS) expect(SAMPLES[r.row]?.length, r.row).toBe(r.assert.length);
    expect(Object.keys(SAMPLES).filter((k) => !ROWS.some((r) => r.row === k))).toEqual([]);
  });

  it.each(ROWS.map((r) => [r.row, r]))("%s: all its lines satisfy every assertion, and without line k assertion k fails", (_, r) => {
    r.assert.forEach((re, k) => {
      expect(SAMPLES[r.row].join("\n"), `all lines vs /${re}/`).toMatch(new RegExp(re));
      expect(SAMPLES[r.row].filter((_, i) => i !== k).join("\n"), `the row without line ${k} vs /${re}/`).not.toMatch(new RegExp(re));
    });
  });

  // The DoD rows the plan names, each pinned to a row: a manifest edit that
  // drops one fails here before any gate runs.
  it.each([
    ["2", /later disjoint human edit/], ["2", /R24 oracle.*nonzero successes.*refusals change nothing/], ["2", /net-zero capture, end to end/],
    ["2", /net-zero capture, in the production collector/], ["2", /admission outcome: a write error/], ["2", /admission outcome: an fsync failure/],
    ["2", /admission outcome: success/], ["2", /WYSIWYG widening shown/], ["2", /^600 review rows.*100 ms$/], ["2", /^keep B of \{A, B\}, restart → only A pending$/],
    ["2", /^aZ\/Za/], ["2", /remount without a certificate refuses/], ["2", /^trust boundary: no MCP operation schema/],
    ["2", /^trust boundary: the bridge refuses/], ["2", /^trust boundary: a capture seq regression/], ["2", /^staged blob visibility/],
    ["2", /^admission-owned state/], ["2", /^live = replay/], ["2", /^compaction of admissions/], ["2", /^duplicate states/],
    ["2", /^uncertainty contract/], ["2", /^writer-bound certificate/], ["3", /^selection across headings/], ["3", /^every WI-AL0\.9 fixture/],
    ["3", /^a future record stops before repair/], ["3", /^physical cap/], ["3", /^terminal reserve/],
  ])("phase %s has a witness row matching %s", (phase, re) => {
    expect(MANIFEST.phases[phase].filter((r) => re.test(r.row))).not.toHaveLength(0);
  });
});

describe("check-al-phase.sh 2 and 3 — static witnesses (--no-exec)", () => {
  it.each(["2", "3"])("phase %s: the full fixture tree passes every witness, and each run step is UNVERIFIED", (phase) => {
    const { out } = run(phase, tree());
    for (const r of ROWS.filter((x) => x.phase === phase)) {
      expect(staticLine(out, r), out).toMatch(/^\s*✓/);
      expect(runLine(out, r), out).toMatch(/^\s*\? .*UNVERIFIED/);
    }
  });

  it.each(["2", "3"])("phase %s: a bare tree fails every witness by name, the file missing", (phase) => {
    const { out, status } = run(phase, tree({ skip: ROWS.map((r) => r.file) }));
    expect(status).not.toBe(0);
    for (const r of ROWS.filter((x) => x.phase === phase)) {
      expect(staticLine(out, r), out).toMatch(/^\s*✗.*does not exist/);
      expect(runLine(out, r), out).toMatch(/^\s*· .*not run/);
    }
  });

  const ROUNDS = [...Array(Math.max(...ROWS.map((r) => r.assert.length))).keys()];
  it.each(ROUNDS)("without assertion %i, every row that has one fails, naming the row and the regex", (k) => {
    const root = tree({ drop: k });
    for (const phase of ["2", "3"]) {
      const { out } = run(phase, root);
      for (const r of ROWS.filter((x) => x.phase === phase)) {
        if (k < r.assert.length) {
          expect(staticLine(out, r), out).toMatch(/^\s*✗/);
          expect(staticLine(out, r), out).toContain(`/${r.assert[k]}/`);
        } else expect(staticLine(out, r), out).toMatch(/^\s*✓/);
      }
    }
  });
});

describe("check-al-phase.sh 2 — each variant fails its own row and no other", () => {
  const lines = (r) => SAMPLES[r.row];
  const VARIANTS = [
    { row: "overlap → conflicted, with a message", why: /skip/, cases: (r) => tsCase(r, lines(r), "it.skip") },
    { row: "WI-AL0.6 budgets met, measured on the CPU clock", why: /only/, cases: (r) => tsCase(r, lines(r), "it.only") },
    { row: "CRLF- or BOM-only save shows no hunks; a real whitespace edit shows", why: /table/,
      cases: (r) => tsCase(r, lines(r), "it.each([[1]])") },
    { row: "trust boundary: the bridge refuses a request carrying a provenance key", why: /only/,
      cases: (r) => `describe.only("trust boundary", () => {\n${tsCase(r, lines(r))}});\n` },
    { row: "R24 oracle: zero wrong, zero span mismatches, nonzero successes, refusals change nothing", why: /comment or a string/,
      cases: (r) => `// it(${JSON.stringify(r.title)}, …)\n${tsCase({ title: "an unrelated case" }, lines(r))}` },
    { row: "prepare failure leaves the content unchanged", why: /missing/,
      cases: (r) => tsCase(r, lines(r).map((l, i) => (i === 1 ? `// ${l}` : l))) },
    { row: "commit failure answers applied but not durable, and blocks the next mutation", why: /missing/,
      cases: (r) => tsCase(r, [`function unused() { ${lines(r)[0]} }`, ...lines(r).slice(1)]) },
    { row: "trust boundary: no MCP operation schema admits provenance keys", why: /2 cases/,
      cases: (r) => `${tsCase(r, lines(r))}\n${tsCase(r, lines(r))}` },
    { row: "aZ/Za: the rotating hunk is refused, the disjoint one reverts exactly", why: /ignored/,
      cases: (r) => rustCase(r, lines(r), "#[test]\n#[ignore]\n") },
    { row: "a remount without a certificate refuses, journal and projection unchanged", why: /comment or a string/,
      cases: (r) => `// fn ${r.title}()\n${rustCase({ title: "an_unrelated_test" }, lines(r))}` },
    { row: "trust boundary: a capture seq regression is refused", why: /missing/,
      cases: (r) => `fn helper() {\n  ${lines(r)[2]}\n}\n\n${rustCase(r, lines(r).slice(0, 2))}` },
    { row: "keep B of {A, B}, restart → only A pending", why: /not a #\[test\]/, cases: (r) => rustCase(r, lines(r), "") },
    { row: "native: a hash change and a pushState keep the page's registration live", why: /named "journal-other"/,
      cases: (r) => journeyCase({ title: "journal-other" }, lines(r)) },
    { row: "native: an iframe load keeps the page's registration live", why: /inline `run`/,
      cases: (r) => `async function run(client, ctx) {\n${indent(lines(r))}\n}\n${journeyCase(r, [], "  run,\n")}` },
    { row: "native: five rapid reloads, each followed by an agent write that succeeds", why: /missing/,
      cases: (r) => `function unused() { ${lines(r)[0]} }\n${journeyCase(r, lines(r).slice(1))}` },
  ];
  const FILE_VARIANTS = [
    { row: "WYSIWYG widening shown: the production collector's blocked hunk carries the panel indicator", why: /header/,
      tree: (r) => ({ headers: { [r.file]: "// WI-AL2.40 — witness fixture\n" } }) },
    { row: "writer-bound certificate: a dirty-buffer write is certified and reverts an unaffected hunk exactly", why: /mounted/,
      tree: (r) => ({ unmounted: [r.file] }) },
    { row: "live = replay: Projection equality, requests included, after an immediate retry", why: /does not exist/,
      tree: (r) => ({ skip: [r.file] }) },
  ];
  let out = "";
  beforeAll(() => {
    const opts = { cases: {}, headers: {}, skip: [], unmounted: [] };
    for (const v of VARIANTS) opts.cases[v.row] = v.cases;
    for (const v of FILE_VARIANTS) {
      const t = v.tree(byRow(v.row));
      Object.assign(opts.headers, t.headers);
      opts.skip.push(...(t.skip ?? []));
      opts.unmounted.push(...(t.unmounted ?? []));
    }
    out = run(2, tree(opts)).out;
  }, 300_000);

  const ALL = [...VARIANTS, ...FILE_VARIANTS];
  it.each(ALL.map((v) => [v.row, v]))("%s", (_, v) => {
    const r = byRow(v.row);
    expect(staticLine(out, r), out).toMatch(/^\s*✗/);
    expect(staticLine(out, r), out).toMatch(v.why);
    expect(runLine(out, r), out).toMatch(/not run/);
  });

  it("every row without a variant still passes", () => {
    for (const r of ROWS.filter((x) => x.phase === "2" && !ALL.some((v) => v.row === x.row))) expect(staticLine(out, r), out).toMatch(/^\s*✓/);
  });
});

describe("check-al-phase.sh — each witness runs alone, to exactly one pass", () => {
  const P3 = ROWS.filter((r) => r.phase === "3");
  const runs = (log, needle) => log.split("\n").filter((l) => l.includes(needle));

  it("phase 3: every witness runs green; vitest gets one file, its anchored title and a JSON report; cargo gets the fn name", () => {
    const { out, log } = run(3, tree(), { exec: true });
    for (const r of P3) expect(runLine(out, r), out).toMatch(/^\s*✓.*ran green/);
    const ts = P3.find((r) => r.runner === "vitest");
    const [call] = runs(log, `vitest run ${ts.file} -t `);
    expect(call, log).toContain("--reporter=json");
    expect(call, log).not.toContain("--config");
    expect(call, log).toMatch(/-t \(\^\| \)an agent cannot resolve a comment, and nothing is appended\$/);
    expect(runs(log, "-- a_duplicated_passage_resolves_ambiguous"), log).toHaveLength(1);
  });

  it.each([
    { vitest: "skip", cargo: "ignored", why: /skipped|ignored/ },
    { vitest: "dup", cargo: "dup", why: /2 / },
    { vitest: "fail", cargo: "none", why: /failed|no test/ },
    { vitest: "none", cargo: "ok", why: /report/ },
  ])("phase 3 with vitest $vitest and cargo $cargo: the affected witnesses are red", ({ vitest, cargo, why }) => {
    const { out } = run(3, tree(), { exec: true, env: { SHIM_VITEST: vitest, SHIM_CARGO: cargo } });
    for (const r of P3) {
      const red = r.runner === "cargo" ? cargo !== "ok" : vitest !== "pass";
      expect(runLine(out, r), out).toMatch(red ? /^\s*✗/ : /^\s*✓/);
      if (red) expect(out.slice(out.indexOf(runLine(out, r))).split("\n").slice(0, 8).join("\n"), out).toMatch(why);
    }
  });

  it("phase 2: an e2e witness runs its journey alone through pnpm e2e:journeys and reads its PASS line", () => {
    const { out, log } = run(2, tree(), { exec: true });
    for (const r of ROWS.filter((x) => x.phase === "2" && isJourney(x))) {
      expect(runLine(out, r), out).toMatch(/^\s*✓.*ran green/);
      expect(runs(log, `pnpm e2e:journeys --only ${r.title}`), log).toHaveLength(1);
    }
  });

  it.each([
    { e2e: "skip", why: /skipped/ },
    { e2e: "fail", why: /failed/ },
    { e2e: "none", why: /live debug build/ },
  ])("phase 2 with the journey runner answering $e2e: every e2e witness is red, and only those", ({ e2e, why }) => {
    const { out } = run(2, tree(), { exec: true, env: { SHIM_E2E: e2e } });
    for (const r of ROWS.filter((x) => x.phase === "2" && isJourney(x))) {
      expect(runLine(out, r), out).toMatch(/^\s*✗/);
      expect(out.slice(out.indexOf(runLine(out, r))).split("\n").slice(0, 8).join("\n"), out).toMatch(why);
    }
    for (const r of ROWS.filter((x) => x.phase === "2" && !isJourney(x) && x.runner !== "cargo")) expect(runLine(out, r), out).toMatch(/^\s*✓/);
  });

  it("phase 2: the WebKit witness runs under the browser config", () => {
    const { log } = run(2, tree(), { exec: true });
    const wk = ROWS.find((r) => r.runner === "webkit");
    const [call] = runs(log, `${wk.file} -t `);
    expect(call, log).toContain("--config vitest.browser.config.ts");
  });
});

describe("al-witness.mjs — the manifest is validated and the reports are read strictly", () => {
  const cli = (args, cwd = REPO) => spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd });
  const ROW = { row: "r", wi: "WI-X1.1", file: "src/a.test.ts", title: "t", runner: "vitest", assert: ["x"] };
  const manifest = (rows) => {
    const dir = mkdtempSync(path.join(tmpdir(), "al-witness-m-"));
    made.push(dir);
    writeFileSync(path.join(dir, "m.json"), typeof rows === "string" ? rows : JSON.stringify({ phases: { 2: rows } }));
    return dir;
  };

  it.each([
    ["not JSON", "{"],
    ["an unknown runner", [{ ...ROW, runner: "jest" }]],
    ["a regex that does not compile", [{ ...ROW, assert: ["("] }]],
    ["no assertion", [{ ...ROW, assert: [] }]],
    ["a duplicate row", [ROW, { ...ROW, title: "u" }]],
    ["a cargo witness outside src-tauri/src", [{ ...ROW, runner: "cargo", file: "src/a.test.ts", title: "t" }]],
    ["a vitest witness that is a WebKit file", [{ ...ROW, file: "src/a.webkit.test.ts" }]],
    ["a title with a tab", [{ ...ROW, title: "a\tb" }]],
    ["a cargo title that is not a fn name", [{ ...ROW, runner: "cargo", file: "src-tauri/src/a.test.rs", title: "not a name" }]],
    ["a malformed work item", [{ ...ROW, wi: "AL2.1" }]],
    ["an e2e witness outside e2e/journeys", [{ ...ROW, runner: "e2e", file: "e2e/lib/a.mjs", title: "a-journey" }]],
    ["an e2e title that is not a journey name", [{ ...ROW, runner: "e2e", file: "e2e/journeys/60-a.mjs", title: "A journey" }]],
    ["one journey file witnessing two rows", [
      { ...ROW, runner: "e2e", file: "e2e/journeys/60-a.mjs", title: "a-journey" },
      { ...ROW, row: "s", runner: "e2e", file: "e2e/journeys/60-a.mjs", title: "b-journey" },
    ]],
  ])("a manifest with %s is refused, exit 2", (_, rows) => {
    const dir = manifest(rows);
    const r = cli(["check", path.join(dir, "m.json"), "2"], dir);
    expect(r.status, r.stdout + r.stderr).toBe(2);
  });

  const report = (doc) => {
    const dir = manifest("{}");
    if (doc !== undefined) writeFileSync(path.join(dir, "r.json"), JSON.stringify(doc));
    return path.join(dir, "r.json");
  };
  const doc = (results, extra = {}) => ({
    numPassedTests: results.filter((x) => x.status === "passed").length, numFailedTests: 0, testResults: [{ assertionResults: results }], ...extra,
  });
  it.each([
    ["one pass", doc([{ title: "T", status: "passed" }, { title: "U", status: "skipped" }]), 0, 0],
    ["the witness skipped", doc([{ title: "T", status: "skipped" }]), 0, 1],
    ["two cases titled T", doc([{ title: "T", status: "passed" }, { title: "T", status: "passed" }]), 0, 1],
    ["another case passing too", doc([{ title: "T", status: "passed" }, { title: "x T", status: "passed" }]), 0, 1],
    ["a failure counted", doc([{ title: "T", status: "passed" }], { numFailedTests: 1 }), 0, 1],
    ["a nonzero exit", doc([{ title: "T", status: "passed" }]), 1, 1],
    ["no report", undefined, 0, 1],
  ])("vitest-report: %s → exit %#", (_, d, rc, want) => {
    const r = cli(["vitest-report", report(d), "T", String(rc)]);
    expect(r.status, r.stdout + r.stderr).toBe(want);
  });

  it.each([
    ["one ok under the prefix", "test agent_journal::w_tests::f ... ok\ntest agent_journal::w_tests::ff ... ok\n", "agent_journal::", 0, 0],
    ["the test ignored", "test agent_journal::w_tests::f ... ignored\n", "agent_journal::", 0, 1],
    ["no line for it", "test result: ok. 0 passed\n", "agent_journal::", 0, 1],
    ["two lines for it", "test agent_journal::a::f ... ok\ntest agent_journal::b::f ... ok\n", "agent_journal::", 0, 1],
    ["outside the mounting module", "test other::w_tests::f ... ok\n", "agent_journal::", 0, 1],
    ["a crate-root mount", "test w_tests::f ... ok\n", "", 0, 0],
    ["a nonzero exit", "test agent_journal::w_tests::f ... ok\n", "agent_journal::", 101, 1],
  ])("cargo-report: %s", (_, text, prefix, rc, want) => {
    const file = report();
    writeFileSync(file, text);
    const r = cli(["cargo-report", file, prefix, "f", String(rc)]);
    expect(r.status, r.stdout + r.stderr).toBe(want);
  });

  it.each([
    ["one PASS for the journey", "  PASS  j (5ms)\n  PASS  j-two (5ms)\nJOURNEYS PASSED\n", 0, 0],
    ["the journey skipped", "  SKIP  j (5ms) — workspace open\n", 0, 1],
    ["no line for it", "JOURNEYS PASSED — 0 passed\n", 0, 1],
    ["another journey failing beside it", "  PASS  j (5ms)\n  FAIL  j-two (5ms)\n", 0, 1],
    ["the journey run twice", "  PASS  j (5ms)\n  PASS  j (5ms)\n", 0, 1],
    ["a nonzero exit (no app running)", "  PASS  j (5ms)\n", 1, 1],
  ])("e2e-report: %s", (_, text, rc, want) => {
    const file = report();
    writeFileSync(file, text);
    const r = cli(["e2e-report", file, "j", String(rc)]);
    expect(r.status, r.stdout + r.stderr).toBe(want);
  });
});
