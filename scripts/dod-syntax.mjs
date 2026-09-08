#!/usr/bin/env node
/**
 * Syntax-aware probes for the plan DoD checkers (scripts/lib/dod-assertions.sh).
 *
 * grep sees text; these see CODE. A `#[path = "x.test.rs"]` inside a block
 * comment, an `it(` on its own line inside a template literal, a
 * `provision::transition` in a doc comment, a journey whose `name:` sits in
 * some other object — each satisfied the line-anchored greps the assertions
 * used to run, and each is exactly the placeholder a DoD checker exists to
 * refuse (audit 20260907 #26, #27, #31, #32). TypeScript and JavaScript go
 * through the TypeScript compiler's parser, the way the repo's other AST
 * gates do (check-ipc-contract, check-mock-boundaries); Rust has no parser in
 * this toolchain, so it gets scripts/lib/rustSource.mjs — comments (nested)
 * and literals blanked before a regex runs, so what it runs over is code.
 * `ts-code-grep` and `rust-code-grep` are the same probe per language, and
 * both take `--keep-strings` for an assertion whose SUBJECT is a literal (an
 * event name, a menu id, an env-var name) rather than an identifier.
 *
 * What a probe proves, and what it does not: `ts-has-test-case` proves the
 * file DECLARES a runnable case; that vitest COLLECTS the file is already a
 * repository-wide invariant — `scripts/check-scripts-parity.test.mjs` reads
 * the four tiers' real include/exclude patterns and fails on any test file on
 * disk matched by no tier or by two — and that it PASSES is `pnpm check:all`'s
 * job. Restating either here would be a second copy of one policy that could
 * only ever agree with the first. Nor does it prove the case is reachable at
 * module evaluation: the obvious structural rule (only `describe` callbacks
 * may nest) was measured against every test file in the repo and refuses a
 * real one — `markdownPipeline/__tests__/performance.test.ts` nests its cases
 * under the ALIAS `describePerf`, which no static rule can recognise as a
 * suite root (audit 20260907 #27). `journey-shape` mirrors
 * e2e/run-journeys.mjs's discovery contract (`export default { name, run }`,
 * `name` a non-empty string, `run` a function) statically, and fails closed
 * on a shape it cannot resolve without executing the module.
 *
 * Usage (exit 0 = the property holds, 1 = it does not, 2 = unreadable input,
 * 64 = usage):
 *   node scripts/dod-syntax.mjs rust-mod-include <module.rs> <x.test.rs>
 *   node scripts/dod-syntax.mjs rust-code-grep [--keep-strings] <regex> <file.rs>...  (prints matching files)
 *   node scripts/dod-syntax.mjs ts-code-grep [--keep-strings] <regex> <file>...
 *   node scripts/dod-syntax.mjs ts-has-test-case <file> [title-substring]
 *   node scripts/dod-syntax.mjs journey-shape <file.mjs>
 *
 * @coordinates-with scripts/lib/dod-assertions.sh — the assertion helpers that call this
 * @coordinates-with scripts/lib/rustSource.mjs — the Rust comment/literal lexer
 * @coordinates-with scripts/dod-syntax.test.mjs — the self-test
 * @coordinates-with e2e/run-journeys.mjs — the discovery contract journey-shape mirrors
 * @module scripts/dod-syntax
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import { rustCode } from "./lib/rustSource.mjs";

const USAGE =
  "usage: node scripts/dod-syntax.mjs rust-mod-include <module.rs> <x.test.rs>\n" +
  "       node scripts/dod-syntax.mjs rust-code-grep [--keep-strings] <regex> <file.rs>...\n" +
  "       node scripts/dod-syntax.mjs ts-code-grep [--keep-strings] <regex> <file>...\n" +
  "       node scripts/dod-syntax.mjs ts-has-test-case <file> [title-substring]\n" +
  "       node scripts/dod-syntax.mjs journey-shape <file.mjs>";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------- Rust

/**
 * A `cfg` gate this probe cannot evaluate. `cfg(test)` is the one it can:
 * `cargo test` sets it, and a test module needs to compile in no other build.
 * Anything else — `cfg(any())` (the canonical "disable this"), a feature, a
 * target — makes the include CONDITIONAL, and a conditional include is not a
 * discovered test. Measured across all 222 `#[path = "*.test.rs"]` sites in
 * `src-tauri/src`: 221 carry exactly `#[cfg(test)]`, one carries no attribute
 * at all, and none carries any other `cfg` — so this refuses nothing that
 * ships today (audit 20260907 #26).
 */
function unevaluatableCfg(attrRun) {
  for (const m of attrRun.matchAll(/#\[([^\]]*)\]/g)) {
    const body = m[1].trim();
    if (!/^cfg(_attr)?\b/.test(body)) continue;
    if (body.replace(/\s+/g, "") !== "cfg(test)") return true;
  }
  return false;
}

/** The contiguous attribute run immediately before `index` — in Rust, attributes attached to the same item. */
const attrRunBefore = (code, index) => /(?:#\[[^\]]*\]\s*)*$/.exec(code.slice(0, index))[0];

/**
 * Does `moduleSource` include the test file `base` the way cargo compiles it:
 * an ACTIVE `#[path = "<base>"]` attribute, followed — other attributes only —
 * by the `mod x;` it decorates, with no `cfg` gate on the item this probe
 * cannot evaluate? The same grammar headerReferences.mjs reads for `@module`.
 * A commented-out attribute, or one with anything but another attribute
 * between it and a `mod`, includes nothing.
 *
 * The attribute must also be CODE. `keepStrings` is required here — the path
 * IS a string literal — which leaves a whole `#[path = "x.test.rs"] mod t;`
 * quoted inside a RAW string intact, and it matched (audit 20260907 #26; the
 * ordinary-string case only failed because `\"` breaks the regex, which is
 * luck, not a check). The fully-blanked source tells the two apart: a `#` that
 * survives literal blanking is code, one that does not was inside a literal.
 */
export function rustModIncludes(moduleSource, base) {
  const code = rustCode(moduleSource, { keepStrings: true });
  const bare = rustCode(moduleSource);
  const re = new RegExp(
    String.raw`#\[\s*path\s*=\s*"${escapeRe(base)}"\s*\]\s*((?:#\[[^\]]*\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z_]\w*\s*;`,
    "g",
  );
  for (const m of code.matchAll(re)) {
    if (bare[m.index] !== "#") continue;
    if (unevaluatableCfg(attrRunBefore(code, m.index)) || unevaluatableCfg(m[1])) continue;
    return true;
  }
  return false;
}

/**
 * `re` without its STATEFUL flags (`g`, `y`).
 *
 * `RegExp.prototype.test` on a global or sticky regex advances `lastIndex` and
 * resumes from it on the next call, so ONE regex reused across a list of files
 * gives an answer that depends on where the previous file happened to match:
 * file 2 is tested from an offset file 1 left behind, and a real match is
 * missed. That is a silent FALSE NEGATIVE in a probe whose whole job is to
 * report a match, and both `rustCodeMatches` and the `ts-code-grep` filter did
 * it (audit R3 #111). Cloning is preferred to resetting `lastIndex` because the
 * caller's regex is not this function's to mutate.
 */
export function statelessRe(re) {
  const flags = re.flags.replace(/[gy]/g, "");
  return flags === re.flags ? re : new RegExp(re.source, flags);
}

/**
 * Does the CODE of `source` match `re`? Comments are always blanked; string
 * literals are blanked too unless `keepStrings`, which a probe whose SUBJECT
 * is a literal needs (`accel("save", …)`, `var("DBUS_SESSION_BUS_ADDRESS")`).
 */
export function rustCodeMatches(source, re, { keepStrings = false } = {}) {
  return statelessRe(re).test(rustCode(source, { keepStrings }));
}

// ---------------------------------------------------------------- TypeScript / JavaScript

export function parseSource(file, source) {
  const kind = file.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : /\.(m?js|cjs|jsx)$/.test(file)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

const TS_LITERAL_KINDS = [
  ts.isStringLiteral,
  ts.isNoSubstitutionTemplateLiteral,
  ts.isTemplateHead,
  ts.isTemplateMiddle,
  ts.isTemplateTail,
  ts.isRegularExpressionLiteral,
  ts.isJsxText,
];

/**
 * `source` reduced to what TypeScript reads as CODE, offsets and newlines
 * preserved. Two passes, in this order because the second depends on the
 * first: every LITERAL is blanked through the parser (which is the only thing
 * that can tell a regex from a division and find the ends of a nested
 * template), and then — with no literal left to hide one — `//` and block
 * comments are blanked by a plain scan.
 *
 * `keepStrings` is for a probe whose SUBJECT is a literal: an event name, a
 * menu id, a settings key. It keeps the literals and blanks only the comments.
 */
export function tsCode(sf, source, { keepStrings = false } = {}) {
  let text = source;
  if (!keepStrings) {
    const chars = source.split("");
    const visit = (node) => {
      if (TS_LITERAL_KINDS.some((is) => is(node))) {
        for (let i = node.getStart(sf); i < node.end; i++) if (chars[i] !== "\n") chars[i] = " ";
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    text = chars.join("");
  }
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

/** `it.each` → ["it", "each"]; anything not rooted in an identifier → null. */
function calleeChain(expr) {
  const parts = [];
  let e = expr;
  while (ts.isPropertyAccessExpression(e)) {
    parts.unshift(e.name.text);
    e = e.expression;
  }
  return ts.isIdentifier(e) ? [e.text, ...parts] : null;
}

const CASE_ROOTS = new Set(["it", "test"]);
const SUITE_ROOTS = new Set(["describe", "suite"]);
const INERT = new Set(["skip", "todo"]);
const isTitle = (arg) =>
  arg !== undefined && (ts.isStringLiteralLike(arg) || ts.isTemplateExpression(arg));
const titleText = (arg, sf) => (ts.isStringLiteralLike(arg) ? arg.text : arg.getText(sf));

/**
 * An argument that could BE the handler. A title with nothing after it is
 * vitest's todo form — `it("placeholder")` registers a case that never runs —
 * and `test("x", undefined)` is the same placeholder spelled out, so neither
 * is the deliverable a DoD checker is asserting (audit R2 #112). Anything that
 * can evaluate to a function counts, including `it(title, options, fn)`.
 */
const isHandlerArg = (arg) =>
  arg !== undefined &&
  !ts.isStringLiteralLike(arg) &&
  !ts.isNumericLiteral(arg) &&
  !ts.isObjectLiteralExpression(arg) &&
  !ts.isArrayLiteralExpression(arg) &&
  !(ts.isIdentifier(arg) && arg.text === "undefined") &&
  arg.kind !== ts.SyntaxKind.NullKeyword &&
  arg.kind !== ts.SyntaxKind.TrueKeyword &&
  arg.kind !== ts.SyntaxKind.FalseKeyword;

/**
 * Roots a file DECLARES for itself, so its `it(...)` is not vitest's.
 * `import { it } from "vitest"` is the ordinary form and does not shadow; a
 * local `const it = () => {}` does, and it is exactly how a placeholder would
 * satisfy a "declares a case" probe (audit R2 #113).
 */
function shadowedRoots(sf) {
  const shadowed = new Set();
  const consider = (name) => {
    if (ts.isIdentifier(name) && (CASE_ROOTS.has(name.text) || SUITE_ROOTS.has(name.text))) shadowed.add(name.text);
  };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) consider(st.name);
    else if (ts.isClassDeclaration(st) && st.name) consider(st.name);
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) consider(d.name);
  }
  return shadowed;
}

/**
 * Cases the file DECLARES: `it("…", fn)` / `test("…", fn)` calls whose first
 * argument is a title (so `it.each([...])` — whose first argument is the table
 * — counts once, through the call it returns) and which carry a handler, minus
 * `.skip`/`.todo` cases and every case under a `describe.skip`/`.todo` suite.
 * Comments, strings and template literals are not code and cannot declare one.
 *
 * With `titleIncludes`, only cases whose title CONTAINS that text count — what
 * a DoD assertion means by "this named test exists", where a grep for the
 * title also matched an `it.skip` and a title in a comment.
 */
export function declaredTestCases(sf, { titleIncludes } = {}) {
  const shadowed = shadowedRoots(sf);
  let count = 0;
  const visit = (node, inert) => {
    if (ts.isCallExpression(node)) {
      let callee = node.expression;
      if (ts.isCallExpression(callee)) callee = callee.expression;
      const chain = calleeChain(callee);
      if (chain && !shadowed.has(chain[0])) {
        const skipped = inert || chain.slice(1).some((p) => INERT.has(p));
        const title = node.arguments[0];
        if (
          CASE_ROOTS.has(chain[0]) &&
          !skipped &&
          isTitle(title) &&
          node.arguments.slice(1).some(isHandlerArg) &&
          (titleIncludes === undefined || titleText(title, sf).includes(titleIncludes))
        ) {
          count += 1;
        }
        if (SUITE_ROOTS.has(chain[0])) {
          ts.forEachChild(node, (child) => visit(child, skipped));
          return;
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, inert));
  };
  visit(sf, false);
  return count;
}

/**
 * The initializer (or function declaration) a top-level `name` binds to, if
 * any. Variable bindings must be `const`: a `let` can be reassigned after the
 * literal the checker inspected, so its initializer is not what the runner
 * will import (audit R2 #115).
 */
function topLevelBinding(sf, name) {
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
    if (!ts.isVariableStatement(st)) continue;
    if ((st.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name) return d.initializer;
    }
  }
  return undefined;
}

/** Is there an `<name>.<anything> = …` assignment anywhere in the file? */
function isMutated(sf, name) {
  let mutated = false;
  const visit = (node) => {
    if (mutated) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === name
    ) {
      mutated = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return mutated;
}

const isFunctionLike = (node) =>
  node !== undefined &&
  (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isFunctionDeclaration(node));

/**
 * The property that DECIDES `name` at runtime: the LAST assignment in source
 * order, because that is the one the object literal keeps. Taking the first
 * meant `{ name: "journey", name: "" }` — and any spread or computed key that
 * overrides it — read as valid while the runner saw something else
 * (audit R2 #116). A spread or a computed key is not resolvable statically at
 * all, so it is reported rather than skipped.
 */
function propertyNamed(obj, name) {
  let found;
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) return { unresolvable: "a spread that may override it" };
    if (p.name !== undefined && ts.isComputedPropertyName(p.name)) return { unresolvable: "a computed key that may override it" };
    if (p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) found = p;
  }
  return found;
}

/**
 * The shape e2e/run-journeys.mjs discovers: `export default { name, run }`
 * with a non-empty string `name` and a function `run` — on the literal itself,
 * or on a top-level const the default export names. Anything it cannot
 * resolve statically is reported as not discoverable, with the reason.
 */
export function journeyShape(sf) {
  if (sf.parseDiagnostics.length > 0) {
    return { ok: false, reason: `does not parse: ${ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " ")}` };
  }
  const exported = sf.statements.find((s) => ts.isExportAssignment(s) && !s.isExportEquals);
  if (!exported) return { ok: false, reason: "no `export default`" };
  let obj = exported.expression;
  if (ts.isIdentifier(obj)) obj = topLevelBinding(sf, obj.text);
  if (!obj || !ts.isObjectLiteralExpression(obj)) {
    return { ok: false, reason: "`export default` is not an object literal (nor a top-level const holding one)" };
  }
  if (ts.isIdentifier(exported.expression) && isMutated(sf, exported.expression.text)) {
    return { ok: false, reason: `\`${exported.expression.text}\` is mutated after it is declared, so its literal is not what the runner imports` };
  }
  const nameProp = propertyNamed(obj, "name");
  if (nameProp?.unresolvable) return { ok: false, reason: `\`name\` cannot be resolved statically: the object carries ${nameProp.unresolvable}` };
  const nameValue = nameProp && ts.isPropertyAssignment(nameProp) ? nameProp.initializer : undefined;
  if (!nameValue || !ts.isStringLiteralLike(nameValue) || nameValue.text === "") {
    return { ok: false, reason: "`name` is not a non-empty string literal" };
  }
  const runProp = propertyNamed(obj, "run");
  if (runProp?.unresolvable) return { ok: false, reason: `\`run\` cannot be resolved statically: the object carries ${runProp.unresolvable}` };
  let runIsFunction = false;
  if (runProp && ts.isMethodDeclaration(runProp)) runIsFunction = true;
  else if (runProp && ts.isPropertyAssignment(runProp)) {
    const v = runProp.initializer;
    runIsFunction = isFunctionLike(v) || (ts.isIdentifier(v) && isFunctionLike(topLevelBinding(sf, v.text)));
  } else if (runProp && ts.isShorthandPropertyAssignment(runProp)) {
    runIsFunction = isFunctionLike(topLevelBinding(sf, runProp.name.text));
  }
  if (!runIsFunction) return { ok: false, reason: "`run` is missing or is not a function" };
  return { ok: true, name: nameValue.text };
}

// ---------------------------------------------------------------- CLI

function readOrExit(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (err) {
    console.error(`dod-syntax: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}

/**
 * The `[--keep-strings] <pattern> <file…>` argument shape both grep subcommands
 * take: `{ keepStrings, re, files }`, or `{ usage: true }` / `{ badPattern }`.
 *
 * ONE parser, because it was written twice — and the pair is exactly how the
 * `lastIndex` defect above came to exist in both branches at once, and how a
 * fix to one of them would have left the other wrong (audit R3 #117). The
 * regex is built STATELESS here as well as defensively in `rustCodeMatches`,
 * since the `ts-code-grep` branch tests it directly.
 */
function grepArgs(rest) {
  const keepStrings = rest[0] === "--keep-strings";
  const [pattern, ...files] = keepStrings ? rest.slice(1) : rest;
  if (!pattern || files.length === 0) return { usage: true };
  try {
    return { keepStrings, re: statelessRe(new RegExp(pattern)), files };
  } catch (err) {
    return { badPattern: `dod-syntax: invalid pattern ${JSON.stringify(pattern)}: ${err.message}` };
  }
}

/** Report the matching files; exit 0 when at least one matched, 1 otherwise. */
function reportHits(hits) {
  for (const h of hits) console.log(h);
  return hits.length > 0 ? 0 : 1;
}

export function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "rust-mod-include": {
      const [mod, base] = rest;
      if (!mod || !base || rest.length !== 2) break;
      if (rustModIncludes(readOrExit(mod), base)) return 0;
      console.error(`${mod}: no active #[path = "${base}"] followed by \`mod …;\` outside comments`);
      return 1;
    }
    case "rust-code-grep": {
      const args = grepArgs(rest);
      if (args.usage) break;
      if (args.badPattern) {
        console.error(args.badPattern);
        return 64;
      }
      return reportHits(
        args.files.filter((f) => rustCodeMatches(readOrExit(f), args.re, { keepStrings: args.keepStrings })),
      );
    }
    case "ts-code-grep": {
      const args = grepArgs(rest);
      if (args.usage) break;
      if (args.badPattern) {
        console.error(args.badPattern);
        return 64;
      }
      return reportHits(
        args.files.filter((f) => {
          const source = readOrExit(f);
          const sf = parseSource(f, source);
          return args.re.test(tsCode(sf, source, { keepStrings: args.keepStrings }));
        }),
      );
    }
    case "ts-has-test-case": {
      const [file, titleIncludes] = rest;
      if (!file || rest.length < 1 || rest.length > 2) break;
      const sf = parseSource(file, readOrExit(file));
      // A file the parser only RECOVERED is not a file whose cases run: error
      // recovery invents nodes, so counting them is counting a guess
      // (audit R2 #118). journeyShape already refused on this; this did not.
      if (sf.parseDiagnostics.length > 0) {
        console.error(`${file}: does not parse: ${ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " ")}`);
        return 1;
      }
      if (declaredTestCases(sf, { titleIncludes }) > 0) return 0;
      const what = titleIncludes === undefined ? "" : ` whose title contains ${JSON.stringify(titleIncludes)}`;
      console.error(
        `${file}: declares no runnable it()/test() case${what} ` +
          "(a title with no handler, a comment, a string, skip and todo do not count)",
      );
      return 1;
    }
    case "journey-shape": {
      const [file] = rest;
      if (!file || rest.length !== 1) break;
      const r = journeyShape(parseSource(file, readOrExit(file)));
      if (r.ok) return 0;
      console.error(`${file}: ${r.reason}`);
      return 1;
    }
    default:
      break;
  }
  console.error(USAGE);
  return 64;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
