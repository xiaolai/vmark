#!/usr/bin/env node
//
// PreToolUse hook: scoped TDD guard. Blocks Write/Edit on production source
// files unless a sibling test file already exists (RED before GREEN).
//
// Enforced feature scopes (see .claude/rules/60-ai-governance.md §5):
//
//   GitHub Actions workflow viewer
//     - src/lib/ghaWorkflow/**/*.{ts,tsx}
//     - src/lib/workflowRouting/**/*.{ts,tsx}
//     - src/components/Editor/WorkflowPanel/**/*.{ts,tsx}
//     - src/components/Editor/WorkflowEditor/**/*.{ts,tsx}
//     - src/plugins/githubWorkflow/**/*.{ts,tsx}
//     - src/stores/workflowViewStore.ts
//     - src/stores/workflowEditStore.ts
//
//   Embedded browser / site plugins / web workflows
//   (dev-docs/plans/20260712-0610-embedded-browser-*.md §13)
//     - src/lib/browser/**/*.{ts,tsx}
//     - src/lib/sites/**/*.{ts,tsx}
//     - src/components/Browser/**/*.{ts,tsx}
//     - src/services/browser/**/*.{ts,tsx}
//     - src/stores/browserStore.ts
//     - src/stores/webWorkflowStore.ts
//     - src/stores/browserApprovalStore.ts
//
// Behavior for a Write/Edit/MultiEdit targeting a file in scope:
//   - If the file is itself a *.test.ts(x), allow (we're writing tests).
//   - If the file is type-only (types.ts, *.d.ts) or CSS, allow.
//   - Otherwise require a sibling *.test.ts(x) to exist; BLOCK if it does not.
//
// This is a structural test, not a "is the test currently failing" test.
//
// Hook input (Claude Code passes JSON on stdin):
//   { tool_name, tool_input: { file_path, ... }, ... }
//
// Exit codes (Claude Code convention):
//   0 — allow
//   2 — block; stderr is shown to the agent
//
// This hook FAILS CLOSED: if the payload cannot be read or parsed we cannot
// know whether the edit is in scope, so we block (exit 2) rather than wave it
// through. A silently-disabled TDD gate is worse than a noisy one — see
// .claude/rules/60-ai-governance.md §9 ("don't bypass; ask").

import { readFileSync, statSync, realpathSync } from "node:fs";
import { resolve, relative, dirname, basename, extname, join, sep } from "node:path";

/** Resolve symlinks when the path exists; fall back to the lexical path. */
function realish(p) {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

// Realpath the root: on macOS a repo reached through a symlinked prefix (e.g.
// /var -> /private/var) would otherwise fail the containment check below and
// silently skip the guard.
const repoRoot = realish(resolve(import.meta.dirname, "..", ".."));

/** Block the tool call and show `lines` to the agent. */
function block(lines) {
  process.stderr.write(["", ...lines, ""].join("\n"));
  process.exit(2);
}

// ── Read JSON from stdin (fail closed) ──────────────────────────────────
let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  block([
    "  TDD gate (gha-tdd-guard): could not read or parse the hook payload.",
    "",
    "  Failing closed: without the payload the guard cannot tell whether this",
    "  edit touches a TDD-scoped path, and a silently-disabled gate is worse",
    "  than a blocked edit. Fix the hook rather than bypassing it",
    "  (.claude/rules/60-ai-governance.md §9).",
  ]);
}

if (typeof payload !== "object" || payload === null) {
  block([
    "  TDD gate (gha-tdd-guard): hook payload was not a JSON object.",
    "",
    "  Failing closed — see .claude/rules/60-ai-governance.md §9.",
  ]);
}

const tool = payload.tool_name ?? payload.toolName ?? "";
const input = payload.tool_input ?? payload.toolInput ?? {};
const filePath = input?.file_path ?? input?.filePath ?? "";

// Only relevant for Write / Edit / MultiEdit on filesystem paths.
if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
  process.exit(0);
}
if (!filePath || typeof filePath !== "string") {
  process.exit(0);
}

// Resolve against the repo root, not process.cwd(): Claude Code normally sends
// an absolute path (resolve() then ignores the base), but a relative path must
// not be interpreted against whatever directory the agent happens to run from.
// Realpath the parent (the file itself may not exist yet on a Write) so a
// symlinked path still lands inside repoRoot.
const lexical = resolve(repoRoot, filePath);
const abs = join(realish(dirname(lexical)), basename(lexical));

// Path relative to the repo root, with separators normalized to "/" so the
// scope patterns below match on Windows too. A hardcoded "/" here silently
// disabled the entire guard on Windows, where resolve() yields "\" separators.
const rel = relative(repoRoot, abs).split(sep).join("/");

// Outside the repository (relative() yields a leading "..") — not our business.
if (rel.startsWith("../")) {
  process.exit(0);
}

// ── Scope check ─────────────────────────────────────────────────────────
const SCOPED = [
  /^src\/lib\/ghaWorkflow\/.*\.tsx?$/,
  /^src\/lib\/workflowRouting\/.*\.tsx?$/,
  /^src\/components\/Editor\/WorkflowPanel\/.*\.tsx?$/,
  /^src\/components\/Editor\/WorkflowEditor\/.*\.tsx?$/,
  /^src\/plugins\/githubWorkflow\/.*\.tsx?$/,
  /^src\/stores\/workflowViewStore\.ts$/,
  /^src\/stores\/workflowEditStore\.ts$/,
  // Embedded-browser feature (dev-docs/plans/20260712-0610-embedded-browser-*.md §13)
  /^src\/lib\/browser\/.*\.tsx?$/,
  /^src\/lib\/sites\/.*\.tsx?$/,
  /^src\/components\/Browser\/.*\.tsx?$/,
  /^src\/services\/browser\/.*\.tsx?$/,
  /^src\/stores\/browserStore\.ts$/,
  /^src\/stores\/webWorkflowStore\.ts$/,
  /^src\/stores\/browserApprovalStore\.ts$/,
];

if (!SCOPED.some((re) => re.test(rel))) {
  process.exit(0);
}

// ── Allow-list within scope ─────────────────────────────────────────────
// Mirrors the allow-list documented in .claude/rules/60-ai-governance.md §5:
//   *.test.ts(x), types.ts, *.d.ts, *.css
const base = basename(rel);

if (/\.test\.(ts|tsx)$/.test(base)) process.exit(0);
if (base === "types.ts") process.exit(0);
if (base.endsWith(".d.ts")) process.exit(0);
// Defensive: the scope patterns above only admit .ts/.tsx today, so this is
// unreachable — but it keeps the code honest to the documented allow-list if a
// scope is ever widened to cover a feature's stylesheet.
if (base.endsWith(".css")) process.exit(0);

// ── Sibling test existence check ────────────────────────────────────────
const dir = dirname(abs);
const ext = extname(base); // ".ts" or ".tsx"
const stem = base.slice(0, -ext.length); // basename minus extension

// Two acceptable test locations:
//   1. Sibling in same directory: foo.test.ts(x) next to foo.ts(x)
//   2. __tests__/foo.test.ts(x) within the same directory
const candidates = [
  `${dir}/${stem}.test.ts`,
  `${dir}/${stem}.test.tsx`,
  `${dir}/__tests__/${stem}.test.ts`,
  `${dir}/__tests__/${stem}.test.tsx`,
];

// isFile(), not existsSync(): a *directory* named foo.test.ts must not satisfy
// the gate.
const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

if (candidates.some(isFile)) process.exit(0);

// ── Block ───────────────────────────────────────────────────────────────
block([
  "  TDD gate (gha-tdd-guard): no test file found for this source.",
  "",
  `  Source:    ${rel}`,
  "  Expected one of:",
  ...candidates.map((p) => `    - ${relative(repoRoot, p).split(sep).join("/")}`),
  "",
  "  Per .claude/rules/10-tdd.md, RED comes before GREEN.",
  "  Write the failing test first, then this hook will allow the source edit.",
  "",
  "  This guard is scoped to the GHA workflow viewer and embedded browser",
  "  feature paths only (.claude/rules/60-ai-governance.md §5). Other VMark",
  "  code is not affected.",
]);
