/**
 * Every Tauri fs command the frontend calls is granted by the capability of
 * the windows that call it — and nothing more (#1555).
 *
 * Tauri authorizes each plugin COMMAND separately: `fs:allow-stat` lets a
 * webview run `stat` and nothing else, however wide its path scope. The
 * symlink check in `src/export/resourceResolver.ts` called `lstat`, which no
 * capability granted, so every lstat was denied, the catch branch read the
 * denial as "inaccessible", and every local image in an exported PDF or HTML
 * file became "Image not found" — on every platform. `exportPublish.ts`
 * called it too, so re-exporting an HTML folder over an earlier export failed.
 * Nothing compiles across that seam: the call is TypeScript, the grant is JSON,
 * and the join is made by the Tauri runtime when a user clicks.
 *
 * So this file derives both sides and compares them:
 *
 *   - the commands: every name imported from `@tauri-apps/plugin-fs` by
 *     production code under `src/`, mapped to the command(s) that function
 *     invokes by reading the INSTALLED plugin's `dist-js/index.js`, so a
 *     plugin rename cannot leave a stale hand-written table behind;
 *   - the grants: the `fs:*` identifiers in `default.json` and `windows.json`
 *     (the document windows, `main` and `doc-*`).
 *
 * Equality, not inclusion: a grant no code calls is privilege the webview
 * holds for nothing. The exact path scope of each grant is pinned separately,
 * in `src-tauri/src/capabilities.test.rs`.
 *
 * WHY THE DOCUMENT WINDOWS GET THE WHOLE SET. Every window loads the same
 * bundle, so a static import graph cannot say which window EXECUTES a call:
 * from `src/pages/PdfExportPage.tsx` it reaches the diagram exporters'
 * `writeFile`, which only a document window runs. The document windows are
 * where the fs-using features live; the PDF-export page's own direct calls are
 * checked against `pdf-export.json` below, and `capabilities.test.rs` pins that
 * the Settings window holds no fs permission at all.
 *
 * One indirection is deliberately not followed: `writeFile` given a
 * `ReadableStream` goes through `open`/`write`. VMark passes byte arrays, which
 * invoke `write_file` directly.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript");

const ROOT = join(import.meta.dirname, "..");
const FS_MODULE = "@tauri-apps/plugin-fs";
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const isTest = (f) => /\.test\.|\.spec\.|__tests__|(^|\/)test\/|\.bench\./.test(f);

/** Plugin exports that are values, not commands. */
const NON_COMMAND_EXPORTS = new Set(["BaseDirectory", "SeekMode"]);

/** Exported function name → the `plugin:fs|…` commands its body invokes. */
function pluginCommands() {
  const file = "node_modules/@tauri-apps/plugin-fs/dist-js/index.js";
  const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const commands = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name) continue;
    const found = new Set();
    const walk = (n) => {
      if (ts.isStringLiteralLike(n)) {
        const m = /^plugin:fs\|(\w+)$/.exec(n.text);
        if (m) found.add(m[1]);
      }
      ts.forEachChild(n, walk);
    };
    walk(stmt);
    commands.set(stmt.name.text, [...found]);
  }
  return commands;
}

/** Names bound by `{ a, b: c }`, by the export name (`a`, `b`). */
const bindingNames = (pattern) =>
  pattern.elements.map((el) => (el.propertyName ?? el.name).text);

/**
 * Every `@tauri-apps/plugin-fs` export a source file uses. A form whose names
 * cannot be read statically (a namespace import, an un-destructured dynamic
 * import) is reported in `unreadable` rather than skipped.
 */
function fsImports(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names = new Set();
  const unreadable = [];
  const where = (n) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const walk = (n) => {
    const isStatic = (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier) &&
      n.moduleSpecifier.text === FS_MODULE;
    if (isStatic && ts.isImportDeclaration(n)) {
      const clause = n.importClause;
      if (clause && !clause.isTypeOnly) {
        const bindings = clause.namedBindings;
        if (clause.name || (bindings && !ts.isNamedImports(bindings))) unreadable.push(where(n));
        for (const el of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
          if (!el.isTypeOnly) names.add((el.propertyName ?? el.name).text);
        }
      }
    } else if (isStatic) {
      if (!n.exportClause || !ts.isNamedExports(n.exportClause)) unreadable.push(where(n));
      else if (!n.isTypeOnly) {
        for (const el of n.exportClause.elements) {
          if (!el.isTypeOnly) names.add((el.propertyName ?? el.name).text);
        }
      }
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && n.arguments[0].text === FS_MODULE) {
      // `import(m).then(({ a }) => …)` or `const { a } = await import(m)`.
      const then = n.parent;
      const callback = ts.isPropertyAccessExpression(then) && then.name.text === "then" &&
        ts.isCallExpression(then.parent) ? then.parent.arguments[0] : undefined;
      const param = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        ? callback.parameters[0]?.name : undefined;
      const decl = ts.isAwaitExpression(n.parent) && ts.isVariableDeclaration(n.parent.parent)
        ? n.parent.parent.name : undefined;
      const pattern = [param, decl].find((p) => p && ts.isObjectBindingPattern(p));
      if (pattern) bindingNames(pattern).forEach((name) => names.add(name));
      else unreadable.push(where(n));
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return { names, unreadable };
}

// All of `src/`, filtered here: a `src/**/*.ts` pathspec skips files directly in `src/`.
const productionSources = execFileSync("git", ["ls-files", "--", "src"], { cwd: ROOT, encoding: "utf8" })
  .trim().split("\n").filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !isTest(f))
  // A file deleted in the working tree but not yet in the index has nothing to read.
  .filter((f) => existsSync(join(ROOT, f)));

/** Export name → files that import it, across all production sources. */
const usedExports = new Map();
const unreadableSites = [];
for (const file of productionSources) {
  const source = read(file);
  if (!source.includes(FS_MODULE)) continue;
  const { names, unreadable } = fsImports(file, source);
  unreadableSites.push(...unreadable);
  for (const name of names) usedExports.set(name, [...(usedExports.get(name) ?? []), file]);
}

const COMMANDS = pluginCommands();

/** `fs:allow-…` identifiers the given exports require. */
function requiredPermissions(exportNames) {
  const required = new Set();
  for (const name of exportNames) {
    if (NON_COMMAND_EXPORTS.has(name)) continue;
    const commands = COMMANDS.get(name) ?? [];
    expect(commands, `plugin-fs export "${name}" invokes no command this test can see — ` +
      "teach pluginCommands() how it reaches Rust").not.toHaveLength(0);
    for (const command of commands) required.add(`fs:allow-${command.replaceAll("_", "-")}`);
  }
  return [...required].sort();
}

/** The `fs:*` permission identifiers a capability file grants. */
function fsGrants(rel) {
  return JSON.parse(read(`src-tauri/capabilities/${rel}`)).permissions
    .map((p) => (typeof p === "string" ? p : p.identifier))
    .filter((id) => id.startsWith("fs:"))
    .sort();
}

describe("fs capability grants match the frontend's fs calls (#1555)", () => {
  it("finds the frontend's fs calls and the plugin's commands (non-vacuous)", () => {
    expect(productionSources.length).toBeGreaterThan(100);
    expect(usedExports.size).toBeGreaterThan(5);
    expect(COMMANDS.get("readTextFile")).toEqual(["read_text_file"]);
    expect(COMMANDS.get("lstat")).toEqual(["lstat"]);
  });

  it("can read every fs import statically", () => {
    expect(unreadableSites, "destructure the names you import from " +
      `${FS_MODULE}, so this test can see which commands they need`).toEqual([]);
  });

  it("the document windows hold exactly the fs commands the frontend calls", () => {
    expect(fsGrants("default.json")).toEqual(requiredPermissions(usedExports.keys()));
  });

  it("windows.json grants the Windows drive letters the same commands", () => {
    expect(fsGrants("windows.json")).toEqual(fsGrants("default.json"));
  });

  it("the PDF-export page's own fs calls are granted to the pdf-export window", () => {
    const page = "src/pages/PdfExportPage.tsx";
    const { names } = fsImports(page, read(page));
    expect([...names]).toContain("readTextFile");
    const granted = fsGrants("pdf-export.json");
    for (const permission of requiredPermissions(names)) expect(granted).toContain(permission);
  });
});
