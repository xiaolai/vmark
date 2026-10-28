// WI-AL0.7 — the import closure that makes production code a probe runs part of its spike's fingerprint
/**
 * Pins `importClosure` against fixture trees in tmpdir: it follows relative,
 * `@/` and `@shared/` imports (static, type-only, re-export, dynamic, vi.mock,
 * worker URLs, import.meta.glob, vitest setupFiles) to the files they resolve
 * to, transitively; stops at bare packages (adding the package.json and
 * pnpm-lock.yaml that pin them), node_modules and the stop set; ignores
 * imports in comments and strings; drops the files an import.meta.glob call's
 * negative patterns exclude; and throws on an import it cannot resolve.
 *
 * @coordinates-with scripts/lib/alSpikeImportGraph.mjs — the module under test
 * @module scripts/lib/alSpikeImportGraph.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codeEdges, importClosure } from "./alSpikeImportGraph.mjs";

const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A fixture repo holding `files` (repo-relative path → contents). */
function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "al-graph-"));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const P = "spike/probe.ts";

describe("importClosure — what a probe reaches", () => {
  it.each([
    ["an @/ alias import, then a relative one inside src/", { [P]: 'import { a } from "@/a";\n', "src/a.ts": 'export * from "./b";\n', "src/b.ts": "export const a = 1;\n" }, ["src/a.ts", "src/b.ts"]],
    ["an @shared/ alias import", { [P]: 'import "@shared/s";\n', "src/shared/s.ts": "\n" }, ["src/shared/s.ts"]],
    ["a directory import through index.ts", { [P]: 'import "@/dir";\n', "src/dir/index.ts": "\n" }, ["src/dir/index.ts"]],
    ["a .js specifier that names a .ts file", { [P]: 'import "@/m.js";\n', "src/m.ts": "\n" }, ["src/m.ts"]],
    ["a .tsx module", { [P]: 'import "@/View";\n', "src/View.tsx": "export {};\n" }, ["src/View.tsx"]],
    ["a type-only import", { [P]: 'import type { T } from "@/types";\n', "src/types.ts": "export type T = 1;\n" }, ["src/types.ts"]],
    ["a literal dynamic import", { [P]: 'await import("@/lazy");\n', "src/lazy.ts": "\n" }, ["src/lazy.ts"]],
    ["a vi.mock path (automock loads the module)", { [P]: 'vi.mock("@/mocked");\n', "src/mocked.ts": "\n" }, ["src/mocked.ts"]],
    ["a vi.doMock path", { [P]: 'vi.doMock("@/mocked");\n', "src/mocked.ts": "\n" }, ["src/mocked.ts"]],
    ["a vi.importActual path", { [P]: 'await vi.importActual("@/actual");\n', "src/actual.ts": "\n" }, ["src/actual.ts"]],
    ["a vi.importMock path", { [P]: 'await vi.importMock<typeof import("@/t")>("@/automock");\n', "src/automock.ts": "\n", "src/t.ts": "\n" }, ["src/automock.ts"]],
    ["a worker URL", { [P]: 'new Worker(new URL("./worker.mjs", import.meta.url));\n', "spike/worker.mjs": "\n" }, ["spike/worker.mjs"]],
    ["a query suffix is stripped", { [P]: 'import raw from "@/text.md?raw";\n', "src/text.md": "# x\n" }, ["src/text.md"]],
    ["a non-code import is hashed, not parsed", { [P]: 'import "@/x.css";\n', "src/x.css": '@import "./nope.css";\n' }, ["src/x.css"]],
    ["an import.meta.glob", { [P]: 'import "@/i18n";\n', "src/i18n.ts": 'import.meta.glob("./locales/*/*.json");\n', "src/locales/en/a.json": "{}\n", "src/locales/zh/a.json": "{}\n" }, ["src/i18n.ts", "src/locales/en/a.json", "src/locales/zh/a.json"]],
    ["a CJK path", { [P]: 'import "@/文档/编辑";\n', "src/文档/编辑.ts": "\n" }, ["src/文档/编辑.ts"]],
    ["a cycle terminates", { [P]: 'import "@/a";\n', "src/a.ts": 'import "./b";\n', "src/b.ts": 'import "./a";\n' }, ["src/a.ts", "src/b.ts"]],
    ["a cross-spike relative import", { [P]: 'import "../other/lib/x.mjs";\n', "other/lib/x.mjs": "\n" }, ["other/lib/x.mjs"]],
  ])("follows %s", (_name, files, expected) => {
    const root = tree(files);
    const reached = importClosure(root, [P]);
    expect(reached).toEqual(expect.arrayContaining([P, ...expected]));
  });

  it("does not reach an unrelated file, or an import written in a comment or a string", () => {
    const root = tree({
      [P]: '// import "@/commented";\nconst s = "import \\"@/stringed\\"";\nimport "@/used";\n',
      "src/used.ts": "\n", "src/commented.ts": "\n", "src/stringed.ts": "\n", "src/unrelated.ts": "\n",
    });
    expect(importClosure(root, [P])).toEqual([P, "src/used.ts"]);
  });

  it("stops at a bare package, adding the package.json and pnpm-lock.yaml that pin it", () => {
    const root = tree({
      [P]: 'import "@/a";\nimport "node:fs";\n', "src/a.ts": 'import { Node } from "@tiptap/pm/model";\n',
      "package.json": "{}\n", "pnpm-lock.yaml": "lockfileVersion: 9\n",
      "node_modules/@tiptap/pm/model/index.js": "\n",
    });
    expect(importClosure(root, [P])).toEqual(["package.json", "pnpm-lock.yaml", P, "src/a.ts"]);
  });

  it("pins a nested project's package with that project's own package.json and lockfile", () => {
    const root = tree({
      [P]: 'import "../revert/lib/r.mjs";\n', "revert/lib/r.mjs": 'import "diff";\n',
      "revert/package.json": "{}\n", "revert/pnpm-lock.yaml": "x\n", "package.json": "{}\n", "pnpm-lock.yaml": "y\n",
    });
    expect(importClosure(root, [P])).toEqual(["revert/lib/r.mjs", "revert/package.json", "revert/pnpm-lock.yaml", P]);
  });

  it("does not walk into node_modules through a relative import", () => {
    const root = tree({ [P]: 'import "../node_modules/x/index.js";\n', "node_modules/x/index.js": 'import "./y.js";\n' });
    expect(importClosure(root, [P])).toEqual([P]);
  });

  it("neither adds nor walks a file in the stop set", () => {
    const root = tree({ [P]: 'import "../tool/fp.mjs";\n', "tool/fp.mjs": 'import "./helper.mjs";\n', "tool/helper.mjs": "\n" });
    expect(importClosure(root, [P], { stop: ["tool/fp.mjs"] })).toEqual([P]);
  });

  it("follows a vitest config's setupFiles from the repo root, and what they import", () => {
    const root = tree({
      "spike/vitest.config.ts": 'export default { test: { setupFiles: ["./src/test/setup.ts"] } };\n',
      "src/test/setup.ts": 'import "@/i18n";\n', "src/i18n.ts": "\n",
    });
    expect(importClosure(root, ["spike/vitest.config.ts"])).toEqual(["spike/vitest.config.ts", "src/i18n.ts", "src/test/setup.ts"]);
  });

  it.each([
    ["a relative import", { [P]: 'import "./missing";\n' }, /cannot resolve "\.\/missing" imported by spike\/probe\.ts/],
    ["an alias import", { [P]: 'import "@/missing";\n' }, /cannot resolve "@\/missing"/],
    ["a missing setup file", { "spike/vitest.config.ts": 'export default { test: { setupFiles: "./src/gone.ts" } };\n' }, /cannot resolve "\.\/src\/gone\.ts"/],
    ["an import outside the repo", { [P]: 'import "../../../../../../../../../../outside.ts";\n' }, /outside the repo/],
  ])("throws on %s it cannot resolve", (_name, files, message) => {
    const root = tree(files);
    expect(() => importClosure(root, [Object.keys(files)[0]])).toThrow(message);
  });

  it("a mock or worker URL in a comment or a string is not an edge, and an empty glob match is not an error", () => {
    const root = tree({
      [P]: '// vi.mock("@/gone");\nconst s = \'vi.mock("@/stringed")\';\n/* new URL("./gone.mjs", import.meta.url) */\nimport.meta.glob("./none/*.json");\n',
      "src/stringed.ts": "\n",
    });
    expect(importClosure(root, [P])).toEqual([P]);
  });

  it("a file URL that is not a worker is followed when it exists and is not required (it may be an output)", () => {
    const root = tree({
      [P]: 'readFileSync(new URL("./input.json", import.meta.url));\nwriteFileSync(new URL("./output.json", import.meta.url), "x");\n',
      "spike/input.json": "{}\n",
    });
    expect(importClosure(root, [P])).toEqual(["spike/input.json", P]);
  });

  it.each([
    ["a vi.mock target", 'vi.mock("@/gone");\n', /cannot resolve "@\/gone"/],
    ["a vi.doMock target", 'vi.doMock("./gone");\n', /cannot resolve "\.\/gone"/],
    ["a worker URL", 'new Worker(new URL("./gone.mjs", import.meta.url));\n', /cannot resolve "\.\/gone\.mjs"/],
  ])("throws on %s in code that resolves to nothing", (_name, body, message) => {
    expect(() => importClosure(tree({ [P]: body }), [P])).toThrow(message);
  });

  it.each([
    ["a relative negative pattern", 'import.meta.glob(["./g/*.json", "!./g/skip.json"]);\n', { "src/g/a.json": "{}\n", "src/g/skip.json": "{}\n" }, ["src/g/a.json"]],
    ["a ** negative pattern, at any depth", 'import.meta.glob(["./g/**/*.json", "!**/skip.json"]);\n', { "src/g/a.json": "{}\n", "src/g/x/skip.json": "{}\n", "src/g/skip.json": "{}\n" }, ["src/g/a.json"]],
    ["an aliased negative pattern", 'import.meta.glob(["@/g/*.json", "!@/g/skip.json"]);\n', { "src/g/a.json": "{}\n", "src/g/skip.json": "{}\n" }, ["src/g/a.json"]],
    ["only negative patterns", 'import.meta.glob(["!./g/skip.json"]);\n', { "src/g/skip.json": "{}\n" }, []],
    ["a file one call excludes and another includes", 'import.meta.glob(["./g/*.json", "!./g/skip.json"]);\nimport.meta.glob("./g/skip.json");\n', { "src/g/a.json": "{}\n", "src/g/skip.json": "{}\n" }, ["src/g/a.json", "src/g/skip.json"]],
  ])("an import.meta.glob with %s fingerprints only what Vite would load", (_name, body, extra, globbed) => {
    const root = tree({ [P]: 'import "@/i18n";\n', "src/i18n.ts": body, ...extra });
    expect(importClosure(root, [P])).toEqual([...globbed, "src/i18n.ts", P].sort());
  });

  it("an empty entry list reaches nothing", () => {
    expect(importClosure(tree({}), [])).toEqual([]);
  });
});

describe("codeEdges — one file's edges, from its syntax tree", () => {
  it("sorts each edge into required, optional, glob or setup file", () => {
    const text = [
      'import "./a";', 'vi.mock("./m");', 'vi.importActual("./act");', "new Worker(new URL(\"./w.mjs\", import.meta.url));",
      "readFileSync(new URL(\"./data.json\", import.meta.url));", 'import.meta.glob(["./g/*.json", "!./g/skip.json"]);',
      'export default { test: { setupFiles: ["./setup.ts"] } };', '// vi.mock("./commented");', "const s = 'vi.mock(\"./stringed\")';",
    ].join("\n");
    expect(codeEdges("x.ts", text)).toEqual({
      required: ["./a", "./m", "./act", "./w.mjs"], optional: ["./data.json"], globs: [{ include: ["./g/*.json"], exclude: ["./g/skip.json"] }], setupFiles: ["./setup.ts"],
    });
  });

  it("keeps each import.meta.glob call's negative patterns with its own positive ones", () => {
    const text = 'import.meta.glob("./a/*.ts");\nimport.meta.glob(["!**/x.ts", "./b/*.ts", "!./b/y.ts"]);\n';
    expect(codeEdges("x.ts", text).globs).toEqual([
      { include: ["./a/*.ts"], exclude: [] },
      { include: ["./b/*.ts"], exclude: ["**/x.ts", "./b/y.ts"] },
    ]);
  });

  it("reads a .tsx file as TSX", () => {
    expect(codeEdges("v.tsx", 'vi.mock("./m");\nexport const V = () => <div>{"vi.mock(\'./no\')"}</div>;\n').required).toEqual(["./m"]);
  });

  it("an empty file has no edges", () => {
    expect(codeEdges("e.ts", "")).toEqual({ required: [], optional: [], globs: [], setupFiles: [] });
  });
});
