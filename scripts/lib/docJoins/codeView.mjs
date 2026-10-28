/**
 * Purpose: a TypeScript/JavaScript or Rust source file seen as CODE, for the
 *   guide claims that read a declaration out of it — so a commented-out copy
 *   of a declaration, or one quoted inside a string, can never stand in for
 *   the real one.
 *
 * `codeView(source, file)` returns, all with `source`'s offsets and newlines:
 *   - `text`: comments blanked to spaces, literals kept (a declaration's value
 *     is often a literal);
 *   - `bare`: comments AND literals blanked, for finding where code is and
 *     matching brackets;
 *   - `literals`: the `{ start, end }` span of every string, template piece,
 *     regex, char and JSX-text literal, in source order.
 * TypeScript/JavaScript is read by the TypeScript parser; Rust by `rustSpans`
 * (nested block comments, raw strings, char literals vs lifetimes). Comment
 * spans come from `comments`, the one comment reader in `scripts/lib/`.
 *
 * @coordinates-with scripts/lib/docJoins/guideClaimsHelpers.mjs — captureCode, arrayStrings and delimitedBody read views
 * @coordinates-with scripts/lib/sourceComments.mjs — the comment spans
 * @coordinates-with scripts/lib/rustSource.mjs — the Rust literal spans
 * @module scripts/lib/docJoins/codeView
 */
import ts from "typescript";

import { rustSpans } from "../rustSource.mjs";
import { comments } from "../sourceComments.mjs";

const TS_LITERALS = [
  ts.isStringLiteral, ts.isNoSubstitutionTemplateLiteral, ts.isTemplateHead, ts.isTemplateMiddle, ts.isTemplateTail,
  ts.isRegularExpressionLiteral, ts.isJsxText,
];

/** The literal spans of a TypeScript/JavaScript `source`. */
function tsLiteralSpans(source, file) {
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : /\.(m?js|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind);
  const spans = [];
  const visit = (node) => {
    if (TS_LITERALS.some((is) => is(node))) spans.push({ start: node.getStart(sf), end: node.end });
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  return spans;
}

/** `text` with each of `spans` blanked to spaces, newlines kept. */
function blanked(text, spans) {
  const chars = text.split("");
  for (const { start, end } of spans) for (let i = start; i < end; i++) if (chars[i] !== "\n") chars[i] = " ";
  return chars.join("");
}

/** `source` (the text of `file`, a .rs or a TS/JS file) as `{ text, bare, literals }`. */
export function codeView(source, file) {
  const literals = file.endsWith(".rs")
    ? [...rustSpans(source)].filter((s) => s.kind !== "comment").map(({ start, end }) => ({ start, end }))
    : tsLiteralSpans(source, file);
  const text = blanked(source, comments(source, file));
  return { text, bare: blanked(text, literals), literals };
}

/** True when `offset` lies inside one of `view`'s literals. */
export const inLiteral = (view, offset) => view.literals.some((l) => offset >= l.start && offset < l.end);
