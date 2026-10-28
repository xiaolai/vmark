/**
 * Purpose: the TypeScript / JavaScript probes behind `scripts/dod-syntax.mjs` —
 *   a source reduced to its CODE (literals and comments blanked through the
 *   compiler's parser), and the count of runnable test cases a file declares.
 *
 * @coordinates-with scripts/dod-syntax.mjs — the CLI these answer for
 * @coordinates-with scripts/lib/dodSyntaxRegister.mjs — the registration forms a case is read through
 * @coordinates-with scripts/lib/dodSyntaxJourney.mjs — the journey-shape probe over the same parse
 * @module scripts/lib/dodSyntaxTs
 */
import ts from "typescript";
import { testRoots } from "./dodSyntaxRegister.mjs";

export { testRoots } from "./dodSyntaxRegister.mjs";

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
 * menu id, a settings key. It keeps the literals and blanks only the comments
 * — found on the literal-blanked text, so a `//` or `/*` INSIDE a kept
 * literal (`"http://host"`) is not read as a comment, then blanked in the
 * original.
 */
export function tsCode(sf, source, { keepStrings = false } = {}) {
  const chars = source.split("");
  const visit = (node) => {
    if (TS_LITERAL_KINDS.some((is) => is(node))) {
      for (let i = node.getStart(sf); i < node.end; i++) if (chars[i] !== "\n") chars[i] = " ";
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const bare = chars.join("");
  const out = (keepStrings ? source : bare).split("");
  for (const m of bare.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)) {
    for (let i = m.index; i < m.index + m[0].length; i++) if (out[i] !== "\n") out[i] = " ";
  }
  return out.join("");
}

/**
 * Cases the file REGISTERS through the supported forms (dodSyntaxRegister.mjs):
 * `it("…", fn)` / `test("…", fn)` calls whose first argument is a title (so
 * `it.each([...])` — whose first argument is the table — counts once, through
 * the call it returns) and which carry a handler, minus `.skip`/`.todo` cases
 * and every case under a `describe.skip`/`.todo` suite. Comments, strings,
 * template literals and forms outside the grammar register none.
 *
 * With `titleIncludes`, only cases whose title CONTAINS that text count — what
 * a DoD assertion means by "this named test exists", where a grep for the
 * title also matched an `it.skip` and a title in a comment.
 */
export function declaredTestCases(sf, { titleIncludes } = {}) {
  return testRoots(sf, { titleIncludes }).cases.length;
}
