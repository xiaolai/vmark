/**
 * Balanced end of an array literal in TS or Rust source text.
 *
 * `arrayLiteralEnd(src, open, { lang })` is the index of the `]` that closes
 * the array opened at `open`, so a `]` — or a `];` — inside a comment, a
 * string or any other literal cannot end the array early; nested arrays are
 * balanced. Returns -1 when the array is unterminated, or when the source does
 * not parse, so a caller fails closed rather than parsing a fragment.
 *
 * Extracted for scripts/check-keybinding-manifest.mjs, whose `arrayBody` used
 * to stop at the first textual `];`: a comment inside DEFAULT_SHORTCUTS that
 * mentioned `];` would have truncated the parse, and every definition after it
 * would have left the drift check silently — braces still balanced, entry
 * count still consistent, nothing to fail on.
 *
 * ONE HAND-ROLLED LEXER CANNOT SERVE BOTH LANGUAGES, which is why `lang` is a
 * parameter rather than a heuristic (audit R2 #136/#138/#139/#140). The
 * previous single loop was wrong for each language in a different way: TS
 * regex literals (`/[a]/`) and templates nested inside `${…}` moved the depth
 * count, while Rust block comments NEST and Rust raw strings (`r#"a"b"#`) hold
 * unescaped quotes — so the search for the first block-comment terminator, and
 * the ordinary-string loop, both ended early and exposed a bracket that was
 * still inside a comment or a literal. Each language now goes through the
 * tokenizer that already knows it:
 *
 *   - `lang: "ts"` — the TypeScript parser. The array's own node carries its
 *     end, so every literal form the language has (regex, nested template,
 *     JSX, numeric separators) is handled by definition rather than by a
 *     pattern this file would have to keep up with. A source with parse
 *     diagnostics returns -1: a recovered fragment is not a balanced array.
 *   - `lang: "rust"` — `rustSource.mjs`'s `rustCode`, which blanks nested
 *     block comments and every literal form (raw, byte, char) while preserving
 *     offsets, leaving only code for the bracket count to walk.
 *
 * @coordinates-with scripts/check-keybinding-manifest.mjs — the consumer
 * @coordinates-with scripts/lib/rustSource.mjs — the Rust comment/literal lexer
 * @module scripts/lib/arrayLiteralEnd
 */

import ts from "typescript";

import { rustCode } from "./rustSource.mjs";

/** Bracket balance over Rust CODE — comments (nested) and literals already blanked. */
function rustArrayEnd(src, open) {
  const code = rustCode(src);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "[") depth++;
    else if (code[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

/** The `]` of the ArrayLiteralExpression the TypeScript parser starts at `open`. */
function tsArrayEnd(src, open) {
  const sf = ts.createSourceFile("array.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // Error recovery invents a node that runs to end-of-file, so `[1, 2` would
  // otherwise report a "closing" bracket that is not one.
  if (sf.parseDiagnostics.length > 0) return -1;
  let end = -1;
  const visit = (node) => {
    if (end !== -1) return;
    if (ts.isArrayLiteralExpression(node) && node.getStart(sf) === open) {
      end = node.end;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (end <= open || src[end - 1] !== "]") return -1;
  return end - 1;
}

export function arrayLiteralEnd(src, open, { lang = "ts" } = {}) {
  if (src[open] !== "[") throw new Error(`arrayLiteralEnd: src[${open}] is ${JSON.stringify(src[open])}, not "["`);
  if (lang !== "ts" && lang !== "rust") throw new Error(`arrayLiteralEnd: unknown lang ${JSON.stringify(lang)}`);
  return lang === "rust" ? rustArrayEnd(src, open) : tsArrayEnd(src, open);
}
