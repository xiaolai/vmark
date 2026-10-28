// @vitest-environment node
// WI-RA21.1 — architecture-fitness test: a document's text comes off disk
// through `readDocumentText` and nothing else.
//
// plugin-fs `readTextFile` decodes with `new TextDecoder("utf-8")`, whose
// default drops a leading byte-order mark. Every document path read with it —
// open, Finder open, replace, workspace restore, bootstrap, reload, the
// watcher and its fingerprint, Keep-my-changes, the MCP open, the terminal's
// file links, orphan-image scans — so in the real app a BOM'd file never set
// `hasBom`, the first save stripped the mark, and a file that gained or lost a
// BOM read as unchanged. The jsdom tiers could not see it: their fake disk
// handed the BOM back. This test makes the rule structural, so the next reader that reaches
// for `readTextFile` fails here instead of losing bytes in the field.
//
// The rule: no production file obtains plugin-fs `readTextFile` (or
// `readTextFileLines`, the same decoder) unless it is listed below as reading
// a file VMark itself wrote, or a file it only parses — never one it opens,
// compares against disk, or saves. The list is two-way: an entry whose file no
// longer reads text fails too, so it cannot rot into a blanket pass.
//
// Imports are found with the TypeScript parser, not text search: static,
// aliased, namespace and default imports, re-exports, and dynamic imports
// (destructured names are honoured; anything else counts as the whole module).
//
// @coordinates-with services/files/readDocumentText.ts — the one door

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(import.meta.dirname, "..", "..");
const PLUGIN_FS = "@tauri-apps/plugin-fs";
const DOOR = "services/files/readDocumentText.ts";

/** plugin-fs exports that decode file bytes with the BOM-dropping decoder. */
const TEXT_DECODING = new Set(["*", "readTextFile", "readTextFileLines"]);

/**
 * Files that may decode with plugin-fs, and why each one is not a document
 * read. A new entry needs the same kind of reason: VMark wrote the file, or it
 * is parsed for metadata and never opened, compared with disk, or written back.
 */
const NON_DOCUMENT_READERS: Record<string, string> = {
  "services/history/historyStorage.ts": "history index JSON and snapshots that VMark writes",
  "services/history/historyRecovery.ts": "history index JSON that VMark writes",
  "services/persistence/crashRecovery.ts": "crash-recovery snapshot JSON that VMark writes",
  "services/media/imageHashRegistry.ts": "image-hash registry JSON that VMark writes",
  "export/exportLockFile.ts": "export lock file that VMark writes",
  "pages/PdfExportPage.tsx": "the temporary HTML the PDF export itself wrote",
  "lib/ghaWorkflow/actions/registry.ts":
    "a local action's action.yml, parsed for its inputs; never opened or saved",
};

/** Production sources: no tests, no test helpers, no declaration files. */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "test" || entry === "__mocks__") continue;
      out.push(...collectSources(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || entry.endsWith(".d.ts")) continue;
    if (/\.test\.tsx?$/.test(entry) || /\.webkit\.test\./.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function isPluginFs(node: ts.Node | undefined): boolean {
  return node !== undefined && ts.isStringLiteral(node) && node.text === PLUGIN_FS;
}

function bindingNames(pattern: ts.ObjectBindingPattern): string[] {
  return pattern.elements.map((el) =>
    (el.propertyName ?? el.name).getText().replace(/["']/g, ""),
  );
}

/** Names reached through a dynamic `import("@tauri-apps/plugin-fs")`. */
function dynamicImportNames(call: ts.CallExpression): string[] {
  const parent = call.parent;
  // const { a, b } = await import("…")
  if (ts.isAwaitExpression(parent) && ts.isVariableDeclaration(parent.parent)) {
    const target = parent.parent.name;
    if (ts.isObjectBindingPattern(target)) return bindingNames(target);
  }
  // import("…").then(({ a, b }) => …)
  if (ts.isPropertyAccessExpression(parent) && parent.name.text === "then") {
    const thenCall = parent.parent;
    if (ts.isCallExpression(thenCall)) {
      const callback = thenCall.arguments[0];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const first = callback.parameters[0]?.name;
        if (first && ts.isObjectBindingPattern(first)) return bindingNames(first);
      }
    }
  }
  return ["*"];
}

/** Every plugin-fs export a source file can reach; `*` means all of them. */
function pluginFsNames(fileName: string, code: string): string[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isPluginFs(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause?.name) names.push("*");
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) names.push((el.propertyName ?? el.name).text);
      }
    } else if (ts.isExportDeclaration(node) && isPluginFs(node.moduleSpecifier)) {
      const clause = node.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) names.push((el.propertyName ?? el.name).text);
      } else {
        names.push("*");
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      isPluginFs(node.arguments[0])
    ) {
      names.push(...dynamicImportNames(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

const sources = collectSources(SRC_ROOT)
  .map((file) => ({ file: relative(SRC_ROOT, file).split(sep).join("/"), code: readFileSync(file, "utf8") }))
  .filter(({ code }) => code.includes(PLUGIN_FS));

const decoders = sources
  .map(({ file, code }) => ({ file, names: pluginFsNames(file, code) }))
  .filter(({ names }) => names.some((n) => TEXT_DECODING.has(n)));

describe("document read invariant", () => {
  it("scans the plugin-fs users, including the door", () => {
    // A scan that found nothing would pass every assertion below vacuously.
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.map((s) => s.file)).toContain(DOOR);
  });

  it("recognises every way a file can reach readTextFile", () => {
    const names = (code: string) => pluginFsNames("probe.ts", code);
    expect(names('import { exists, readTextFile } from "@tauri-apps/plugin-fs";')).toEqual([
      "exists",
      "readTextFile",
    ]);
    expect(names('import { readTextFile as read } from "@tauri-apps/plugin-fs";')).toEqual([
      "readTextFile",
    ]);
    expect(names('import * as fs from "@tauri-apps/plugin-fs";')).toEqual(["*"]);
    expect(names('import fs from "@tauri-apps/plugin-fs";')).toEqual(["*"]);
    expect(names('export { readTextFile } from "@tauri-apps/plugin-fs";')).toEqual(["readTextFile"]);
    expect(names('const { readTextFile, stat } = await import("@tauri-apps/plugin-fs");')).toEqual([
      "readTextFile",
      "stat",
    ]);
    expect(
      names('import("@tauri-apps/plugin-fs").then(async ({ readTextFile }) => readTextFile("x"));'),
    ).toEqual(["readTextFile"]);
    expect(names('const fs = await import("@tauri-apps/plugin-fs");')).toEqual(["*"]);
    // Prose naming the API is not an import.
    expect(names('// import { readTextFile } from "@tauri-apps/plugin-fs"\nconst x = 1;')).toEqual([]);
  });

  it("no document is read with plugin-fs readTextFile", () => {
    const offenders = decoders
      .filter(({ file }) => !(file in NON_DOCUMENT_READERS))
      .map(({ file, names }) => `${file} reaches ${names.filter((n) => TEXT_DECODING.has(n)).join(", ")}`);

    expect(
      offenders,
      "plugin-fs readTextFile drops a file's leading BOM. Read a document with " +
        "readDocumentText (services/files/readDocumentText.ts), which keeps it and " +
        "refuses UTF-16/UTF-32. Only a file VMark wrote itself may use readTextFile.",
    ).toEqual([]);
  });

  it("every listed non-document reader still decodes text (the list cannot go stale)", () => {
    const decoding = new Set(decoders.map((d) => d.file));
    const stale = Object.keys(NON_DOCUMENT_READERS).filter((file) => !decoding.has(file));
    expect(stale, "Remove entries whose file no longer reads text with plugin-fs.").toEqual([]);
  });

  it("the door reads bytes, never the BOM-dropping decoder", () => {
    const door = sources.find((s) => s.file === DOOR);
    const names = door ? pluginFsNames(door.file, door.code) : [];
    expect(names).toEqual(["readFile"]);
  });
});
