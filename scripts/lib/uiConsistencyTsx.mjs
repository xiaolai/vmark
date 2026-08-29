/**
 * WI-UI0.3 — TSX-side checks of the ui-consistency gate: C7 (icon sizes) and
 * C10 (focus visibility). A real TS AST walk — the `size={1}` on
 * `@xyflow/react`'s `<Background>` is why imports are resolved rather than
 * grepping the prop, and check-command-error-ratchet's history is why no
 * hand-rolled lexer is trusted here.
 *
 * @coordinates-with scripts/check-ui-consistency.mjs — the CLI
 * @coordinates-with scripts/lib/uiConsistencyCss.mjs — provides the
 *   class→focus-paint map C10 joins against
 */
import ts from "typescript";

const LUCIDE_SIZES = new Set([12, 14, 16, 18]);
const LUCIDE_TAILWIND_W = new Set(["3", "3.5", "4", "4.5"]);

function moduleConstNumbers(sf) {
  const out = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer && ts.isNumericLiteral(decl.initializer)) {
        out.set(decl.name.text, Number(decl.initializer.text));
      }
    }
  }
  return out;
}

function moduleConstStrings(sf) {
  const out = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer && ts.isStringLiteralLike(decl.initializer)) {
        out.set(decl.name.text, decl.initializer.text);
      }
    }
  }
  return out;
}

function lucideImports(sf) {
  const names = new Set();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier) || stmt.moduleSpecifier.text !== "lucide-react") continue;
    const clause = stmt.importClause;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) names.add(el.name.text);
    }
  }
  return names;
}

/** All string fragments under a node (literals + template text + const refs). */
function stringFragments(node, consts, out) {
  if (ts.isStringLiteralLike(node)) out.push(node.text);
  else if (ts.isIdentifier(node) && consts.has(node.text)) out.push(consts.get(node.text));
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) {
      stringFragments(span.expression, consts, out);
      out.push(span.literal.text);
    }
  } else {
    ts.forEachChild(node, (child) => stringFragments(child, consts, out));
  }
}

function attrOf(node, name) {
  const attrs = ts.isJsxSelfClosingElement(node) ? node.attributes : node.openingElement?.attributes;
  if (!attrs) return undefined;
  return attrs.properties.find(
    (p) => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === name,
  );
}

/** Whether a `ui-ok(<check>)` JSX marker sits within the 5 lines above the
 *  element (markers are multi-line comments, so "the line above" is often the
 *  comment's CLOSING line, not the marker line). */
function uiOkAbove(sf, node, check) {
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const lines = sf.text.split("\n");
  const above = lines.slice(Math.max(0, line - 5), line + 1).join("\n");
  const m = new RegExp(`ui-ok\\(${check}\\)\\s*:\\s*(\\S[^*}]*)`).exec(above);
  return m ? m[1].trim().length > 0 : false;
}

/**
 * C7 — lucide `size=` off the {12,14,16,18} set; lucide `w-*` classes off
 * {3,3.5,4,4.5}. Non-lucide components with a `size` prop are ignored.
 */
export function checkIconSizes(source, file) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lucide = lucideImports(sf);
  if (lucide.size === 0) return { findings: [], usesLucideSize: false };
  const consts = moduleConstNumbers(sf);
  const strConsts = moduleConstStrings(sf);
  const findings = [];
  let usesLucideSize = false;

  const visit = (node) => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) &&
      (() => {
        const tag = ts.isJsxSelfClosingElement(node) ? node.tagName : node.openingElement.tagName;
        return ts.isIdentifier(tag) && lucide.has(tag.text);
      })()
    ) {
      const tag = ts.isJsxSelfClosingElement(node) ? node.tagName : node.openingElement.tagName;
      const sizeAttr = attrOf(node, "size");
      if (sizeAttr?.initializer) {
        usesLucideSize = true;
        let n = null;
        const init = sizeAttr.initializer;
        if (ts.isJsxExpression(init) && init.expression) {
          if (ts.isNumericLiteral(init.expression)) n = Number(init.expression.text);
          else if (ts.isIdentifier(init.expression) && consts.has(init.expression.text)) {
            n = consts.get(init.expression.text);
          }
        } else if (ts.isStringLiteral(init)) n = Number(init.text);
        if (n !== null && !LUCIDE_SIZES.has(n) && !uiOkAbove(sf, node, "icon")) {
          findings.push({
            check: "C7",
            id: `${file} ${tag.text}@${n}`,
            message: `${file}: <${tag.text} size={${n}}> — lucide glyph sizes are 12, 14, 16 or 18 (D12), or ui-ok(icon): <reason>.`,
          });
        }
      }
      const cnAttr = attrOf(node, "className");
      if (cnAttr?.initializer) {
        const fragments = [];
        stringFragments(cnAttr.initializer, strConsts, fragments);
        for (const m of fragments.join(" ").matchAll(/\bw-(\d+(?:\.\d+)?)\b/g)) {
          if (!LUCIDE_TAILWIND_W.has(m[1]) && !uiOkAbove(sf, node, "icon")) {
            findings.push({
              check: "C7",
              id: `${file} w-${m[1]}`,
              message: `${file}: lucide icon sized w-${m[1]} — icon widths are w-3/w-3.5/w-4/w-4.5 (12–18px, D12).`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { findings, usesLucideSize };
}

const FOCUSABLE_TAGS = new Set(["button", "select", "textarea", "input"]);

/**
 * C10 — focusable JSX elements and the classes they carry, for the CLI to
 * join against the CSS focus-paint map. An element is returned as COVERED
 * when its className carries a Tailwind `focus-visible:` class or a
 * `ui-ok(focus)` marker sits on the line above.
 */
export function collectFocusables(source, file) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const strConsts = moduleConstStrings(sf);
  const out = [];

  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) {
      const tagNode = ts.isJsxSelfClosingElement(node) ? node.tagName : node.openingElement.tagName;
      if (ts.isIdentifier(tagNode)) {
        const tag = tagNode.text;
        const isAnchor = tag === "a" && attrOf(node, "href") !== undefined;
        const hasTabIndex = (() => {
          const a = attrOf(node, "tabIndex");
          if (!a?.initializer || !ts.isJsxExpression(a.initializer) || !a.initializer.expression) return false;
          return ts.isNumericLiteral(a.initializer.expression) && a.initializer.expression.text === "0";
        })();
        if (FOCUSABLE_TAGS.has(tag) || isAnchor || hasTabIndex) {
          const typeAttr = attrOf(node, "type");
          const isHidden =
            tag === "input" &&
            typeAttr?.initializer &&
            ts.isStringLiteral(typeAttr.initializer) &&
            typeAttr.initializer.text === "hidden";
          if (!isHidden) {
            const cnAttr = attrOf(node, "className");
            const fragments = [];
            if (cnAttr?.initializer) stringFragments(cnAttr.initializer, strConsts, fragments);
            const classes = fragments.join(" ").split(/\s+/).filter(Boolean);
            const tailwindFocus = classes.some((c) => c.startsWith("focus-visible:") || c.startsWith("focus:"));
            const covered = tailwindFocus || uiOkAbove(sf, node, "focus");
            const dynamicClassName =
              cnAttr?.initializer !== undefined &&
              fragments.length === 0; // an expression the resolver cannot read — fail open into the findings
            out.push({
              file,
              tag,
              classes,
              covered,
              dynamicClassName,
              id: `${file} <${tag}>.${classes.find((c) => !c.includes(":")) ?? "(no-class)"}`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
