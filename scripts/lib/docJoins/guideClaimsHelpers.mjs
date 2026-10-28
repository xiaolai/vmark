/**
 * Purpose: the parsing and comparison helpers guide claims are written with —
 *   capture a value (from guide prose, or from a code view so comments and
 *   unrelated literals never match), cut a bracketed body out of code, read number words and durations, read array literals and
 *   code-span lists, compare two values or two lists, find a guide table,
 *   reduce a Rust file to its production code.
 *
 * @coordinates-with scripts/lib/docJoins/guideClaimsTable.mjs — the claims that use them
 * @module scripts/lib/docJoins/guideClaimsHelpers
 */
import { rustCode } from "../rustSource.mjs";
import { inLiteral } from "./codeView.mjs";
import { parseTables, stripMarkdown } from "./markdownTables.mjs";

/**
 * The first capture of `re` in a code view (codeView.mjs) whose match STARTS
 * in code — or, with `inLiteral`, inside a literal (a log line the guide
 * quotes). Comments are already blanked, so a commented-out copy never
 * matches; a copy quoted inside a string is skipped. Throws, naming `what`,
 * when no match qualifies.
 */
export function captureCode(view, re, what, { inLiteral: wantLiteral = false } = {}) {
  const all = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of view.text.matchAll(all)) if (inLiteral(view, m.index) === wantLiteral) return m[1];
  throw new Error(`${what} not found (pattern ${re}${wantLiteral ? ", in a literal" : ", in code"})`);
}

/** Offset of the first occurrence of `needle` in code (not in a comment or literal); throws naming `what`. */
export function codeIndexOf(view, needle, what) {
  const at = view.bare.indexOf(needle);
  if (at === -1) throw new Error(`${what} not found`);
  return at;
}

const CLOSERS = { "{": "}", "[": "]", "(": ")" };

/**
 * The code from `from` through the bracket that closes the first `open`
 * bracket at or after it, comments blanked (literals kept). Brackets are
 * matched in code only, so a `]` in a string cannot end it early; throws,
 * naming `what`, when it never closes.
 */
export function delimitedBody(view, from, open, what) {
  const start = view.bare.indexOf(open, from);
  if (start === -1) throw new Error(`${what}: no ${open} after offset ${from}`);
  let depth = 0;
  for (let i = start; i < view.bare.length; i++) {
    if (view.bare[i] === open) depth++;
    else if (view.bare[i] === CLOSERS[open] && --depth === 0) return view.text.slice(from, i + 1);
  }
  throw new Error(`${what}: unterminated ${open}`);
}

/** The first capture of `re` in `text`; throws, naming `what`, when it does not match. */
export function capture(text, re, what) {
  const m = re.exec(text);
  if (!m) throw new Error(`${what} not found (pattern ${re})`);
  return m[1];
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** "two" → 2, "12" → 12; throws on anything else. */
export function numberFromWord(word) {
  if (/^\d+$/.test(word)) return Number(word);
  const n = NUMBER_WORDS.indexOf(word.toLowerCase());
  if (n === -1) throw new Error(`"${word}" is not a number word this join knows`);
  return n;
}

/** "a second" / "2 seconds" / "500 ms" → milliseconds. */
export function durationMs(phrase) {
  if (phrase === "a second") return 1000;
  const m = /^(\w+) (seconds?|ms)$/.exec(phrase);
  if (!m) throw new Error(`"${phrase}" is not a duration this join reads`);
  return m[2] === "ms" ? numberFromWord(m[1]) : numberFromWord(m[1]) * 1000;
}

/**
 * The string literals of the array literal a Rust or TS `const name` declares,
 * read from a code view (codeView.mjs): the declaration is found in code, so
 * one in a comment or quoted in a string is not it. A scanner, not a regex: it walks the literal tracking strings and comments,
 * so a `//`, a `/*`, an escaped quote or a `]` inside a string is content, and
 * a comment's quotes are not entries. Fails loud on what it cannot read — an
 * unterminated array or string, a `'` or backtick literal — rather than
 * returning a shorter list that a claim would compare as if complete.
 */
export function arrayStrings(view, name) {
  const decl = new RegExp(`\\bconst\\s+${name}\\b[^=]*=`).exec(view.bare);
  if (!decl) throw new Error(`no \`const ${name}\` declaration`);
  const source = view.text;
  const open = source.indexOf("[", decl.index + decl[0].length);
  if (open === -1) throw new Error(`${name}: no array literal`);
  const out = [];
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "[") depth++;
    else if (c === "]") {
      if (--depth === 0) return out;
    } else if (c === '"') {
      const end = stringEnd(source, i);
      if (end === -1) break;
      out.push(decodeString(source.slice(i, end + 1), name));
      i = end;
    } else if (source.startsWith("//", i)) {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? source.length : nl;
    } else if (source.startsWith("/*", i)) {
      const close = source.indexOf("*/", i + 2);
      if (close === -1) break;
      i = close + 1;
    } else if (c === "'" || c === "`") {
      throw new Error(`${name}: unsupported literal at offset ${i} — only double-quoted strings are read`);
    }
  }
  throw new Error(`${name}: unterminated array literal`);
}

/** Index of the `"` closing the string opened at `start`, honouring backslash escapes; -1 when it never closes. */
function stringEnd(source, start) {
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") i++;
    else if (source[i] === '"') return i;
    else if (source[i] === "\n" && source[i - 1] !== "\\") return -1;
  }
  return -1;
}

/** A double-quoted literal's value; its escapes must be ones JSON shares with Rust and TS. */
function decodeString(literal, name) {
  try {
    return JSON.parse(literal);
  } catch {
    throw new Error(`${name}: cannot read the string literal ${literal}`);
  }
}

/** Code spans in the parenthesis that follows `lead` in `text`; throws when it never closes. */
export function spansAfter(text, lead, what) {
  const at = text.indexOf(lead);
  if (at === -1) throw new Error(`${what} not found ("${lead}")`);
  const close = text.indexOf(")", at + lead.length);
  if (close === -1) throw new Error(`${what}: no closing parenthesis after "${lead}"`);
  return [...text.slice(at + lead.length, close).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/**
 * A Rust file's production code: comments blanked (literals kept, offsets
 * preserved) and everything from the first `#[cfg(test)]` on dropped — the
 * repo's convention puts the test module last, so what precedes it is what
 * ships. A stray `#[cfg(test)]` earlier only drops code, which a claim then
 * reports as missing: it can fail spuriously, never pass on a mention.
 */
function productionRust(source) {
  const code = rustCode(source, { keepStrings: true });
  const test = code.search(/#\[cfg\(test\)\]/);
  return test === -1 ? code : code.slice(0, test);
}

/**
 * The bodies of the named production `fn`s in a Rust file, comments blanked
 * and literals kept, joined. Braces are matched in a copy with literals
 * blanked too (offsets are preserved), so a `{` inside a string cannot end a
 * body early. Throws naming any fn that is not there: a renamed builder must
 * be a finding, not an empty list.
 */
export function rustFnBodies(source, names) {
  const kept = productionRust(source);
  const bare = rustCode(kept);
  return names.map((name) => {
    const m = new RegExp(`\\bfn ${name}\\b[^{;]*\\{`).exec(bare);
    if (!m) throw new Error(`fn ${name} not found`);
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < bare.length; i += 1) {
      if (bare[i] === "{") depth += 1;
      else if (bare[i] === "}" && --depth === 0) return kept.slice(m.index, i + 1);
    }
    throw new Error(`fn ${name} has no closing brace`);
  }).join("\n");
}

/**
 * The production `fn`s of a Rust file that `root` reaches through calls to
 * other fns of the same file, `root` included. A call is the fn's name
 * followed by `(` in code (comments and literals blanked), so a fn that is
 * only mentioned in a string or a comment is not reached.
 */
export function rustReachableFns(source, root) {
  const bare = rustCode(productionRust(source));
  const names = new Set([...bare.matchAll(/\bfn (\w+)\b/g)].map((m) => m[1]));
  const reached = new Set();
  const queue = [root];
  while (queue.length > 0) {
    const name = queue.shift();
    if (reached.has(name)) continue;
    reached.add(name);
    const body = rustCode(rustFnBodies(source, [name]));
    for (const callee of names) {
      if (!reached.has(callee) && new RegExp(`(?<!\\bfn )\\b${callee}\\s*\\(`).test(body)) queue.push(callee);
    }
  }
  return reached;
}

/** `a` and `b` as sorted lists, with what each lacks. */
export function setDiff(a, b, aName, bName) {
  const out = [];
  for (const x of a) if (!b.includes(x)) out.push(`${aName} has \`${x}\`, ${bName} does not`);
  for (const x of b) if (!a.includes(x)) out.push(`${bName} has \`${x}\`, ${aName} does not`);
  return out;
}

export const equal = (doc, code, what) => (String(doc) === String(code) ? [] : [`${what}: the guide says ${doc}, the code says ${code}`]);

/** `Shift-F4` → `Shift + F4`, the guide's display form. */
export const displayChord = (key) => key.split("-").join(" + ");

/** The rows of the first table under `heading` whose first header cell reads `firstHeader`. */
export function tableUnder(markdown, heading, firstHeader) {
  const table = parseTables(markdown).find((t) => t.heading === heading && stripMarkdown(t.headers[0] ?? "") === firstHeader);
  if (!table) throw new Error(`no "${firstHeader}" table under "${heading}"`);
  return table.rows.map((r) => r.cells);
}
