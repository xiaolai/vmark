/**
 * Header-reference comment scanning and tag grammar — the reading
 * half of `scripts/lib/headerReferences.mjs`.
 *
 * Purpose: find the comment lines of a source file and the three reference
 * tags they can carry (`@coordinates-with <target>`, `@module <self-path>`,
 * `Plan: <file>`). It decides nothing about whether a reference resolves; that
 * is `headerReferences.mjs` and `headerReferenceTargets.mjs`.
 *
 * Key decisions:
 *   - Comment scanning is BLOCK-AWARE: a `*`-prefixed line counts only inside
 *     a block comment whose opening `/*` starts a line — and it runs over the
 *     source with every LITERAL blanked first (`literalsBlanked`): TypeScript
 *     and JavaScript through the TypeScript parser (strings, template heads /
 *     middles / tails, regexes, JSX text), Rust through `rustSource.mjs`. So a
 *     header quoted inside a test's template literal is never read as the
 *     test's own header, however its lines start, and a `@generated` quoted in
 *     one cannot skip the file that quotes it (with the
 *     line model alone, a `/*` that opened a line inside a template literal was
 *     a comment, and a `@generated` there within the first 20 lines skipped
 *     every real header in the file). A hand-rolled backtick tokenizer was
 *     rejected for the reason the parser is right: a stray backtick flips its
 *     parity and every header after it goes silently unread. The parser is
 *     invoked only for a source that contains a backtick — a single-line
 *     literal cannot put `/*` or `//` at the start of a line, so the files
 *     that need it are the ones that can hold a multi-line literal.
 *   - A file is GENERATED (skipped) only when a comment line in its first 20
 *     lines starts with `@generated` — not the word in a string, a template
 *     literal or prose.
 *
 * @coordinates-with scripts/lib/headerReferences.mjs — resolves and compares what this reads
 * @coordinates-with scripts/lib/rustSource.mjs — blanks Rust literals before the comment scan
 * @coordinates-with scripts/check-header-references.test.mjs — drives every grammar here
 * @module scripts/lib/headerComments
 */
import ts from "typescript";

import { rustCode } from "./rustSource.mjs";

export const KINDS = ["coordinates-with", "module-self", "plan"];
const TAGS = [
  { kind: "coordinates-with", re: /^\s*@coordinates-with\s+(\S.*)$/ },
  { kind: "module-self", re: /^\s*@module\s+(\S.*)$/ },
  { kind: "plan", re: /^\s*Plan:\s*(\S.*)$/ },
];

const LITERAL_KINDS = [
  ts.isStringLiteral,
  ts.isNoSubstitutionTemplateLiteral,
  ts.isTemplateHead,
  ts.isTemplateMiddle,
  ts.isTemplateTail,
  ts.isRegularExpressionLiteral,
  ts.isJsxText,
];

/**
 * `source` with every literal's characters blanked to spaces, newlines kept,
 * so the line model below sees only what the language reads as comments.
 * `file` picks the tokenizer: Rust through `rustCode`, anything else through
 * the TypeScript parser — skipped when the source holds no backtick, since
 * only a template literal can span lines in TS/JS (see the header).
 */
function literalsBlanked(source, file) {
  if (file.endsWith(".rs")) return rustCode(source, { keepComments: true });
  // Shell has no multi-line literal that a `#` comment scan can misread, and
  // no tokenizer here; the line model below reads it directly.
  if (file.endsWith(".sh")) return source;
  // Parse whenever the source can hold a literal that SPANS LINES — the only
  // way literal text can put `//` or `/*` at the start of one. A backtick is
  // not the only such literal: JSX TEXT spans lines with no backtick at all,
  // and so does a backslash line continuation inside a quoted string, so a
  // `@generated`-shaped line in either used to skip the whole file.
  if (!source.includes("`") && !/\\\r?\n/.test(source) && !/\.[jt]sx$/.test(file)) return source;
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : /\.(m?js|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind);
  // UTF-16 CODE UNITS, not code points: TypeScript AST offsets are UTF-16, so
  // `[...source]` misaligned every blanking range after the first astral
  // character — an emoji or a rare CJK glyph — and could expose literal text
  // as a comment.
  const chars = source.split("");
  const visit = (node) => {
    if (LITERAL_KINDS.some((is) => is(node))) {
      for (let i = node.getStart(sf); i < node.end; i++) if (chars[i] !== "\n") chars[i] = " ";
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return chars.join("");
}

/** Net block-comment depth change over one line: `/*` opens, `*​/` closes, each consumed once. */
function blockDelta(text) {
  let delta = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "/" && text[i + 1] === "*") {
      delta += 1;
      i++;
    } else if (text[i] === "*" && text[i + 1] === "/") {
      delta -= 1;
      i++;
    }
  }
  return delta;
}

/**
 * Comment-shaped lines with their comment markers stripped (see header).
 * With a `file`, literals are blanked first so a quoted comment is not one.
 *
 * RUST BLOCK COMMENTS NEST, and TypeScript's do not — so Rust is tracked by
 * DEPTH and everything else by the first `*​/`. A boolean for both left the
 * scan reading the tail of an outer Rust comment as code after an inner one
 * closed, and every reference in it went unchecked. Measured
 * over every `.rs` file in this tree on adoption: the two models select the
 * identical line set, so this is correct-for-the-grammar rather than a fix for
 * a live miss.
 */
export function commentLines(source, file = "") {
  const out = [];
  let depth = 0;
  const shell = file.endsWith(".sh");
  const nests = file.endsWith(".rs");
  const lines = (file ? literalsBlanked(source, file) : source).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();
    if (shell) {
      // `#` is shell's only comment marker; there is no block form.
      if (t.startsWith("#")) out.push({ line: i + 1, text: t.replace(/^#+!?/, "") });
      continue;
    }
    if (depth > 0) {
      const close = t.indexOf("*/");
      out.push({ line: i + 1, text: (close >= 0 ? t.slice(0, close) : t).replace(/^\*+/, "") });
      depth = nests ? Math.max(0, depth + blockDelta(t)) : close >= 0 ? 0 : depth;
    } else if (t.startsWith("/*")) {
      const close = t.indexOf("*/", 2);
      out.push({ line: i + 1, text: (close >= 0 ? t.slice(2, close) : t.slice(2)).replace(/^\*+/, "") });
      depth = nests ? Math.max(0, blockDelta(t)) : close < 0 ? 1 : 0;
    } else if (t.startsWith("//")) {
      out.push({ line: i + 1, text: t.replace(/^\/\/[!/]?/, "") });
    }
  }
  return out;
}

/**
 * The target token of a tag: the first whitespace-delimited word, minus a
 * leading parenthesised qualifier (`(future) src-tauri …`), an attached
 * em-dash description, code-span or quote wrapping, and trailing punctuation.
 *
 * Stripped to a FIXED POINT, not in one pass. A single pass ran wrapper removal
 * before punctuation removal, so a combined form — `"foo.rs",` in a prose list,
 * or `` `foo.ts`. `` at the end of a sentence — kept its closing quote or
 * backtick and could never resolve: the reference was reported unresolved and
 * the wrong remedy suggested. Looping terminates because every
 * iteration either removes a character or changes nothing.
 */
export function firstTarget(rest) {
  const tokens = rest.trim().split(/\s+/);
  if (tokens.length > 1 && /^\(.*\)$/.test(tokens[0])) tokens.shift();
  let target = tokens[0].split("—")[0];
  for (let prev; prev !== target; ) {
    prev = target;
    target = target
      .replace(/^[`"']+/, "")
      .replace(/[`"']+$/, "")
      .replace(/[,;:.)]+$/, "");
  }
  return target;
}

/** Every reference a file's comments carry: `{ kind, target, line, file }`. */
export function extractReferences(source, filePath) {
  const refs = [];
  for (const { line, text } of commentLines(source, filePath)) {
    for (const { kind, re } of TAGS) {
      const m = re.exec(text);
      if (!m) continue;
      const target = firstTarget(m[1]);
      if (target) refs.push({ kind, target, line, file: filePath });
      break;
    }
  }
  return refs;
}

/** A `@generated` directive on a comment line within the first 20 lines — the word in a string, a template literal or prose is not one. */
export const isGenerated = (source, file) => commentLines(source, file).some(({ line, text }) => line <= 20 && /^\s*@generated\b/.test(text));
