#!/usr/bin/env node
/**
 * Mock-boundary identity ratchet (WI-18, D4).
 *
 * Tests must mock BOUNDARIES (`@tauri-apps/*`, network, fs), not app state.
 * A test that mocks `src/stores/*` re-declares the store's contract by hand;
 * when the real store drifts, the fake keeps passing — the contract-drift
 * hole behind 1,411 `vi.mock("@/…")` calls and 144 `as unknown as` casts.
 * The sanctioned alternatives are the real store (setState/reset in
 * beforeEach) or an explicit store-factory seam with a recorded reason.
 *
 * The baseline is an IDENTITY LIST of (test file, mocking API, resolved
 * module target) triples — never per-file counts, because counts permit
 * like-for-like swaps (remove baselined mock A, add new mock B, net zero
 * passes). Two-way ratchet, house standard: an unbaselined mock fails, and a
 * baselined mock that no longer exists also fails until its entry is deleted
 * (record the win, or it silently becomes headroom for the next regression).
 *
 * Coverage — no variant is documented out of scope:
 *   - `vi.mock("…")`, `vi.doMock("…")`, `vi.mock(import("…"))`
 *   - the receiver resolved through the vitest import, not assumed to be
 *     spelled `vi`: `import { vi as v }` and `import * as vitest` both count
 *     (a rename at the top of a file must not blind the gate to the suite),
 *     while `vi` with no import still counts because `globals: true` needs none
 *   - a constant-backed target (`const P = "@/stores/x"; vi.mock(P)`), resolved
 *     from same-file string bindings; anything still unreadable — an expression,
 *     an interpolated template, a reassigned binding — is recorded as a
 *     violation rather than skipped. "Cannot read" is not "cleared".
 *   - relative-path specifiers resolving into `src/stores/`
 *   - `__mocks__/` directories shadowing a store module
 *   - all test-adjacent files: `*.test.*`, `*.spec.*`, `__tests__/`,
 *     `__mocks__/`, and `src/test/` helpers (setup files live there)
 * Detection is a real TS parse (AST call expressions), so the literal in a
 * comment or a string is prose, not a mock.
 *
 * Usage:
 *   node scripts/check-mock-boundaries.mjs [--root <dir>] [--baseline <file>]
 *   node scripts/check-mock-boundaries.mjs --write-baseline   (freeze reality)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

// ─── Pure, testable core ───

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
// `.stryker-tmp` is Stryker's mutation sandbox — a gitignored full copy of the
// repo. Scanning it double-counts every baselined mock while a measurement runs.
const SKIP_DIRS = new Set(["node_modules", "dist", "target", ".git", "coverage", ".stryker-tmp"]);

/** Test-adjacent = in scope. Helpers and setup files count: a store mock in a
 *  shared harness leaks into every suite that imports it. */
export function isTestAdjacent(rel) {
  const base = rel.split("/").pop() ?? "";
  if (base.includes(".test.") || base.includes(".spec.")) return true;
  if (rel.includes("/__tests__/") || rel.includes("/__mocks__/")) return true;
  return rel.startsWith("src/test/") || rel.includes("/src/test/");
}

/** Resolve a mock specifier to a repo-relative module path, or null when it
 *  cannot reach `src/stores/` (bare package specifiers are the legitimate
 *  boundary-mock case and are never counted). */
export function resolveStoreTarget(spec, fileRel) {
  let resolved;
  if (spec.startsWith("@/")) resolved = path.posix.join("src", spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fileRel), spec));
  } else return null;
  resolved = resolved.replace(SOURCE_EXT, "");
  return resolved === "src/stores" || resolved.startsWith("src/stores/") ? resolved : null;
}

function scriptKindFor(rel) {
  if (rel.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (rel.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(ts|mts|cts)$/.test(rel)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** Recorded instead of a module path when the target cannot be read. The text
 *  IS the instruction — it is what the failure message prints. */
export const UNRESOLVED_TARGET = "<non-literal mock target — use a string literal>";

/**
 * Same-file `const X = "…"` bindings, so a constant-backed target
 * (`vi.mock(STORE_PATH)`) resolves. A name bound more than once to different
 * text maps to null: ambiguous, therefore unresolvable, therefore a violation.
 */
function stringBindingsOf(sf) {
  const bindings = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      const value = ts.isStringLiteralLike(init) ? init.text : null;
      const name = node.name.text;
      if (bindings.has(name) && bindings.get(name) !== value) bindings.set(name, null);
      else bindings.set(name, value);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      // Reassignment makes the binding ambiguous regardless of the new value.
      bindings.set(node.left.text, null);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return bindings;
}

/** Local names that stand for vitest's `vi`, plus vitest namespace imports.
 *  `vi` itself is always recognized — `globals: true` needs no import. */
function vitestReceiversOf(sf) {
  const direct = new Set(["vi"]);
  const namespaces = new Set();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteralLike(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== "vitest") continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else {
      for (const el of bindings.elements) {
        if ((el.propertyName ?? el.name).text === "vi") direct.add(el.name.text);
      }
    }
  }
  return { direct, namespaces };
}

/** Is this call expression `<vi>.mock(…)` / `<vi>.doMock(…)`? Returns the
 *  canonical api label (never the alias — identity must not fork). */
function mockApiOf(node, { direct, namespaces }) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const method = node.expression.name.text;
  if (method !== "mock" && method !== "doMock") return null;
  const recv = node.expression.expression;
  const isVi =
    (ts.isIdentifier(recv) && direct.has(recv.text)) ||
    (ts.isPropertyAccessExpression(recv) &&
      recv.name.text === "vi" &&
      ts.isIdentifier(recv.expression) &&
      namespaces.has(recv.expression.text));
  return isVi ? `vi.${method}` : null;
}

/** The first argument's module specifier: a string literal, the string inside
 *  the `vi.mock(import("…"))` dynamic form, or a same-file const bound to one.
 *  Anything else returns UNRESOLVED_TARGET — the gate fails closed rather than
 *  skipping a target it cannot read. */
function specifierOf(call, bindings) {
  const arg = call.arguments[0];
  if (!arg) return UNRESOLVED_TARGET;
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (ts.isIdentifier(arg)) return bindings.get(arg.text) ?? UNRESOLVED_TARGET;
  if (ts.isCallExpression(arg) && arg.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const inner = arg.arguments[0];
    if (inner && ts.isStringLiteralLike(inner)) return inner.text;
    if (inner && ts.isIdentifier(inner)) return bindings.get(inner.text) ?? UNRESOLVED_TARGET;
  }
  return UNRESOLVED_TARGET;
}

/** Parse one file and return its `vi.mock`/`vi.doMock` calls as
 *  { api, spec } pairs. A real AST walk: comments and plain strings cannot
 *  produce a CallExpression, so "parse, don't grep" holds by construction. */
export function extractMockCalls(text, rel) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, scriptKindFor(rel));
  const bindings = stringBindingsOf(sf);
  const receivers = vitestReceiversOf(sf);
  const calls = [];
  const visit = (node) => {
    const api = mockApiOf(node, receivers);
    if (api !== null) calls.push({ api, spec: specifierOf(node, bindings) });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}

function walk(dir, rootLen, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // A nested git checkout (e.g. an agent worktree under .claude/worktrees/)
      // is another tree, not this one — scanning it makes the gate's verdict
      // depend on machine-local state that the committed baseline cannot track.
      if (!SKIP_DIRS.has(entry.name) && !existsSync(path.join(full, ".git"))) {
        walk(full, rootLen, out);
      }
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(full.slice(rootLen).split(path.sep).join("/"));
    }
  }
  return out;
}

/** Scan a tree and return the sorted identity triples. */
export function scanTree(root) {
  const triples = [];
  for (const rel of walk(root, root.length + 1, [])) {
    if (!isTestAdjacent(rel)) continue;

    // A `__mocks__` file shadows the module at the same name one level up;
    // when that module lives in src/stores/, the shadow IS a store mock.
    if (rel.includes("/__mocks__/")) {
      const shadow = rel.replace("/__mocks__/", "/").replace(SOURCE_EXT, "");
      if (shadow === "src/stores" || shadow.startsWith("src/stores/")) {
        triples.push({ file: rel, api: "__mocks__", target: shadow });
      }
    }

    const text = readFileSync(path.join(root, rel), "utf8");
    for (const { api, spec } of extractMockCalls(text, rel)) {
      if (spec === UNRESOLVED_TARGET) {
        triples.push({ file: rel, api, target: UNRESOLVED_TARGET });
        continue;
      }
      const target = resolveStoreTarget(spec, rel);
      if (target !== null) triples.push({ file: rel, api, target });
    }
  }
  const key = (e) => `${e.file} :: ${e.api} :: ${e.target}`;
  const seen = new Map(triples.map((e) => [key(e), e]));
  return [...seen.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

/** Fail loudly on malformed baseline data — a half-read baseline must never
 *  read as "no entries" (fail closed). */
export function validateBaseline(raw, label) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${label}: expected a JSON object with an "entries" array`);
  }
  if (!Array.isArray(raw.entries)) {
    throw new Error(`${label}: "entries" must be an array of {file, api, target}`);
  }
  for (const e of raw.entries) {
    if (typeof e?.file !== "string" || typeof e?.api !== "string" || typeof e?.target !== "string") {
      throw new Error(`${label}: malformed entry ${JSON.stringify(e)}`);
    }
  }
  return raw.entries;
}

/** Identity comparison — set difference in both directions. */
export function compareIdentities(actual, baseline) {
  const key = (e) => `${e.file} :: ${e.api} :: ${e.target}`;
  const actualKeys = new Set(actual.map(key));
  const baseKeys = new Set(baseline.map(key));
  return {
    added: actual.filter((e) => !baseKeys.has(key(e))),
    removed: baseline.filter((e) => !actualKeys.has(key(e))),
  };
}

// ─── CLI shell ───

const BASELINE_HEADER = [
  "Identity baseline of test-side mocks of src/stores/* — (file, mocking API, resolved target) triples, never counts (counts permit like-for-like swaps).",
  "Checked by scripts/check-mock-boundaries.mjs (pnpm lint:mock-boundaries, in check:all); regenerate ONLY to remove entries via --write-baseline.",
  "Two-way ratchet: an unbaselined store mock fails the gate, and a baselined mock that no longer exists also fails until its entry is deleted — record the win.",
  "Entries only get REMOVED, never added. Instead of mocking a store, use the real store (setState/reset in beforeEach) or an explicit store-factory seam with a recorded reason.",
  "Registered in the WI-16 ratchet manifest (scripts/check-baseline-ratchet.mjs), which re-compares this file against the merge base in CI — so the commit that adds an entry cannot also be the commit that authorizes it.",
];

function parseArgs(argv) {
  const args = { root: null, baseline: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") args.root = argv[++i];
    else if (argv[i] === "--baseline") args.baseline = argv[++i];
    else if (argv[i] === "--write-baseline") args.write = true;
    else {
      console.error(`❌ Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const baselinePath = path.resolve(args.baseline ?? path.join(root, "scripts", "mock-boundaries-baseline.json"));

  const actual = scanTree(root);

  if (args.write) {
    writeFileSync(baselinePath, JSON.stringify({ "//": BASELINE_HEADER, entries: actual }, null, 2) + "\n");
    console.log(`✍️  Wrote ${actual.length} identity entr${actual.length === 1 ? "y" : "ies"} to ${baselinePath}`);
    return;
  }

  let entries;
  try {
    entries = validateBaseline(JSON.parse(readFileSync(baselinePath, "utf8")), baselinePath);
  } catch (error) {
    console.error(`❌ Cannot read mock-boundary baseline (${baselinePath}): ${error.message}`);
    console.error("   The gate fails closed — fix the baseline, never delete it to pass.");
    process.exit(1);
  }

  const { added, removed } = compareIdentities(actual, entries);

  if (added.length === 0 && removed.length === 0) {
    console.log(`✅ Mock-boundary gate held (${actual.length} frozen store mock(s), none added).`);
    return;
  }

  if (added.length > 0) {
    console.error(`\n❌ ${added.length} test-side store mock(s) NOT in the identity baseline:\n`);
    for (const e of added) console.error(`   ${e.file} — ${e.api} → ${e.target}`);
    console.error(
      "\n   Tests mock boundaries, not app state. Use the real store (setState/reset\n" +
        "   in beforeEach) or an explicit store-factory seam with a recorded reason.\n" +
        "   The baseline ratchets DOWN only — never add an entry to pass.",
    );
  }

  if (removed.length > 0) {
    console.error(`\n❌ ${removed.length} baselined store mock(s) no longer exist — record the win:\n`);
    for (const e of removed) console.error(`   ${e.file} — ${e.api} → ${e.target}`);
    console.error(
      "\n   Delete these entries from scripts/mock-boundaries-baseline.json so the\n" +
        "   improvement cannot silently become headroom for the next regression.",
    );
  }

  process.exit(1);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
