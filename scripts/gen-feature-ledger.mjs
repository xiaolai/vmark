#!/usr/bin/env node
/**
 * Generates `dev-docs/feature-metrics.md` — the per-feature evidence table.
 *
 * The spine (`scripts/feature-map.json`) names features and the paths they
 * occupy. EVERY other column here is JOINED from something this repo already
 * measures. Nothing in the output is typed by hand, and nothing is estimated.
 *
 * This file is the QUANTITATIVE half of the feature ledger. The qualitative
 * half — what each feature does, how it is reached and gated, what documents
 * and tests it, what is known to be unwired or stale — is the hand-inspected
 * `dev-docs/feature-ledger.md`, which cites these cells rather than restating
 * them. Keep the two apart: a generated file that anyone hand-edits is
 * overwritten on the next run, and a hand-written file that restates numbers
 * goes stale on the next commit.
 *
 * Sources joined:
 *   - tokei                                  -> code / comment lines (code only)
 *   - find + wc                              -> test files and test lines
 *   - coverage/coverage-summary.json         -> per-file line coverage (if present)
 *   - scripts/file-size-baseline.json        -> oversized-file debt
 *   - scripts/mock-boundaries-baseline.json  -> internal-module mocking
 *   - .dependency-cruiser-known-violations.json -> layering debt
 *   - scripts/plugin-store-coupling-baseline.json -> plugin->host coupling
 *   - git log                                -> commits in window, last touch
 *   - src/stores/settingsStore/defaults.ts   -> VERIFIES each spine flagDefault
 *
 * THERE IS NO ISSUE-COUNT COLUMN, AND ADDING ONE WOULD BE A MISTAKE. It is the
 * obvious next column — "how much user pain has this feature caused?" — and it
 * was tried while this ledger was being built. Two things went wrong, and the
 * second is the one worth remembering.
 *
 * The mechanical error: closed issues were classified by keyword-matching their
 * TITLES, over the most recent 400 of the repository's 789, and the result was
 * then described as the whole history. A partial sample matched by a crude
 * regex is not a census, and the browser's two apparent hits turned out to be
 * accessibility audits of `LinkPopupView` that contained the word incidentally.
 *
 * The reasoning error, which no better query would fix: most of the features
 * worth asking about here are default-OFF. A feature nobody can reach without
 * flipping a flag produces no issue traffic BY CONSTRUCTION, so a low count
 * restates the gate column and reads as evidence about the feature. That is how
 * "the embedded browser has almost no issues" got offered as independent
 * corroboration that it is unused, when it is a near-tautology.
 *
 * If someone still wants demand data, it has to come from something that can
 * distinguish "nobody hit a bug" from "nobody could reach the code" — telemetry
 * on the flag, or issues filed by users who had it enabled. Until such a source
 * exists, the honest ledger is silent here rather than confidently wrong.
 *
 * THE HONESTY RULE, and it is the whole point of this script: a signal that was
 * not measured for a feature prints `--`, never `0`. Those are different claims.
 * `0` says "measured, and clean"; `--` says "nobody looked". Coverage is the one
 * that matters most — `coverage/` is gitignored, so on a fresh clone every
 * coverage cell is `--` until `pnpm test:coverage` runs. Printing `0%` there
 * would invent a catastrophe; printing `100%` would invent a guarantee.
 *
 * FAILS CLOSED on a stale spine: a `paths` entry matching nothing on disk, a
 * `doc` naming a page that does not exist, or a `flagDefault` that disagrees
 * with the shipped default in `defaults.ts`, is an error — not a warning. A
 * ledger that silently drops a renamed feature reports the same green as one
 * that works, which is the failure mode `check-scripts-parity` and
 * `shell-slots` already exist to prevent. The flag check exists because the
 * spine carried `browser.enabled = false` for three weeks after the shipped
 * default flipped to `true`, and the Gate column printed the wrong value with
 * full confidence — the cell was prose in JSON, and nothing measured it.
 *
 * FAILS CLOSED on its own measurements too: a `find` or `git` that fails throws
 * (an empty result used to become an authoritative 0 / `--`), a path that holds
 * no file at all is a stale-spine error, and so is a path that holds no CODE
 * file unless the spine DECLARES it data-only (`dataOnly: ["src-tauri/locales"]`
 * — legitimate: it has no code, `0` is the honest count, and the declaration
 * is what separates "measured, data" from "the code moved and nobody looked";
 * a declared data path that does hold code is the stale declaration), a baseline
 * whose container or records are not the shape the join reads is an error
 * while an EMPTY container is the ratchet reaching zero, and coverage is
 * printed only when the summary holds EVERY coverage-eligible file of the
 * feature — otherwise `--` with `n/m files`, because the summary lists just
 * the files some test loaded and averaging those reports the tested fraction
 * as the feature's coverage.
 *
 * Regenerate: `node scripts/gen-feature-ledger.mjs [--since=<git date>]`. Do
 * not hand-edit the output. Rendering lives in scripts/lib/featureLedgerRender.mjs.
 * Self-test: `scripts/gen-feature-ledger.test.mjs` (gates tier).
 */
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { renderLedger } from "./lib/featureLedgerRender.mjs";

const OUTPUT_REL = "dev-docs/feature-metrics.md";
const DEFAULTS_REL = "src/stores/settingsStore/defaults.ts";
const WINDOW_DAYS = 180;
const USAGE = "usage: node scripts/gen-feature-ledger.mjs [--since=<git date expression>]";

/** Run a measurement command; a failure THROWS — `""` from a failed `find` or `git` must never become a count. */
export const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });
/**
 * Parse a JSON source, or `null` when the file is ABSENT.
 *
 * Three outcomes used to collapse into two: a file holding the literal `null`
 * read as "absent" (so a `null` feature-map reported "missing" and a `null`
 * coverage summary printed `--`), and a malformed one threw a bare
 * `SyntaxError` that named no path — the stack trace pointed at this line, not
 * at the file the reader has to fix (audit R2 #120).
 */
function readJson(p, label = p) {
  if (!existsSync(p)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch (error) {
    throw new Error(`${label}: not valid JSON — ${error.message}`);
  }
  if (parsed === null) throw new Error(`${label}: holds the literal null, which is not a document this joins`);
  return parsed;
}
const isTest = (f) => /\.test\.|\.spec\.|__tests__|\/test\/|\.bench\./.test(f);
const underAny = (p, paths) => paths.some((base) => p === base || p.startsWith(base.endsWith("/") ? base : base + "/"));
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Strict argv: only `--since=<git date>`, non-empty and table-safe; anything else is a usage error. */
export function parseArgs(argv) {
  let since = `${WINDOW_DAYS} days ago`;
  for (const a of argv) {
    const m = /^--since=([\s\S]*)$/.exec(a);
    if (!m) throw new Error(`unknown argument ${JSON.stringify(a)}\n${USAGE}`);
    const value = m[1].trim();
    if (value === "" || /[\n\r`|]/.test(value)) {
      throw new Error(`--since needs a git date expression with no newline, backtick or pipe (got ${JSON.stringify(m[1])})\n${USAGE}`);
    }
    since = value;
  }
  return { since };
}

// ---------------------------------------------------------------- defaults
/**
 * Flatten `export const initialState = { … }` in `source` into dotted keys →
 * the RAW SOURCE TEXT of each leaf initializer (`"smart"`, `30`, `false`,
 * `resolveInitialLanguage()`), at any depth. Read through the TypeScript
 * parser, the way the repo's other gates read TypeScript: the line parser
 * this replaced keyed on two-space indentation, one-line values and three
 * levels of nesting, so a value that wrapped, a `key:{` without its space or
 * a fourth level silently dropped the setting, and the only consumer then
 * reported a spine flag as "not found" (audit 20260907 #69). A spread
 * contributes no keys (its members live in another file); an object literal
 * is descended, never recorded; a shorthand or method property is not a
 * literal default and is skipped, as before.
 */
export function parseSettingsDefaults(source) {
  const map = new Map();
  const sf = ts.createSourceFile("defaults.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // A source with parse diagnostics is a RECOVERED fragment, not the shipped
  // defaults: TypeScript invents nodes around a syntax error, so the verifier
  // could approve a flag against a partial initializer and report the rest as
  // "not found" (audit R2 #121). The same guard scripts/lib/arrayLiteralEnd.mjs
  // applies for the same reason. Recorded rather than thrown so the caller can
  // REFUSE with a message instead of a stack trace.
  if (sf.parseDiagnostics?.length > 0) {
    map.parseError = ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " ");
    return map;
  }
  const decl = sf.statements
    .filter((st) => ts.isVariableStatement(st) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap((st) => st.declarationList.declarations)
    .find((d) => ts.isIdentifier(d.name) && d.name.text === "initialState");
  let init = decl?.initializer;
  while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))) {
    init = init.expression;
  }
  if (!init || !ts.isObjectLiteralExpression(init)) return map;
  // Objects whose contents are COMPOSED, not written out: a spread or a
  // computed key can override a literal that sits right there in the source,
  // and JavaScript keeps the last write. Skipping them silently meant the
  // verifier could approve a default the runtime does not use, so the affected
  // prefixes are recorded and `verifyFlagDefaults` refuses them by name
  // (audit R2 #122). `initialState.cjkFormatting` is one today.
  map.unverifiable = new Set();
  const walk = (obj, prefix) => {
    const composed = obj.properties.some(
      (p) => ts.isSpreadAssignment(p) || (p.name !== undefined && ts.isComputedPropertyName(p.name)),
    );
    if (composed) map.unverifiable.add(prefix);
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) continue;
      const key = prefix ? `${prefix}.${prop.name.text}` : prop.name.text;
      if (ts.isObjectLiteralExpression(prop.initializer)) walk(prop.initializer, key);
      else map.set(key, prop.initializer.getText(sf));
    }
  };
  walk(init, "");
  return map;
}

/** Is `flag` inside an object this parser could not read exhaustively? */
function inComposedObject(flag, unverifiable) {
  if (!unverifiable) return false;
  const parts = flag.split(".");
  for (let i = 0; i < parts.length; i++) {
    if (unverifiable.has(parts.slice(0, i).join("."))) return true;
  }
  return false;
}

/**
 * Compare every gated spine entry against the shipped default. Returns one
 * message per disagreement; an empty array means the spine is honest.
 */
export function verifyFlagDefaults(features, defaultsSource) {
  const defaults = parseSettingsDefaults(defaultsSource);
  const findings = [];
  if (defaults.parseError) {
    return [`${DEFAULTS_REL} does not parse (${defaults.parseError}) — a recovered fragment is not the shipped defaults, so no spine flag can be verified`];
  }
  for (const f of features) {
    if (!f.flag) continue;
    if (inComposedObject(f.flag, defaults.unverifiable)) {
      findings.push(`${f.name}: ${f.flag} sits in an object composed with a spread or a computed key in ${DEFAULTS_REL} — its shipped default cannot be read statically, so it cannot be a spine flag`);
      continue;
    }
    const raw = defaults.get(f.flag);
    if (raw === undefined) {
      findings.push(`${f.name}: flag ${f.flag} not found in ${DEFAULTS_REL}`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      findings.push(`${f.name}: ${f.flag} is not a literal in ${DEFAULTS_REL} (${raw}) — it cannot be verified, so it cannot be a spine flag`);
      continue;
    }
    if (JSON.stringify(parsed) !== JSON.stringify(f.flagDefault)) {
      findings.push(`${f.name}: ${f.flag} spine=${JSON.stringify(f.flagDefault)} defaults.ts=${raw}`);
    }
  }
  return findings;
}

/**
 * Stale-spine errors: a path that does not exist or holds NO file, a path with
 * no CODE file that is not declared under the feature's `dataOnly` (and a
 * declared one that holds code, or is not one of its `paths`), a doc that does
 * not exist, a flag default that disagrees.
 */
/**
 * The feature map's SHAPE, before any of it is measured. Nothing validated it,
 * so `{"features": []}` produced an authoritative EMPTY ledger, and a feature
 * with `"paths": []` reached `find`/`tokei`/`git log` with no path operand at
 * all — where `find` defaults to the working directory and would have measured
 * the whole repository as that one feature (audit R2 #123).
 */
export function spineShapeErrors(spine) {
  const errors = [];
  if (!isPlainObject(spine) || !Array.isArray(spine.features)) return ["feature-map.json: expected a `features` array"];
  if (spine.features.length === 0) return ["feature-map.json: `features` is empty — an empty ledger is not a measurement"];
  const seen = new Set();
  spine.features.forEach((f, i) => {
    const where = `feature-map.json: features[${i}]`;
    if (!isPlainObject(f)) return errors.push(`${where} is not an object`);
    if (typeof f.name !== "string" || f.name.trim() === "") return errors.push(`${where} has no non-empty \`name\``);
    if (seen.has(f.name)) errors.push(`${where}: duplicate feature name ${JSON.stringify(f.name)}`);
    seen.add(f.name);
    if (!Array.isArray(f.paths) || f.paths.length === 0) return errors.push(`${f.name}: \`paths\` must be a non-empty array — a feature with no path measures nothing, or everything`);
    for (const p of f.paths) {
      if (typeof p !== "string" || p.trim() === "") errors.push(`${f.name}: a path is not a non-empty string (${JSON.stringify(p)})`);
    }
    const normalized = normalizePaths(f.paths.filter((p) => typeof p === "string" && p.trim() !== ""));
    if (normalized.length === 0 || normalized.some((p) => p === "" || p === ".")) {
      errors.push(`${f.name}: a path normalises away to nothing or to the repository root ("" / "." / "./") — the measurement would have no path operand, and \`find\` with none walks the working directory`);
    }
    // An absolute path, or one that climbs out of the repository, measures a
    // tree that is not this one (audit R2 #126).
    for (const p of normalized.filter((q) => q.startsWith("/") || q === ".." || q.startsWith("../"))) {
      errors.push(`${f.name}: a path is absolute or climbs out of the repository -> ${p}`);
    }
  });
  return errors;
}

export function spineErrors(root, spine, defaultsSource, runner = run) {
  const shape = spineShapeErrors(spine);
  if (shape.length) return shape;
  const errors = [];
  for (const f of spine.features) {
    const dataOnly = new Set(f.dataOnly ?? []);
    for (const d of dataOnly) if (!f.paths.includes(d)) errors.push(`${f.name}: dataOnly names a path that is not one of its paths -> ${d}`);
    for (const p of f.paths) {
      if (!existsSync(path.join(root, p))) { errors.push(`${f.name}: path does not exist -> ${p}`); continue; }
      // ONE enumeration of the SAME tree `existsSync` just probed (audit R2
      // #124/#125): the all-files and code-file views are two filters over it,
      // not two `find` runs that could disagree.
      const files = featureInventory([p], runner, root);
      if (files.all.length === 0) { errors.push(`${f.name}: path holds no file at all (its measured zeros would be about nothing) -> ${p}`); continue; }
      const hasCode = files.code.length > 0;
      if (!hasCode && !dataOnly.has(p)) errors.push(`${f.name}: path holds no code file — declare it under dataOnly if it is data (locales, bundled resources), else the code moved -> ${p}`);
      if (hasCode && dataOnly.has(p)) errors.push(`${f.name}: path is declared dataOnly but holds code files -> ${p}`);
    }
    if (f.doc && !existsSync(path.join(root, f.doc))) errors.push(`${f.name}: doc does not exist -> ${f.doc}`);
  }
  if (defaultsSource === null) errors.push(`${DEFAULTS_REL} missing — flag defaults cannot be verified`);
  else errors.push(...verifyFlagDefaults(spine.features, defaultsSource));
  return errors;
}

// ---------------------------------------------------------------- measurement
// Code lines, tests excluded. ONLY executable languages count: `src/locales`
// holds ~26k lines of translation JSON, and counting that as "code" made
// Localization the largest feature in the repo and its test:code ratio 0.02 —
// a data corpus wearing a source-file costume. Data is measured, just not here.
//
// `CODE_LANGS` is the tokei-side spelling of `CODE_EXTENSIONS`: the two MUST
// name the same population, or the code column and the file/test columns
// measure different things — `.js`/`.jsx`/`.mjs`/`.mts` were code to tokei
// and invisible to `find` until audit 20260907 #70.
const CODE_LANGS = new Set(["TypeScript", "Tsx", "JSX", "JavaScript", "Rust"]);
/** Every extension those languages own — what `listFiles` enumerates as code. */
export const CODE_EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "rs"];
const CODE_EXTENSION_RE = new RegExp(`\\.(?:${CODE_EXTENSIONS.join("|")})$`);
/** One policy for "this is a code file", shared by every view of the inventory. */
export const isCodeFile = (f) => CODE_EXTENSION_RE.test(f);

/**
 * Spine paths as ONE non-overlapping set. `find`, tokei and `git log` all
 * recurse, so `a` listed beside `a/b` counted every file under `a/b` twice
 * (#71). Duplicates and nested entries are dropped, and `./` and a trailing
 * `/` are stripped so one path spelled two ways is one path.
 */
export function normalizePaths(paths) {
  // `path.posix.normalize` collapses `.`, `..` and repeated separators, so
  // `a//b`, `a/./b` and `a/c/../b` are ONE path rather than three that each
  // measure the same files again (audit R2 #126). A path that normalises to
  // an absolute one, or that climbs out of the repository, is dropped here and
  // reported by `spineShapeErrors` — a measurement rooted outside the tree is
  // not this repository's.
  const clean = [...new Set(paths.map((p) => path.posix.normalize(p).replace(/^(\.\/)+/, "").replace(/\/+$/, "")))];
  return clean.filter((p) => !clean.some((q) => q !== p && p.startsWith(`${q}/`)));
}
/**
 * Code lines via tokei, over an EXPLICIT list of non-test source files.
 * `null` (`--`, not measured) ONLY when tokei is not installed; any other
 * failure throws.
 *
 * tokei used to be handed the feature's DIRECTORIES plus `--exclude *.test.*`
 * &co. That exclusion does not apply to a path named explicitly as a FILE —
 * measured on tokei 15.0.0 — and this spine names test files explicitly
 * (`src-tauri/src/content_search.test.rs` is one of "Find in files"'s paths).
 * So 2,582 lines of test code across five features were counted BOTH as
 * production Code and as Test lines, under a provenance table that says
 * "tests excluded" (audit R2 #127). Passing the files removes the exclusion
 * flags entirely: the population tokei measures IS the population `isTest`
 * left in `srcFiles`, by construction rather than by two rules agreeing.
 */
export function tokeiCode(files, runner = run) {
  if (files.length === 0) return 0;
  let out;
  const where = files.length > 3 ? `${files.slice(0, 3).join(", ")} (+${files.length - 3} more)` : files.join(", ");
  try {
    out = runner("tokei", [...files, "--output", "json"]);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw new Error(`tokei failed for ${where}: ${err?.stderr || err?.message || err}`);
  }
  let code = 0;
  for (const [lang, v] of Object.entries(JSON.parse(out))) {
    if (lang === "Total" || !CODE_LANGS.has(lang)) continue;
    code += v.code || 0;
    for (const child of v.children ? Object.values(v.children).flat() : []) code += child.stats?.code ?? 0;
  }
  return code;
}

/**
 * Files under `paths`: the `CODE_EXTENSIONS` sources by default, or every file
 * with `{ any: true }`. `cwd` is the tree the relative paths are read against —
 * without it an exported helper could validate one root with `existsSync` and
 * enumerate another with `find` (audit R2 #124).
 *
 * NUL-delimited, because a newline is a legal character in a filename and
 * splitting on one turned a single such file into two nonexistent paths — which
 * a later `readFileSync` would then blame on the wrong file (audit R2 #128).
 */
export function listFiles(paths, runner = run, { any = false, cwd } = {}) {
  // ONE enumeration, filtered in JS. `find` used to be run twice per path —
  // once with `-name` predicates for the code view and once without for the
  // all-files view — so the two views were separate measurements of a tree
  // that could change between them, and the extension list lived in `find`
  // argv where nothing else could reuse it (audit R2 #125).
  const out = runner("find", [...paths, "-type", "f", "-print0"], cwd ? { cwd } : {});
  const all = out ? out.split("\0").filter((f) => f !== "") : [];
  return any ? all : all.filter(isCodeFile);
}

/**
 * Every view of one feature's files, from ONE enumeration: `all` (any file),
 * `code` (the `CODE_EXTENSIONS` sources), `src` (code that is not a test) and
 * `test`. `src` is exactly what tokei is asked to measure, so the Code column
 * and the Src/Test-file columns cannot describe different populations.
 */
export function featureInventory(paths, runner = run, cwd) {
  const all = listFiles(paths, runner, { any: true, ...(cwd ? { cwd } : {}) });
  const code = all.filter(isCodeFile);
  return { all, code, src: code.filter((f) => !isTest(f)), test: code.filter(isTest) };
}

/** Line count the way `wc -l` and check-file-size count: a trailing newline is not an extra line; "" is 0. */
export function countLines(text) {
  if (text === "") return 0;
  const parts = text.split("\n");
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}

/**
 * The baseline payloads, SHAPE-checked: each container must be the type the
 * join reads and every record must carry the field the join keys on. An
 * EMPTY container is valid — a ratchet that reached zero is the goal, not a
 * shape change — but a missing container, or a record without its key field,
 * would join to an all-zero column that reads as "clean".
 */
export function joinSources({ fileSize, mockB, depX, coupling }) {
  const problems = [];
  // A count is a NON-NEGATIVE SAFE INTEGER. `typeof v === "number"` alone
  // accepted -1, 1.5 and NaN — each of which lands in a column this document
  // promises was measured (audit R2 #130).
  const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
  const files = fileSize?.files;
  const testFiles = fileSize?.testFiles;
  if (!isPlainObject(files) || !isPlainObject(testFiles)) problems.push("file-size-baseline.json: expected `files` and `testFiles` objects");
  else for (const [k, v] of [...Object.entries(files), ...Object.entries(testFiles)]) {
    if (k.startsWith("//")) continue;
    // An empty key is not a path, and `underAny` would still test it against
    // every feature's paths.
    if (k.trim() === "") problems.push("file-size-baseline.json: a record is keyed by an empty path");
    if (!isCount(v)) problems.push(`file-size-baseline.json: ${k} is not a line count (${JSON.stringify(v)})`);
  }
  const mockRecords = Array.isArray(mockB?.entries) ? mockB.entries : null;
  if (!mockRecords) problems.push("mock-boundaries-baseline.json: expected an `entries` array");
  else mockRecords.forEach((r, i) => { if (!isPlainObject(r) || typeof r.file !== "string" || r.file.trim() === "") problems.push(`mock-boundaries-baseline.json: entry ${i} has no non-empty string \`file\``); });
  const depRecords = Array.isArray(depX) ? depX : null;
  if (!depRecords) problems.push(".dependency-cruiser-known-violations.json: expected a root array");
  else depRecords.forEach((r, i) => { if (!isPlainObject(r) || typeof r.from !== "string" || r.from.trim() === "") problems.push(`.dependency-cruiser-known-violations.json: entry ${i} has no non-empty string \`from\``); });
  const couplingUnits = isPlainObject(coupling?.units) ? coupling.units : null;
  if (!couplingUnits) problems.push("plugin-store-coupling-baseline.json: expected a `units` object");
  else for (const [unit, v] of Object.entries(couplingUnits)) {
    if (unit.startsWith("//")) continue;
    if (unit.trim() === "") problems.push("plugin-store-coupling-baseline.json: a unit is keyed by an empty name");
    const counts = isCount(v) || (isPlainObject(v) && Object.values(v).every(isCount));
    if (!counts) problems.push(`plugin-store-coupling-baseline.json: ${unit} is neither a count nor a map of counts`);
  }
  return { problems, fileSizeFlat: { ...(files ?? {}), ...(testFiles ?? {}) }, mockRecords: mockRecords ?? [], depRecords: depRecords ?? [], couplingUnits: couplingUnits ?? {} };
}

/**
 * Files the app's coverage run can report for a feature: TS/TSX under src/,
 * minus vitest.config.ts's coverage.exclude classes and minus type-only
 * modules (`types.ts`, `*.types.ts`) — those compile to nothing, so v8 never
 * lists them; counting one as "missing" would call a complete summary partial.
 */
export function coverageEligible(srcFiles) {
  return srcFiles.filter((f) =>
    /^src\//.test(f) && /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f) && !/(^|\/)index\.ts$/.test(f) && !/\.config\./.test(f) &&
    !/^src\/(test|assets)\//.test(f) && !/(^|\/)types\.ts$/.test(f) && !/\.types\.ts$/.test(f));
}

/**
 * Per-feature line coverage — only when EVERY eligible file is in the summary.
 * The summary lists just the files some test loaded (this repo sets no
 * coverage.include), so a feature with untested files is under-represented in
 * it, and averaging what IS there reports the tested fraction as the feature's
 * coverage. Partial → `pct: null`, with `seen/expected` so the cell can say so.
 */
export function featureCoverage(covSummary, eligible, root) {
  const expected = eligible.length;
  if (!covSummary) return { pct: null, seen: 0, expected };
  const byRel = new Map();
  for (const [abs, v] of Object.entries(covSummary)) {
    if (abs === "total") continue;
    // `path.relative`, not a string-prefix slice: `/x/vmark-old/src/a.ts`
    // starts with `/x/vmark` and used to be sliced into `old/src/a.ts` — a
    // sibling checkout's file keyed as though it were this tree's
    // (audit R2 #131). A result that climbs out is not this tree's file.
    let rel = abs;
    if (path.isAbsolute(abs)) {
      rel = path.relative(root, abs);
      if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    }
    byRel.set(rel.split(path.sep).join("/"), v);
  }
  let covered = 0, total = 0, seen = 0;
  for (const f of eligible) {
    const v = byRel.get(f);
    // A record without numeric `lines` is not a measurement of that file, and
    // counting it as `seen` while folding in zeros made a PARTIAL summary look
    // complete and understated the percentage (audit R2 #132). Not seen →
    // `complete` is false → the cell says so.
    if (!v || typeof v.lines?.covered !== "number" || typeof v.lines?.total !== "number") continue;
    covered += v.lines.covered;
    total += v.lines.total;
    seen++;
  }
  const complete = expected > 0 && seen === expected && total > 0;
  return { pct: complete ? (covered / total) * 100 : null, seen, expected };
}

/** One ledger row: every column joined or measured for one spine feature. */
function measureFeature(f, ctx) {
  const paths = normalizePaths(f.paths);
  const { src: srcFiles, test: testFiles } = ctx.inventory.get(f.name);
  // Coupling units are bare plugin/module names ("codemirror", "toolbarActions"),
  // so match the LAST path segment rather than searching the whole string — a
  // substring test makes "svg" match "src/plugins/svgSomethingElse".
  const coup = Object.entries(ctx.couplingUnits)
    .filter(([unit]) => paths.some((p) => p.split("/").pop() === unit))
    .reduce((n, [, v]) => n + (typeof v === "number" ? v : Object.values(v || {}).reduce((a, b) => a + (b || 0), 0)), 0);
  const commits = run("git", ["log", `--since=${ctx.since}`, "--oneline", "--", ...paths]).trim();
  const last = run("git", ["log", "-1", "--format=%ad", "--date=short", "--", ...paths]).trim();
  return {
    name: f.name, flag: f.flag, flagDefault: f.flagDefault, doc: f.doc,
    code: tokeiCode(srcFiles),
    srcFiles: srcFiles.length,
    testFiles: testFiles.length,
    testLines: testFiles.reduce((n, x) => n + countLines(readFileSync(path.join(ctx.root, x), "utf8")), 0),
    cov: featureCoverage(ctx.covSummary, coverageEligible(srcFiles), ctx.root),
    bigFiles: Object.keys(ctx.fileSizeFlat).filter((k) => underAny(k, paths)).length,
    mocks: ctx.mockRecords.filter((r) => underAny(r.file, paths)).length,
    dep: ctx.depRecords.filter((r) => underAny(r.from, paths)).length,
    coup,
    commits: commits ? commits.split("\n").length : 0,
    last: last || "--",
  };
}

// ---------------------------------------------------------------- main
function refuse(code, headline, lines, footer) {
  console.error(`${headline}\n`);
  for (const l of lines) console.error("  " + l);
  if (footer) console.error(`\n${footer}`);
  process.exit(code);
}

function main() {
  const ROOT = process.cwd();
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(64);
  }
  // A source that cannot be PARSED is named and refused, not thrown as a bare
  // SyntaxError whose stack points at readJson rather than at the file.
  const read = (rel) => {
    try {
      return readJson(path.join(ROOT, rel), rel);
    } catch (err) {
      refuse(66, "A source this ledger joins is not readable:", [err.message]);
      return null; // unreachable — refuse() exits
    }
  };
  const spine = read("scripts/feature-map.json");
  if (!spine) refuse(64, "scripts/feature-map.json missing", []);

  const defaultsPath = path.join(ROOT, DEFAULTS_REL);
  const errors = spineErrors(ROOT, spine, existsSync(defaultsPath) ? readFileSync(defaultsPath, "utf8") : null);
  if (errors.length) {
    refuse(65, "feature-map.json is stale — the ledger refuses to generate:", errors,
      `${errors.length} stale entr${errors.length === 1 ? "y" : "ies"}. Fix the map, do not delete the row.`);
  }

  // ---------------------------------------------------------------- joins
  const sources = joinSources({
    fileSize: read("scripts/file-size-baseline.json"),
    mockB: read("scripts/mock-boundaries-baseline.json"),
    depX: read(".dependency-cruiser-known-violations.json"),
    coupling: read("scripts/plugin-store-coupling-baseline.json"),
  });
  if (sources.problems.length) {
    refuse(66, "A baseline is not the shape this join reads — its column would be all zeros, which reads as 'clean':", sources.problems,
      "Fix the parse. An all-zero column is a false all-clear.");
  }
  // COVERAGE PROVENANCE. Nothing tied coverage/coverage-summary.json to the
  // tree it was measured on, so a summary from an older checkout was reported
  // as this tree's coverage for as long as the filenames still matched
  // (audit R2 #134). There is no commit stamp in the summary, so the check is
  // the honest one available: if any measured source is NEWER than the
  // summary, it did not measure this tree, and the columns say `--` rather
  // than a number from somewhere else.
  // ONE inventory per feature, built here and consumed by both the
  // coverage-provenance scan below and every measured column. The staleness
  // scan used to re-enumerate every feature's tree for itself (audit R2 #125).
  const inventory = new Map(spine.features.map((f) => [f.name, featureInventory(normalizePaths(f.paths))]));

  const covPath = path.join(ROOT, "coverage/coverage-summary.json");
  let covSummary = read("coverage/coverage-summary.json");
  let covStale = false;
  if (covSummary !== null) {
    const summaryAt = statSync(covPath).mtimeMs;
    const newest = [...inventory.values()]
      .flatMap((files) => files.code)
      .reduce((max, rel) => {
        const st = statSync(path.join(ROOT, rel), { throwIfNoEntry: false });
        return st && st.mtimeMs > max ? st.mtimeMs : max;
      }, 0);
    covStale = newest > summaryAt;
    if (covStale) covSummary = null;
  }
  const ctx = { root: ROOT, since: args.since, covSummary, inventory, ...sources };

  let rows;
  try {
    rows = spine.features.map((f) => measureFeature(f, ctx));
  } catch (err) {
    refuse(67, "A measurement failed — the ledger refuses to print a number it did not measure:", [err.message]);
  }
  rows.sort((a, b) => (b.code || 0) - (a.code || 0));

  const covPresent = ctx.covSummary !== null;
  mkdirSync(path.join(ROOT, "dev-docs"), { recursive: true });
  // Written through a sibling temporary file and RENAMED into place: a direct
  // write truncates first, so an interruption leaves a half-written ledger that
  // still looks like the document (audit R2 #135). A rename within one
  // directory is atomic, so a reader sees the old file or the new one.
  const outPath = path.join(ROOT, OUTPUT_REL);
  const tmpPath = `${outPath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, renderLedger(rows, { since: args.since, defaultsRel: DEFAULTS_REL, covPresent }));
  renameSync(tmpPath, outPath);
  console.log(`wrote ${OUTPUT_REL} — ${rows.length} features`);
  if (!covPresent) {
    console.log(
      covStale
        ? "NOTE: coverage/coverage-summary.json is OLDER than a measured source file, so it did not measure this tree; coverage columns are '--'. Re-run `pnpm test:coverage`."
        : "NOTE: coverage/coverage-summary.json absent; coverage columns are '--'",
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
