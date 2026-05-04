#!/usr/bin/env node
//
// PreToolUse hook: scoped TDD guard for the GitHub Actions Workflow Viewer
// feature. Blocks Write/Edit on production source files unless a sibling
// .test.ts exists.
//
// Scope (intentionally narrow to avoid disrupting existing VMark workflow):
//   - src/lib/ghaWorkflow/**/*.ts
//   - src/lib/workflowRouting/**/*.ts
//   - src/components/Editor/WorkflowPanel/**/*.{ts,tsx}
//   - src/components/Editor/WorkflowEditor/**/*.{ts,tsx}
//   - src/plugins/githubWorkflow/**/*.ts
//   - src/stores/workflowViewStore.ts
//   - src/stores/workflowEditStore.ts
//
// Behavior:
//   - For a Write/Edit/MultiEdit targeting a file in scope:
//     - If the file is itself a *.test.ts(x), allow (we're writing tests).
//     - If the file is a type-only file (types.ts, *.d.ts), allow.
//     - Otherwise: require a sibling *.test.ts(x) to exist.
//       - If sibling does not exist, BLOCK with exit 2 and a clear message.
//       - If sibling exists, allow.
//
// This is a structural test, not a "is the test currently failing" test.
// Phase 1+ work items can layer on a stricter check (run vitest, look for
// at least one fail, block if none) once Phase 1 ships and tests exist.
//
// Reading the hook input (Claude Code passes JSON on stdin):
//   { tool_name, tool_input: { file_path, ... }, ... }
//
// Exit codes (Claude Code convention):
//   0 — allow
//   2 — block; stderr is shown to the agent
//   other — error; advisory, does not block

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";

// ── Read JSON from stdin ────────────────────────────────────────────────
let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch (e) {
  // Cannot parse — let the tool call through; this hook is advisory then.
  process.exit(0);
}

const tool = payload.tool_name ?? payload.toolName ?? "";
const input = payload.tool_input ?? payload.toolInput ?? {};
const filePath = input.file_path ?? input.filePath ?? "";

// Only relevant for Write / Edit / MultiEdit on filesystem paths.
if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
  process.exit(0);
}
if (!filePath || typeof filePath !== "string") {
  process.exit(0);
}

const abs = resolve(filePath);
const repoRoot = resolve(import.meta.dirname, "..", "..");

// Convert to a path relative to repo root for scope matching.
const rel = abs.startsWith(repoRoot + "/") ? abs.slice(repoRoot.length + 1) : abs;

// ── Scope check ─────────────────────────────────────────────────────────
const SCOPED = [
  /^src\/lib\/ghaWorkflow\/.*\.tsx?$/,
  /^src\/lib\/workflowRouting\/.*\.tsx?$/,
  /^src\/components\/Editor\/WorkflowPanel\/.*\.tsx?$/,
  /^src\/components\/Editor\/WorkflowEditor\/.*\.tsx?$/,
  /^src\/plugins\/githubWorkflow\/.*\.tsx?$/,
  /^src\/stores\/workflowViewStore\.ts$/,
  /^src\/stores\/workflowEditStore\.ts$/,
];

const inScope = SCOPED.some((re) => re.test(rel));
if (!inScope) {
  process.exit(0);
}

// ── Allow-list within scope ─────────────────────────────────────────────
//   - Test files themselves
//   - Type-only files (types.ts, *.d.ts)
//   - index.ts barrel files (often only re-exports; defer to consuming files)
const base = basename(rel);

// Explicit test file — always allow.
if (/\.test\.(ts|tsx)$/.test(base)) process.exit(0);

// Type-only allowance.
if (base === "types.ts" || base === "types.tsx") process.exit(0);
if (base.endsWith(".d.ts")) process.exit(0);

// CSS files — no test required.
if (base.endsWith(".css")) process.exit(0);

// ── Sibling test existence check ────────────────────────────────────────
const dir = dirname(abs);
const ext = extname(base);                    // ".ts" or ".tsx"
const stem = base.slice(0, -ext.length);      // basename minus extension

// Two acceptable test locations:
//   1. Sibling in same directory: foo.test.ts(x) next to foo.ts(x)
//   2. __tests__/foo.test.ts(x) within the same directory
const candidates = [
  `${dir}/${stem}.test.ts`,
  `${dir}/${stem}.test.tsx`,
  `${dir}/__tests__/${stem}.test.ts`,
  `${dir}/__tests__/${stem}.test.tsx`,
];

const found = candidates.find((p) => existsSync(p));
if (found) process.exit(0);

// ── Block ───────────────────────────────────────────────────────────────
const msg = [
  "",
  "  TDD gate (gha-tdd-guard): no test file found for this source.",
  "",
  `  Source:    ${rel}`,
  "  Expected one of:",
  ...candidates.map((p) => `    - ${p.replace(repoRoot + "/", "")}`),
  "",
  "  Per .claude/rules/10-tdd.md, RED comes before GREEN.",
  "  Write the failing test first, then this hook will allow the source edit.",
  "",
  "  This guard is scoped to the GHA workflow viewer feature paths only.",
  "  Other VMark code is not affected.",
  "",
].join("\n");

process.stderr.write(msg);
process.exit(2);
