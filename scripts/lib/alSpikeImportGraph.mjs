/**
 * Purpose: the import closure of an agent-edit-ledger spike — every repo file
 * its probe and lib sources reach through imports, so production code a probe
 * runs (the anchor spike's real Markdown serializer, the review probes' schema)
 * is part of the spike's fingerprint, derived from the code rather than a hand
 * list that would rot.
 *
 * Edges followed, from each code file reached, read from its syntax tree (so an
 * edge written in a comment or a string is never one):
 *   - static, type-only, re-export, require and literal dynamic imports, read by
 *     TypeScript's `preProcessFile`;
 *   - `vi.mock`/`vi.doMock`/`vi.importActual`/`vi.importMock` paths and
 *     `new Worker(new URL("./x", import.meta.url))` files, each required like
 *     an import;
 *   - any other `new URL("./x", import.meta.url)` — a file the code reads or
 *     WRITES, so one that does not exist yet is not an error (an output);
 *   - `import.meta.glob` patterns — a pattern that matches nothing is not an
 *     error (a glob may legitimately be empty); a call's negative (`!`)
 *     patterns drop what they match from that call's results, as Vite does —
 *     resolved like the positive ones, except a `**`-led one, which matches at
 *     any depth;
 *   - a `vitest.config.*`'s `setupFiles`, resolved from the repo root (both spike
 *     configs set `root` to it), since the runner loads them without an import.
 * Specifiers resolve as the spike's vitest config does: relative to the file, or
 * through the `@`/`@shared` aliases from `sourceAliases` (vitest.shared.ts, the
 * one definition every config uses), trying TypeScript's extension rules.
 * A bare package is not walked: the nearest package.json and pnpm-lock.yaml above
 * the importing file — which pin its resolved version and any pnpm patch hash —
 * are added instead. node_modules/ and the caller's stop set are boundaries.
 * Any other edge that cannot be resolved throws: a gap in this resolver
 * must fail loud, never shrink the fingerprint.
 *
 * Parts: `codeEdges` (one file's edges, pure), `makeResolver` (specifier →
 * file, package pinning), `importClosure` (the walk).
 *
 * @coordinates-with scripts/lib/alSpikeFingerprint.mjs — adds this closure to each spike's inputs
 * @coordinates-with scripts/lib/alSpikeImportGraph.test.mjs — the self-test
 * @module scripts/lib/alSpikeImportGraph
 */
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";

import { sourceAliases } from "../../vitest.shared.ts";

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js", ".jsx", ".cjs", ".json", ".d.ts"];
const JS_TO_TS = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };
const VITEST_CONFIG = /(?:^|\/)vitest\.config\.[cm]?[jt]s$/;
/** The `vi.*` calls whose first argument is a module the runner loads. */
const MOCK_CALLS = new Set(["mock", "doMock", "importActual", "importMock"]);

const toPosix = (p) => p.split(path.sep).join("/");
const isFile = (abs) => statSync(abs, { throwIfNoEntry: false })?.isFile() === true;
const isBuiltin = (spec) => spec.startsWith("node:") || builtinModules.includes(spec) || /^[a-z]+:/.test(spec);
const isLiteral = (n) => n !== undefined && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));
/** The string literals of `n`: itself, or the literal elements of an array literal. */
const literalsOf = (n) => (isLiteral(n) ? [n.text] : n && ts.isArrayLiteralExpression(n) ? n.elements.filter(isLiteral).map((e) => e.text) : []);
const isImportMeta = (n) => ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword && n.name.text === "meta";
/** `n` is the first argument of `new Worker(…)` or `new SharedWorker(…)`. */
const isWorkerArg = (n) => ts.isNewExpression(n.parent) && n.parent.arguments?.[0] === n && ts.isIdentifier(n.parent.expression) && /^(?:Shared)?Worker$/.test(n.parent.expression.text);
/** `n` is `<object>.<name>` with `object` matching `isObject`. */
const isAccess = (n, isObject, name) => ts.isPropertyAccessExpression(n) && isObject(n.expression) && (name === undefined || n.name.text === name);

/**
 * The edges of one code file, from its syntax tree: `required` specifiers
 * (imports, mocks, worker URLs), `optional` ones (other file URLs), `globs`
 * (one `{ include, exclude }` per import.meta.glob call, its negative
 * patterns without the `!`) and `setupFiles` (a vitest config's). Pure.
 */
export function codeEdges(fileName, text) {
  const required = ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);
  const optional = [];
  const globs = [];
  const setupFiles = [];
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (isAccess(callee, (o) => ts.isIdentifier(o) && o.text === "vi") && MOCK_CALLS.has(callee.name.text) && isLiteral(n.arguments[0])) required.push(n.arguments[0].text);
      else if (isAccess(callee, isImportMeta, "glob")) {
        const patterns = literalsOf(n.arguments[0]);
        globs.push({ include: patterns.filter((p) => !p.startsWith("!")), exclude: patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1)) });
      }
    } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "URL") {
      const [spec, base] = n.arguments ?? [];
      if (isLiteral(spec) && /^\.{1,2}\//.test(spec.text) && base && isAccess(base, isImportMeta, "url")) (isWorkerArg(n) ? required : optional).push(spec.text);
    } else if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || isLiteral(n.name)) && n.name.text === "setupFiles") {
      setupFiles.push(...literalsOf(n.initializer));
    }
    ts.forEachChild(n, visit);
  };
  visit(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true));
  return { required, optional, globs, setupFiles };
}

/** The file `base` names under TypeScript/Vite resolution, or null. */
function resolveFile(base) {
  const ext = path.extname(base);
  const candidates = [base, ...(JS_TO_TS[ext] ?? []).map((e) => base.slice(0, -ext.length) + e)];
  candidates.push(...RESOLVE_EXTENSIONS.map((e) => base + e), ...RESOLVE_EXTENSIONS.map((e) => path.join(base, `index${e}`)));
  return candidates.find(isFile) ?? null;
}

/** The nearest `name` in `fromDir` or above it, not above `root`. */
function nearestUp(root, fromDir, name) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, name))) return path.join(dir, name);
    if (dir === root || path.dirname(dir) === dir) return null;
  }
}

/**
 * Specifier resolution under `absRoot`: `rel` (repo-relative POSIX path),
 * `baseOf` (the absolute path a specifier names, null for a bare package;
 * throws when it leaves the repo), `resolve` (the file an edge reaches, or
 * the pins of a bare package; [] for a builtin; throws when unresolvable
 * unless `optional`, which gives []).
 */
function makeResolver(absRoot) {
  const aliases = Object.entries(sourceAliases(absRoot)).sort(([a], [b]) => b.length - a.length);
  const rel = (abs) => toPosix(path.relative(absRoot, abs));
  const inRepo = (abs) => !path.relative(absRoot, abs).startsWith("..") && !path.isAbsolute(path.relative(absRoot, abs));
  const baseOf = (spec, fromAbs) => {
    const alias = aliases.find(([key]) => spec === key || spec.startsWith(`${key}/`));
    const base = alias
      ? alias[1] + spec.slice(alias[0].length)
      : spec.startsWith(".") ? path.resolve(path.dirname(fromAbs), spec)
      : spec.startsWith("/") ? path.join(absRoot, spec) : null;
    if (base !== null && !inRepo(base)) throw new Error(`"${spec}" imported by ${rel(fromAbs)} resolves outside the repo`);
    return base;
  };
  /** The package.json and pnpm-lock.yaml pinning the bare packages `fromAbs` imports. */
  const pins = (fromAbs) => {
    const pkg = nearestUp(absRoot, path.dirname(fromAbs), "package.json");
    if (!pkg) throw new Error(`no package.json pins the packages imported by ${rel(fromAbs)}`);
    const lock = nearestUp(absRoot, path.dirname(pkg), "pnpm-lock.yaml");
    return lock ? [pkg, lock] : [pkg];
  };
  const resolve = (spec, fromAbs, { base: given, optional = false } = {}) => {
    const clean = spec.replace(/[?#].*$/, "");
    if (isBuiltin(clean)) return [];
    const base = given ?? baseOf(clean, fromAbs);
    if (base === null) return pins(fromAbs);
    const file = resolveFile(base);
    if (file) return [file];
    if (optional) return [];
    throw new Error(`cannot resolve "${spec}" imported by ${rel(fromAbs)}`);
  };
  return { rel, baseOf, resolve };
}

/**
 * Every repo-relative file reachable from `entries` (repo-relative; included),
 * plus the package.json/pnpm-lock.yaml pinning each bare import — sorted.
 * Files in `stop` are neither added nor walked. Throws on an unresolvable edge.
 */
export function importClosure(root, entries, { stop = [] } = {}) {
  const absRoot = path.resolve(root);
  const { rel, baseOf, resolve } = makeResolver(absRoot);
  const stopSet = new Set(stop);
  const reached = new Set();
  const queue = [];
  const add = (abs) => {
    const r = rel(abs);
    if (r.split("/").includes("node_modules") || stopSet.has(r) || reached.has(r)) return;
    reached.add(r);
    if (CODE.test(r)) queue.push(abs);
  };

  for (const entry of entries) add(path.join(absRoot, entry));
  while (queue.length > 0) {
    const abs = queue.pop();
    const edges = codeEdges(abs, readFileSync(abs, "utf8"));
    for (const spec of edges.required) resolve(spec, abs).forEach(add);
    for (const spec of edges.optional) resolve(spec, abs, { optional: true }).forEach(add);
    for (const { include, exclude } of edges.globs) {
      const repoGlob = (pattern) => {
        const base = baseOf(pattern, abs);
        return base === null ? null : toPosix(path.relative(absRoot, base));
      };
      const excluded = exclude.map((p) => (p.startsWith("**") ? p : repoGlob(p))).filter((p) => p !== null);
      for (const pattern of include.map(repoGlob).filter((p) => p !== null)) {
        for (const hit of globSync(pattern, { cwd: absRoot })) {
          if (!excluded.some((x) => path.matchesGlob(toPosix(hit), x))) add(path.join(absRoot, hit));
        }
      }
    }
    if (VITEST_CONFIG.test(rel(abs))) {
      for (const file of edges.setupFiles) resolve(file, abs, { base: path.resolve(absRoot, file) }).forEach(add);
    }
  }
  return [...reached].sort();
}
