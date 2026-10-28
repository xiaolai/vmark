#!/usr/bin/env node
/**
 * Purpose: the named-witness check of the agent-edit-ledger phase gate — one
 *   Definition-of-Done row, one test that proves it (scripts/al-witnesses.json).
 *   Called by al_witnesses (scripts/lib/al-witness.sh); four subcommands:
 *
 *   check <manifest> <phase>      (cwd: the tree under test)
 *     Validates the WHOLE manifest first and exits 2 when it is malformed, so
 *     a typo never reads as a missing test. Then, per row of the phase, one
 *     TSV line: `ok <row> <runner> <file> <title> <-t pattern>` or
 *     `fail <row> <reason>`. A row is ok when its file exists, its first 30
 *     lines cite the row's work item as a whole token (the header convention
 *     of scripts/check-wi-linkage.sh), exactly one plain runnable case has the
 *     title (alWitnessCase.mjs), and the code that case reaches — comments
 *     never — matches every assert regex. Exit 0 when every row is ok, else 1.
 *   vitest-report <json> <title> <exit code>
 *     Exit 0 only when vitest exited 0 and its JSON report holds exactly one
 *     result titled <title>, passed, with one test passed and none failed in
 *     the run. Cases the `-t` filter excluded are reported as skipped and are
 *     not the witness; the witness itself skipped is a failure.
 *   cargo-report <output> <module prefix> <fn> <exit code>
 *     Exit 0 only when cargo exited 0 and exactly one `test <path> ... ok`
 *     line names a path under the prefix ending in `::<fn>`. The mount
 *     module's name is not known here, so cargo's `--exact` cannot be used;
 *     this reads the per-test lines instead, which also catches an ignored
 *     witness and a filter that ran nothing.
 *   e2e-report <output> <journey name> <exit code>
 *     Exit 0 only when e2e/run-journeys.mjs exited 0 and its output holds
 *     exactly one `PASS <name>` line, no FAIL line, and no SKIP of the
 *     witness. An e2e witness needs a live debug build (e2e/README.md): with
 *     none running the runner exits non-zero and the row is red, so a phase
 *     with e2e rows passes only after the native step has run.
 *
 * @coordinates-with scripts/lib/al-witness.sh — runs these and reports each row
 * @coordinates-with scripts/lib/alWitnessCase.mjs — the one-case selection and reach
 * @coordinates-with scripts/al-witnesses.json — the manifest
 * @module scripts/al-witness
 */
import { existsSync, readFileSync } from "node:fs";
import { e2eWitnessCase, tsWitnessCase, rustWitnessCase } from "./lib/alWitnessCase.mjs";

const RUNNER_PATHS = {
  vitest: (f) => /^src\/.+\.test\.tsx?$/.test(f) && !/\.(webkit|soak)\.test\./.test(f),
  webkit: (f) => /^src\/.+\.webkit\.test\.tsx?$/.test(f),
  cargo: (f) => /^src-tauri\/src\/.+\.test\.rs$/.test(f),
  e2e: (f) => /^e2e\/journeys\/[0-9]{2}-[a-z0-9-]+\.mjs$/.test(f),
};
const JOURNEY_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const WI = /^WI-[A-Z]+[0-9]+(\.[0-9]+)*[a-z]?$/;
const RUST_FN = /^[a-z_][a-z0-9_]*$/;
const CONTROL = /[\t\n\r]/;

/** Every reason the manifest is malformed; empty when it is sound. */
function manifestErrors(doc) {
  if (!doc || typeof doc.phases !== "object" || doc.phases === null || Array.isArray(doc.phases)) return ["no `phases` object"];
  const errors = [];
  for (const [phase, rows] of Object.entries(doc.phases)) {
    if (!Array.isArray(rows)) { errors.push(`phase ${phase} is not a list of rows`); continue; }
    const names = new Set();
    const cases = new Set();
    rows.forEach((r, i) => {
      const at = `phase ${phase} row ${i + 1}`;
      if (typeof r?.row !== "string" || r.row === "" || CONTROL.test(r.row)) return errors.push(`${at}: \`row\` must be a one-line name`);
      const bad = (msg) => errors.push(`${at} (${r.row}): ${msg}`);
      if (names.has(r.row)) bad("a duplicate row");
      names.add(r.row);
      if (typeof r.wi !== "string" || !WI.test(r.wi)) bad("`wi` must be a work-item id such as WI-AL2.1a");
      if (!Object.hasOwn(RUNNER_PATHS, r.runner)) return bad("`runner` must be vitest, webkit, cargo or e2e");
      if (typeof r.file !== "string" || !RUNNER_PATHS[r.runner](r.file)) bad(`\`file\` is not a ${r.runner} test path`);
      if (typeof r.title !== "string" || r.title === "" || CONTROL.test(r.title)) bad("`title` must be a one-line test title");
      else if (r.runner === "cargo" && !RUST_FN.test(r.title)) bad("a cargo `title` must be the test fn's name");
      else if (r.runner === "e2e" && !JOURNEY_NAME.test(r.title)) bad("an e2e `title` must be the journey's kebab-case name");
      if (r.runner === "e2e" && [...cases].some((c) => c.startsWith(`${r.file}\0`))) bad("a journey file holds one journey, so it witnesses one row");
      if (cases.has(`${r.file}\0${r.title}`)) bad("the same test witnesses two rows");
      cases.add(`${r.file}\0${r.title}`);
      if (!Array.isArray(r.assert) || r.assert.length === 0) return bad("`assert` must list at least one regex");
      for (const re of r.assert) {
        try {
          if (typeof re !== "string" || re === "") throw new Error("not a non-empty string");
          new RegExp(re);
        } catch (e) {
          bad(`assert /${re}/ does not compile: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    });
  }
  return errors;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const oneLine = (s) => s.replace(/[\t\r\n]+/g, " ");

/** True when one of the first 30 lines of `source` cites `wi` as a whole token. */
const linked = (source, wi) => {
  const re = new RegExp(`(^|[^A-Za-z0-9.-])${escapeRegex(wi)}([^0-9A-Za-z]|$)`);
  return source.split("\n").slice(0, 30).some((l) => re.test(l));
};

/** The reason row `r` fails in the current tree, or null. */
function rowFailure(r) {
  if (!existsSync(r.file)) return `the witness file does not exist yet: ${r.file}`;
  const source = readFileSync(r.file, "utf8");
  if (!linked(source, r.wi)) return `the header (first 30 lines) of ${r.file} does not name ${r.wi}`;
  const found =
    r.runner === "cargo" ? rustWitnessCase(source, r.title) : r.runner === "e2e" ? e2eWitnessCase(r.file, source, r.title) : tsWitnessCase(r.file, source, r.title);
  if (found.error) return `${r.file}: ${found.error}`;
  const missing = r.assert.filter((re) => !new RegExp(re).test(found.reach));
  if (missing.length > 0) return `${r.file} "${r.title}": the code this case reaches is missing ${missing.map((re) => `/${re}/`).join(", ")} (comments and unreached code do not count)`;
  return null;
}

function check(manifestPath, phase) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return malformed([`cannot read it: ${e instanceof Error ? e.message : String(e)}`]);
  }
  const errors = manifestErrors(doc);
  if (errors.length === 0 && !Array.isArray(doc.phases[phase])) errors.push(`no rows for phase ${phase}`);
  if (errors.length > 0) return malformed(errors);
  let failed = 0;
  for (const r of doc.phases[phase]) {
    const why = rowFailure(r);
    if (why) {
      failed++;
      console.log(`fail\t${r.row}\t${oneLine(why)}`);
    } else {
      const pattern = r.runner === "cargo" || r.runner === "e2e" ? r.title : `(^| )${escapeRegex(r.title)}$`;
      console.log(`ok\t${r.row}\t${r.runner}\t${r.file}\t${r.title}\t${pattern}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

function malformed(errors) {
  console.log(`the witness manifest is malformed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  return 2;
}

/** Print each reason and return 1, or print `pass` and return 0. */
const verdict = (errors, pass) => {
  for (const e of errors) console.log(e);
  if (errors.length === 0) console.log(pass);
  return errors.length === 0 ? 0 : 1;
};

function vitestReport(jsonPath, title, rc) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    return verdict([`no JSON report was written by vitest (exit ${rc})`], "");
  }
  const results = (doc.testResults ?? []).flatMap((t) => t.assertionResults ?? []);
  const titled = results.filter((a) => a.title === title);
  const errors = [];
  if (rc !== "0") errors.push(`vitest exited ${rc}`);
  if (titled.length !== 1) errors.push(`${titled.length} results titled "${title}" — the witness must run exactly once`);
  else if (titled[0].status !== "passed") errors.push(`the witness was ${titled[0].status === "pending" || titled[0].status === "todo" ? "skipped" : titled[0].status}`);
  if (doc.numPassedTests !== 1) errors.push(`${doc.numPassedTests} tests passed — exactly the witness must`);
  if (doc.numFailedTests !== 0) errors.push(`${doc.numFailedTests} tests failed`);
  return verdict(errors, `1 passed: ${title}`);
}

function cargoReport(outPath, prefix, fn, rc) {
  const text = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  const lines = [...text.matchAll(/^test (\S+) \.\.\. (\w+)/gm)].map((m) => ({ path: m[1], status: m[2] }));
  const mine = lines.filter((l) => l.path.startsWith(prefix) && (l.path === fn || l.path.endsWith(`::${fn}`)));
  const where = prefix === "" ? "the crate" : prefix;
  const errors = [];
  if (rc !== "0") errors.push(`cargo exited ${rc}`);
  if (mine.length === 0) errors.push(`no test named ${fn} under ${where} ran`);
  else if (mine.length > 1) errors.push(`${mine.length} tests named ${fn} ran under ${where} (${mine.map((l) => l.path).join(", ")}) — the witness must be one`);
  else if (mine[0].status !== "ok") errors.push(`the witness was ${mine[0].status}`);
  return verdict(errors, `1 passed: ${mine[0]?.path}`);
}

function e2eReport(outPath, name, rc) {
  const text = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  const lines = [...text.matchAll(/^\s*(PASS|FAIL|SKIP)\s+(\S+)/gm)].map((m) => ({ status: m[1], name: m[2] }));
  const mine = lines.filter((l) => l.name === name);
  const errors = [];
  if (rc !== "0") errors.push(`e2e/run-journeys.mjs exited ${rc} (an e2e witness needs a live debug build)`);
  if (mine.length !== 1) errors.push(`${mine.length} results for journey ${name} — the witness must run exactly once`);
  else if (mine[0].status !== "PASS") errors.push(`the witness was ${mine[0].status === "SKIP" ? "skipped" : "failed"}`);
  const failed = lines.filter((l) => l.status === "FAIL");
  if (failed.length > 0) errors.push(`${failed.length} journey(s) failed: ${failed.map((l) => l.name).join(", ")}`);
  return verdict(errors, `1 passed: ${name}`);
}

const [cmd, ...args] = process.argv.slice(2);
const COMMANDS = { check: [check, 2], "vitest-report": [vitestReport, 3], "cargo-report": [cargoReport, 4], "e2e-report": [e2eReport, 3] };
if (!Object.hasOwn(COMMANDS, cmd) || args.length !== COMMANDS[cmd][1]) {
  console.error("usage: al-witness.mjs check <manifest> <phase> | vitest-report <json> <title> <rc> | cargo-report <out> <prefix> <fn> <rc> | e2e-report <out> <name> <rc>");
  process.exit(64);
}
process.exit(COMMANDS[cmd][0](...args));
