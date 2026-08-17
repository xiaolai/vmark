// @vitest-environment node
/**
 * Every translation key must exist in the namespace it is looked up through.
 *
 * `PdfExportDialog.tsx` holds TWO translation functions — `t` for the "export"
 * bundle and `tDialog` for "dialog" — and nothing checks that a key is asked of
 * the right one. i18next returns THE KEY ITSELF on a miss, so a mismatch is
 * silent: `tDialog("pdf.pageNumbers.verboseTemplate")` returned the literal
 * string `"pdf.pageNumbers.verboseTemplate"`, which is pure ASCII, so the PDF
 * stamper happily accepted it and printed it on every page.
 *
 * Typecheck cannot see this (both functions are `(key: string) => string`) and
 * `lint:i18n` cannot either — it verifies that keys exist across locales, not
 * that a call site asks the right bundle.
 *
 * Scoped to the export windows: they are the files that carry more than one
 * namespace, which is the precondition for the mistake.
 *
 * @module export/__tests__/exportDialogNamespaces
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
const LOCALES = path.resolve(__dirname, "../../locales/en");

/** Files that bind more than one `useTranslation` namespace. */
function multiNamespaceFiles(): string[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .filter((f) => {
      const src = readFileSync(path.join(SRC, f), "utf8");
      return (src.match(/useTranslation\(/g) ?? []).length >= 2;
    });
}

/** Map each translation function's local name to the namespace it was bound to. */
function bindings(src: string): Map<string, string> {
  const out = new Map<string, string>();
  // `const { t } = useTranslation("export")`
  for (const m of src.matchAll(/const\s*\{\s*t\s*\}\s*=\s*useTranslation\("([^"]+)"\)/g)) {
    out.set("t", m[1]!);
  }
  // `const { t: tDialog } = useTranslation("dialog")`
  for (const m of src.matchAll(
    /const\s*\{\s*t:\s*(\w+)\s*\}\s*=\s*useTranslation\("([^"]+)"\)/g,
  )) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

function keysOf(namespace: string): Set<string> {
  const file = path.join(LOCALES, `${namespace}.json`);
  return new Set(Object.keys(JSON.parse(readFileSync(file, "utf8")) as object));
}

describe("translation namespaces in the export windows", () => {
  const files = multiNamespaceFiles();

  it("finds the files it is meant to check", () => {
    // A rename or a refactor that emptied this list would make every assertion
    // below vacuously pass.
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("PdfExportDialog.tsx");
  });

  it.each(files)("%s resolves every literal key in the right bundle", (file) => {
    const src = readFileSync(path.join(SRC, file), "utf8");
    const bound = bindings(src);
    expect(bound.size).toBeGreaterThan(1);

    const missing: string[] = [];
    for (const [fn, namespace] of bound) {
      const known = keysOf(namespace);
      // Literal single-argument calls only. A computed key (`t(\`pdf.${x}\`)`)
      // cannot be resolved statically, and guessing at one would produce a
      // false failure — those are covered by the runtime tests instead.
      const calls = src.matchAll(new RegExp(`\\b${fn}\\("([^"\`$]+)"`, "g"));
      for (const call of calls) {
        const key = call[1]!;
        if (!known.has(key)) missing.push(`${fn}("${key}") — not in ${namespace}.json`);
      }
    }
    expect(missing).toEqual([]);
  });
});
