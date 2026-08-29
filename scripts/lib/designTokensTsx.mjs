/**
 * WI-UI0.2 — C2g: colour/size/z literals inside `className` strings.
 *
 * The CSS gates cannot see a defect written in JSX, which is where the
 * Tailwind surfaces (Settings, PDF sidebar, tab strip) write theirs. This
 * walks the TS AST — three rounds of hand-rolled lexing in
 * check-command-error-ratchet shipped false negatives, so no regex over raw
 * source — and collects every string fragment inside a `className` attribute's
 * initializer subtree (literals, template chunks, conditional branches,
 * `cn(…)` arguments alike).
 *
 * Flags, per dev-docs/plans/20260829-ui-consistency.md C2g:
 *   - hex colours (`bg-[#fff]`)
 *   - Tailwind PALETTE colour classes (`ring-gray-400`, `bg-black/50`) — these
 *     bypass the token system entirely, so no theme can retint them
 *   - arbitrary pixel type (`text-[10px]`) — off the chrome type scale
 *   - z-index literals (`z-50`, `z-[1000]`) — off the z stack
 *
 * Identity is `file token`, stable across unrelated edits.
 *
 * @coordinates-with scripts/check-design-tokens.mjs — the CLI
 */
import ts from "typescript";

const PALETTE_NAMES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PALETTE_PREFIX =
  "bg|text|border|ring|ring-offset|from|via|to|fill|stroke|divide|outline|shadow|accent|caret|decoration|placeholder";

const CHECKS = [
  { kind: "hex", re: new RegExp(String.raw`#[0-9a-fA-F]{3,8}\b`, "g") },
  {
    kind: "palette",
    re: new RegExp(
      String.raw`\b(?:${PALETTE_PREFIX})-(?:(?:${PALETTE_NAMES})-\d{2,3}|black|white)(?:\/\d{1,3})?\b`,
      "g",
    ),
  },
  { kind: "px", re: /\btext-\[\d+(?:\.\d+)?px\]/g },
  { kind: "z", re: /\bz-(?:\d+|\[\d+\])\b/g },
];

/** Every string fragment under a node (literals + template text). */
function stringFragments(node, out) {
  if (ts.isStringLiteralLike(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) {
      stringFragments(span.expression, out);
      out.push(span.literal.text);
    }
  } else {
    ts.forEachChild(node, (child) => stringFragments(child, out));
  }
}

/**
 * Scan one file's source for C2g findings.
 * @returns {{ id: string, file: string, token: string, kind: string }[]}
 */
export function findClassNameLiterals(source, file) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tokens = new Map(); // token -> kind

  const visit = (node) => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "className" &&
      node.initializer
    ) {
      const fragments = [];
      stringFragments(node.initializer, fragments);
      const text = fragments.join(" ");
      for (const { kind, re } of CHECKS) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) {
          // `z-[var(--z-popup)]`-style arbitrary VAR values are on-vocabulary;
          // the z regex cannot match them (no digits), and hex inside var() is
          // still a literal. Nothing to exempt structurally.
          tokens.set(m[0], kind);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return [...tokens.entries()].map(([token, kind]) => ({
    id: `${file} ${token}`,
    file,
    token,
    kind,
  }));
}
