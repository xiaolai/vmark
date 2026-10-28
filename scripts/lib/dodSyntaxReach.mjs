/**
 * Purpose: a test file reduced to its EVIDENCE — the code its runnable test
 *   cases read or execute: the case itself (title, table, handler), the titles
 *   of the suites holding one, their lifecycle hooks, the fixture values those
 *   read and the same-file functions they call, transitively. Everything
 *   else, and every comment, is blanked; literals in kept code are kept.
 *
 * A coverage proxy that greps a whole test file is satisfied by text no run
 * executes: an unused fixture string, a helper nothing calls or only stores, a
 * body nested in a test but never invoked, a skipped or compiled-out case —
 * each sitting beside an unrelated passing test. These probes recognise a
 * documented subset of registration and reference forms, resolved by
 * BINDING, not by name; an unsupported or ambiguous path contributes nothing:
 *   - TypeScript: dodSyntaxRegister.mjs (which cases register) and
 *     dodSyntaxTsReach.mjs (what they read and call).
 *   - Rust: dodSyntaxRustReach.mjs (which test fns cargo runs here, and the
 *     uniquely resolved plain-path calls and const reads they make).
 * `tsCaseReach` and `rustFnReach` reduce a file to what ONE case reaches: the
 * evidence of a single named witness, not of the file.
 *
 * @coordinates-with scripts/dod-syntax.mjs — the `--test-reach` flag of both grep probes
 * @coordinates-with scripts/lib/dodSyntaxTs.mjs — the comment-blanked text
 * @coordinates-with scripts/lib/dodSyntaxTsReach.mjs — the TypeScript evidence spans
 * @coordinates-with scripts/lib/dodSyntaxRustReach.mjs — the Rust items and name resolution
 * @coordinates-with scripts/lib/rustSource.mjs — the Rust comment/literal lexer
 * @module scripts/lib/dodSyntaxReach
 */
import { tsCode } from "./dodSyntaxTs.mjs";
import { tsEvidenceSpans } from "./dodSyntaxTsReach.mjs";
import { testRoots } from "./dodSyntaxRegister.mjs";
import { rustReachRoots } from "./dodSyntaxRustReach.mjs";
import { rustCode } from "./rustSource.mjs";

/** `text` with every character outside `spans` ([start, end) pairs) blanked; newlines kept. */
function keepOnly(text, spans) {
  const keep = new Uint8Array(text.length);
  for (const [start, end] of spans) keep.fill(1, start, end);
  let out = "";
  for (let i = 0; i < text.length; i++) out += keep[i] || text[i] === "\n" ? text[i] : " ";
  return out;
}

/**
 * The items reached from `roots`: each item is `{ spans, targets }`, where
 * `targets()` lists the items the item's kept code calls or reads.
 */
function reach(roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const item = queue.pop();
    if (seen.has(item)) continue;
    seen.add(item);
    for (const d of item.targets()) if (!seen.has(d)) queue.push(d);
  }
  return [...seen];
}

/** A TypeScript / JavaScript test file, parsed as `sf`, reduced to what its cases read and execute. */
export function tsTestReach(sf, source) {
  return keepOnly(tsCode(sf, source, { keepStrings: true }), tsEvidenceSpans(sf));
}

/**
 * A TypeScript test file reduced to what the ONE registered case `call` (from
 * `roots`, its file's `testRoots`) reads and executes — its title, table and
 * handler, and what those reach. Suite titles and hooks are not its evidence.
 */
export function tsCaseReach(sf, source, roots, call) {
  const one = { cases: [call], suiteTitles: [], hooks: [], bodies: roots.bodies };
  return keepOnly(tsCode(sf, source, { keepStrings: true }), tsEvidenceSpans(sf, one));
}

/**
 * A JavaScript file reduced to what ONE non-vitest root reads and executes:
 * `root`'s own text (its nested functions blank) and the function `body` it
 * runs, with what that reaches — an e2e journey's default export and its
 * `run`. `root` must not be a call: it is read, never registered.
 */
export function tsRootReach(sf, source, root, body) {
  const one = { cases: [root], suiteTitles: [], hooks: [], bodies: new Map([[root, body]]) };
  return keepOnly(tsCode(sf, source, { keepStrings: true }), tsEvidenceSpans(sf, one));
}

/** A Rust test file reduced to what the ONE root `fn` (from `rustReachRoots`) reads and executes. */
export function rustFnReach(source, fn) {
  return keepOnly(rustCode(source, { keepStrings: true }), reach([fn]).flatMap((it) => it.spans));
}

/**
 * A Rust test file reduced to what the test fns cargo runs on `target`
 * (default: this host) read
 * and execute. Which fns are roots, and how a name resolves to an item,
 * are dodSyntaxRustReach.mjs.
 */
export function rustTestReach(source, target) {
  return keepOnly(rustCode(source, { keepStrings: true }), reach(rustReachRoots(source, target).roots).flatMap((it) => it.spans));
}

/** Why registration forms in `sf` were not read: one `line N: …` reason each. */
export function tsReachNotes(sf, { titleIncludes } = {}) {
  return testRoots(sf, { titleIncludes }).unsupported.map((u) => u.reason);
}

/**
 * Why a Rust file gives less evidence than its text: one `test fn name: …`
 * reason per test fn that is no root, and one `line N: …` per cut inside a
 * reached item (code there never runs on that target).
 */
export function rustReachNotes(source, target) {
  const { roots, rejected, cuts, unawaited } = rustReachRoots(source, target);
  const reached = reach(roots);
  const inside = (c) => reached.some((it) => it.span[0] <= c.span[0] && c.span[0] < it.span[1]);
  return [
    ...rejected.map((r) => `test fn ${r.name}: ${r.reason}`),
    ...cuts.filter(inside).map((c) => `line ${c.line}: ${c.reason}`),
    ...unawaited.map((u) => `line ${u.line}: a call to async fn ${u.name} nothing awaits directly`),
  ];
}
