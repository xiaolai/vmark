#!/usr/bin/env node
/**
 * Hooks-tier purity gate (WI-10, B1).
 *
 * ADR-013: `src/hooks/` is the React-adapter tier over `src/services/`. The
 * 20260722 tier restoration and the WI-10 migration moved every non-React
 * business module out (74 files, 8.4k lines had accumulated); this gate makes
 * the regression class structural instead of review-dependent.
 *
 * MECHANISM CHOICE (decided + documented per the WI): dependency-cruiser's
 * `required` rule can only assert "module imports react", which would force
 * permanently freezing the legitimate hook COMPOSITES (files like
 * `lifecycle/useDocumentLifecycle.ts` that compose other hooks without a
 * direct react import) as named violations that can never ratchet down. This
 * script encodes the real invariant instead — every non-test file under
 * src/hooks/ must show React-adapter evidence:
 *   1. imports react (`react`, `react-dom`, `react/jsx-runtime`), OR
 *   2. CALLS a hook (`useX(...)` — includes zustand selector calls, which are
 *      hooks and only legal in React), OR
 *   3. re-exports a hook (`export { useX } from …` — composite barrels).
 * `useXStore.getState()` deliberately does NOT count: that is the imperative
 * store API, exactly what a misfiled business module uses.
 *
 * DETECTION IS A REAL TypeScript PARSE, not a regex over text. The regex
 * version admitted three false-PASS classes, each of which is precisely what a
 * misfiled business module looks like:
 *   - the react-import test ran against RAW source (deliberately, so string
 *     specifiers stayed visible), so `// import { useEffect } from "react"` in
 *     a comment was accepted as evidence;
 *   - strings were never stripped, so a doc snippet containing `useState(`
 *     counted as a hook call;
 *   - `\buse[A-Z]\w*\s*\(` cannot tell a CALL from a DECLARATION, so
 *     `export function useBusiness()` vouched for itself.
 * On the AST, evidence is an ImportDeclaration/require/dynamic-import of a
 * react module, a CallExpression whose callee is a hook-named identifier, or an
 * export clause naming a hook. A file that does not parse is an offender —
 * unverifiable is not the same as clean (fail closed).
 * (Same mechanism choice as scripts/check-mock-boundaries.mjs.)
 *
 * Zero baseline: the migration left no stragglers. If a legitimate new shape
 * appears, extend the evidence rules here with a stated reason — do not add a
 * baseline file for business modules; those belong in src/services/<domain>/.
 *
 * Usage: node scripts/check-hooks-react-purity.mjs [--root <dir>]
 * (--root exists for the gate-sensitivity meta-test's fixture trees.)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const SOURCE_EXT = /\.(ts|tsx)$/;
/** `useFoo` — the React hook naming convention the linter itself enforces. */
const HOOK_NAME = /^use[A-Z]/;

/** Test-adjacent files are out of scope (they exercise hooks, they are not hooks). */
export function isTestAdjacent(rel) {
  const base = rel.split("/").pop() ?? "";
  if (base.includes(".test.") || base.includes(".spec.")) return true;
  if (base.endsWith(".d.ts")) return true;
  return rel.includes("/__tests__/") || rel.includes("/__mocks__/");
}

/** `react`, `react-dom`, and any subpath of either (`react/jsx-runtime`, …). */
export function isReactModule(spec) {
  return (
    spec === "react" ||
    spec === "react-dom" ||
    spec.startsWith("react/") ||
    spec.startsWith("react-dom/")
  );
}

function scriptKindFor(rel) {
  return rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * Does this source show React-adapter evidence? (See header for the rules.)
 * Throws when the file does not parse — the caller records that as an offender
 * rather than silently treating "unverifiable" as "clean".
 */
export function isReactAdapter(src, rel = "file.ts") {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, false, scriptKindFor(rel));
  const parseErrors = sf.parseDiagnostics ?? [];
  if (parseErrors.length > 0) {
    throw new Error(ts.flattenDiagnosticMessageText(parseErrors[0].messageText, " "));
  }

  let found = false;
  const visit = (node) => {
    if (found) return;

    // 1. Imports react. A module specifier is a string literal in the AST, so
    //    the same node type covers `import …`, `export … from`, `require()`
    //    and `import()` — and a specifier inside a comment or a plain string
    //    is not one of these nodes at all.
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      isReactModule(node.moduleSpecifier.text)
    ) {
      found = true;
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const arg = node.moduleReference.expression;
      if (ts.isStringLiteralLike(arg) && isReactModule(arg.text)) {
        found = true;
        return;
      }
    }
    if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const arg = node.arguments[0];
      if ((isRequire || isDynamicImport) && arg && ts.isStringLiteralLike(arg) && isReactModule(arg.text)) {
        found = true;
        return;
      }
      // 2. CALLS a hook — a CallExpression with a hook-named IDENTIFIER callee.
      //    A declaration (`function useBusiness() {}`) is not a CallExpression,
      //    and `useXStore.getState()` is a property access, not this shape.
      if (ts.isIdentifier(node.expression) && HOOK_NAME.test(node.expression.text)) {
        found = true;
        return;
      }
    }

    // 3. Re-exports a hook (composite barrels).
    if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          if (HOOK_NAME.test(el.name.text) || (el.propertyName && HOOK_NAME.test(el.propertyName.text))) {
            found = true;
            return;
          }
        }
      }
      if (clause && ts.isNamespaceExport(clause) && HOOK_NAME.test(clause.name.text)) {
        found = true;
        return;
      }
      // `export * from "./useX"` — the barrel names the hook in its path.
      if (!clause && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const base = node.moduleSpecifier.text.split("/").pop() ?? "";
        if (HOOK_NAME.test(base)) {
          found = true;
          return;
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function walk(dir, rootLen, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, rootLen, out);
    else if (SOURCE_EXT.test(entry.name)) {
      out.push(full.slice(rootLen).split(path.sep).join("/"));
    }
  }
  return out;
}

/** Scan <root>/src/hooks and return the offending repo-relative paths. */
export function scanHooksTier(root) {
  const hooksDir = path.join(root, "src", "hooks");
  if (!existsSync(hooksDir)) return [];
  const offenders = [];
  for (const rel of walk(hooksDir, root.length + 1, [])) {
    if (isTestAdjacent(rel)) continue;
    try {
      if (!isReactAdapter(readFileSync(path.join(root, rel), "utf8"), rel)) offenders.push(rel);
    } catch (error) {
      // Fail closed: a file the gate cannot parse is not a file it has cleared.
      offenders.push(`${rel} (does not parse: ${error.message})`);
    }
  }
  return offenders.sort();
}

function main() {
  const argv = process.argv.slice(2);
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = path.resolve(argv[++i]);
    else {
      console.error(`❌ Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }

  const offenders = scanHooksTier(root);
  if (offenders.length === 0) {
    console.log("✅ Hooks-tier purity held (every non-test file in src/hooks/ is a React adapter).");
    return;
  }
  console.error(`\n❌ ${offenders.length} non-React business module(s) in src/hooks/:\n`);
  for (const f of offenders) console.error(`   ${f}`);
  console.error(
    "\n   src/hooks/ is the React-adapter tier (ADR-013). A file with no react\n" +
      "   import, no hook call, and no hook re-export is a business module —\n" +
      "   move it to src/services/<domain>/ (see the WI-10 migration pattern).\n",
  );
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
