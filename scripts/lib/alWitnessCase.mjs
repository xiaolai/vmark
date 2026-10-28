/**
 * Purpose: select ONE named test case in a test file — a vitest case by its
 *   exact title, a Rust test fn by its name, an e2e journey by its `name` —
 *   and reduce the file to the code that case alone reaches: the evidence a witness row's assertions are
 *   matched against (scripts/al-witness.mjs).
 *
 * A witness must be a case that runs on its own and runs once, so these are
 * refused, each with a reason naming what was found instead:
 *   - TypeScript: a file that does not parse cleanly; no registered case with
 *     exactly that title (a skipped or todo case, a case under a skipped
 *     suite, a form outside the registration grammar, and a title that sits
 *     only in a comment or a string all say so); more than one; a table case
 *     (`.each`/`.for`, which runs once per row); `.only` or `.fails` on the
 *     case or on a suite holding it.
 *   - Rust: no test fn of that name cargo runs on this host (an ignored or
 *     compiled-out fn gives its reason, a plain fn says it is not a test, a
 *     name only in a comment or a string says so); more than one.
 *   - e2e journey (e2e/journeys/NN-*.mjs, one journey per file): a default
 *     export that is not one object literal, a `name` that is not the title's
 *     string literal, or no inline `run`. The evidence is that export's own
 *     text and what `run` reaches; the journey's name is blanked like a title.
 * The case's own name — the vitest title, the Rust fn's identifier — is blanked
 * from the reach: a title such as `revert_preserves_…` would otherwise satisfy
 * an assertion like `revert\w*\(` that only a call in the body should.
 * Registration and reach are the shared probes (dodSyntaxRegister.mjs,
 * dodSyntaxReach.mjs), so "reaches" means here exactly what `--test-reach`
 * means for the keyword pre-checks, narrowed to one case.
 *
 * @coordinates-with scripts/al-witness.mjs — matches each row's assertions against the reduced text
 * @coordinates-with scripts/lib/dodSyntaxReach.mjs — tsCaseReach and rustFnReach
 * @module scripts/lib/alWitnessCase
 */
import ts from "typescript";
import { parseSource, testRoots } from "./dodSyntaxTs.mjs";
import { oneFileChecker } from "./dodSyntaxRegister.mjs";
import { vitestCall } from "./dodSyntaxVitest.mjs";
import { rustFnReach, tsCaseReach, tsRootReach } from "./dodSyntaxReach.mjs";
import { rustReachRoots } from "./dodSyntaxRustReach.mjs";
import { rustCode } from "./rustSource.mjs";

/** `text` with [start, end) replaced by spaces, so every other offset is unchanged. */
const blank = (text, start, end) => text.slice(0, start) + " ".repeat(end - start) + text.slice(end);

const literalTitle = (call) => {
  const arg = call.arguments[0];
  return arg && ts.isStringLiteralLike(arg) ? arg.text : null;
};

/** The property and table names between a vitest root and the registering call, e.g. `it.only.each(t)(…)` → only, each. */
function chain(call) {
  const names = [];
  let e = call.expression;
  for (;;) {
    if (ts.isPropertyAccessExpression(e)) {
      names.push(e.name.text);
      e = e.expression;
    } else if (ts.isCallExpression(e)) e = e.expression;
    else return names;
  }
}

/** Why the matched case `call` cannot stand as a witness, or null. */
function refusal(call, checker) {
  const own = chain(call);
  if (own.includes("each") || own.includes("for")) return "it is a table case (.each/.for), which runs once per row — a witness is one case";
  if (own.includes("only") || own.includes("fails")) return `it is marked .${own.includes("only") ? "only" : "fails"} — a witness runs plainly`;
  for (let n = call.parent; n; n = n.parent) {
    if (!ts.isCallExpression(n)) continue;
    const reg = vitestCall(n, checker);
    if (reg?.kind === "suite" && chain(n).includes("only")) return "a suite holding it is marked .only — a witness runs plainly";
  }
  return null;
}

/** Why no registered case is titled `title`: what the file holds under that name instead. */
function absence(sf, source, title, checker, unsupported) {
  let registered = false;
  const visit = (n) => {
    if (ts.isCallExpression(n) && vitestCall(n, checker)?.kind === "case" && literalTitle(n) === title) registered = true;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (registered) {
    const why = unsupported.length > 0 ? ` (${unsupported.join("; ")})` : "";
    return `a case titled "${title}" exists but never runs: skipped, todo, under a skipped suite, without a handler, or registered outside the supported forms${why}`;
  }
  if (source.includes(title)) return `"${title}" appears only in a comment or a string, not as a registered case's title`;
  return `no test is titled "${title}"`;
}

/**
 * `{ reach }` — the file `file` (its text `source`) reduced to what the one
 * case titled exactly `title` reaches — or `{ error }` saying why there is no
 * such single, plain, runnable case.
 */
export function tsWitnessCase(file, source, title) {
  const sf = parseSource(file, source);
  const diagnostics = sf.parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const d = diagnostics[0];
    const line = sf.getLineAndCharacterOfPosition(d.start ?? 0).line + 1;
    return { error: `the file does not parse cleanly (line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")})` };
  }
  const checker = oneFileChecker(sf);
  const roots = testRoots(sf, { titleIncludes: title });
  const matches = roots.cases.filter((c) => literalTitle(c) === title);
  if (matches.length === 0) return { error: absence(sf, source, title, checker, roots.unsupported.map((u) => u.reason)) };
  if (matches.length > 1) return { error: `${matches.length} cases are titled "${title}" — a witness names exactly one` };
  const why = refusal(matches[0], checker);
  if (why) return { error: why };
  const arg = matches[0].arguments[0];
  return { reach: blank(tsCaseReach(sf, source, roots, matches[0]), arg.getStart(sf), arg.getEnd()) };
}

/**
 * `{ reach }` — a Rust test file reduced to what the one test fn named `name`
 * that cargo runs on this host reaches — or `{ error }` saying why there is
 * no such single fn.
 */
export function rustWitnessCase(source, name) {
  const { roots, rejected } = rustReachRoots(source);
  const matches = roots.filter((fn) => fn.name === name);
  if (matches.length > 1) return { error: `${matches.length} test fns are named ${name} — a witness names exactly one` };
  if (matches.length === 1) {
    const reach = rustFnReach(source, matches[0]);
    const sig = new RegExp(`\\bfn\\s+(${name})\\b`, "d").exec(reach);
    return { reach: sig ? blank(reach, ...sig.indices[1]) : reach };
  }
  const why = rejected.find((r) => r.name === name);
  if (why) return { error: `test fn ${name} does not run here: ${why.reason}` };
  if (new RegExp(`\\bfn\\s+${name}\\b`).test(rustCode(source))) return { error: `fn ${name} is not a #[test] fn cargo runs` };
  if (source.includes(name)) return { error: `${name} appears only in a comment or a string, not as a test fn` };
  return { error: `no test fn is named ${name}` };
}

/** The value of property `key` in the object literal `obj`, or null; a method counts as its own value. */
const property = (obj, key) => obj.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === key) ?? null;

/**
 * `{ reach }` — an e2e journey module (one journey per file, run by
 * e2e/run-journeys.mjs) reduced to what its default export and its `run`
 * reach, when that export is an object literal whose `name` is the string
 * `title` — or `{ error }` saying what the file holds instead.
 */
export function e2eWitnessCase(file, source, title) {
  const sf = parseSource(file, source);
  const diagnostics = sf.parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const d = diagnostics[0];
    const line = sf.getLineAndCharacterOfPosition(d.start ?? 0).line + 1;
    return { error: `the file does not parse cleanly (line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")})` };
  }
  const exports = sf.statements.filter((s) => ts.isExportAssignment(s) && !s.isExportEquals);
  const obj = exports.length === 1 && ts.isObjectLiteralExpression(exports[0].expression) ? exports[0].expression : null;
  if (!obj) return { error: `a journey's default export must be one object literal \`{ name, run }\` (found ${exports.length} default export(s))` };
  const name = property(obj, "name");
  const value = name && ts.isPropertyAssignment(name) && ts.isStringLiteralLike(name.initializer) ? name.initializer : null;
  if (!value) return { error: "the journey's `name` is not a string literal" };
  if (value.text !== title) {
    const where = source.includes(title) ? `; "${title}" appears only in a comment or a string` : "";
    return { error: `the journey is named "${value.text}", not "${title}"${where}` };
  }
  const run = property(obj, "run");
  const body = run && ts.isMethodDeclaration(run) ? run : run && ts.isPropertyAssignment(run) && ts.isFunctionLike(run.initializer) ? run.initializer : null;
  if (!body?.body) return { error: "the journey has no inline `run` function — its body is the evidence" };
  return { reach: blank(tsRootReach(sf, source, exports[0], body), value.getStart(sf), value.getEnd()) };
}
