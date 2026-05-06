#!/usr/bin/env node
//
// PreToolUse hook: scoped TDD guard for the Multi-Format Workspace
// rebrand (Phase 1A onwards). Blocks Write/Edit on production source
// files unless tests exist (sibling .test.ts(x) for JS/TS, inline
// #[cfg(test)] mod tests for Rust).
//
// Scope (per dev-docs/plans/20260506-multi-format-rebrand.md
// Verification gates → TDD hook):
//
//   Frontend (sibling .test.ts(x) required):
//     src/lib/formats/**
//     src/components/Editor/SplitPaneEditor/**
//     src/components/Editor/Editor.tsx
//     src/components/Editor/SourceEditor.tsx
//     src/hooks/useFileOpen.ts
//     src/hooks/useFileSave.ts
//     src/hooks/useDragDropOpen.ts
//     src/hooks/useFinderFileOpen.ts
//     src/hooks/useRecentFilesMenuEvents.ts
//     src/hooks/closeSave.ts
//     src/hooks/useExternalFileChanges.ts
//     src/stores/tabStore.ts
//     src/stores/contentSearchStore.ts
//     src/utils/dropPaths.ts
//     src/utils/newFile.ts
//     src/utils/macQuarantineNotice.ts
//     src/utils/yamlOpenRouting.ts  (until WI-2.6 deletes it)
//
//   Rust (inline #[cfg(test)] required — whole-file scope per
//   plan: granular-function scoping not supported by current model):
//     src-tauri/src/lib.rs
//     src-tauri/src/window_manager.rs
//     src-tauri/src/quarantine.rs
//
// Allow-list within scope (no test required):
//   - *.test.ts(x), *.test.rs
//   - types.ts, *.d.ts
//   - *.css
//
// Exit codes:
//   0 — allow
//   2 — block; stderr is shown to the agent

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch (e) {
  process.exit(0);
}

const tool = payload.tool_name ?? payload.toolName ?? "";
const input = payload.tool_input ?? payload.toolInput ?? {};
const filePath = input.file_path ?? input.filePath ?? "";

if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
  process.exit(0);
}
if (!filePath || typeof filePath !== "string") {
  process.exit(0);
}

const abs = resolve(filePath);
const repoRoot = resolve(import.meta.dirname, "..", "..");
const rel = abs.startsWith(repoRoot + "/") ? abs.slice(repoRoot.length + 1) : abs;

// ── Frontend scope ──────────────────────────────────────────────────────
const FRONTEND_SCOPED = [
  /^src\/lib\/formats\/.*\.tsx?$/,
  /^src\/components\/Editor\/SplitPaneEditor\/.*\.tsx?$/,
  /^src\/components\/Editor\/Editor\.tsx$/,
  /^src\/components\/Editor\/SourceEditor\.tsx$/,
  /^src\/hooks\/useFileOpen\.ts$/,
  /^src\/hooks\/useFileSave\.ts$/,
  /^src\/hooks\/useDragDropOpen\.ts$/,
  /^src\/hooks\/useFinderFileOpen\.ts$/,
  /^src\/hooks\/useRecentFilesMenuEvents\.ts$/,
  /^src\/hooks\/closeSave\.ts$/,
  /^src\/hooks\/useExternalFileChanges\.ts$/,
  /^src\/stores\/tabStore\.ts$/,
  /^src\/stores\/contentSearchStore\.ts$/,
  /^src\/utils\/dropPaths\.ts$/,
  /^src\/utils\/newFile\.ts$/,
  /^src\/utils\/macQuarantineNotice\.ts$/,
  /^src\/utils\/yamlOpenRouting\.ts$/,
];

// ── Rust scope ──────────────────────────────────────────────────────────
const RUST_SCOPED = [
  /^src-tauri\/src\/lib\.rs$/,
  /^src-tauri\/src\/window_manager\.rs$/,
  /^src-tauri\/src\/quarantine\.rs$/,
];

const inFrontendScope = FRONTEND_SCOPED.some((re) => re.test(rel));
const inRustScope = RUST_SCOPED.some((re) => re.test(rel));

if (!inFrontendScope && !inRustScope) {
  process.exit(0);
}

// ── Allow-list within scope ─────────────────────────────────────────────
const base = basename(rel);
if (/\.test\.(ts|tsx|rs)$/.test(base)) process.exit(0);
if (base === "types.ts" || base === "types.tsx") process.exit(0);
if (base.endsWith(".d.ts")) process.exit(0);
if (base.endsWith(".css")) process.exit(0);

// ── Frontend: sibling test file check ───────────────────────────────────
if (inFrontendScope) {
  const dir = dirname(abs);
  const ext = extname(base);
  const stem = base.slice(0, -ext.length);
  const candidates = [
    `${dir}/${stem}.test.ts`,
    `${dir}/${stem}.test.tsx`,
    `${dir}/__tests__/${stem}.test.ts`,
    `${dir}/__tests__/${stem}.test.tsx`,
  ];
  const found = candidates.find((p) => existsSync(p));
  if (found) process.exit(0);

  const msg = [
    "",
    "  TDD gate (multi-format-tdd-guard): no test file found for this source.",
    "",
    `  Source:    ${rel}`,
    "  Expected one of:",
    ...candidates.map((p) => `    - ${p.replace(repoRoot + "/", "")}`),
    "",
    "  Per .claude/rules/10-tdd.md, RED comes before GREEN.",
    "  Write the failing test first, then this hook will allow the source edit.",
    "",
    "  Scope: multi-format rebrand (dev-docs/plans/20260506-multi-format-rebrand.md).",
    "",
  ].join("\n");
  process.stderr.write(msg);
  process.exit(2);
}

// ── Rust: inline #[cfg(test)] check ────────────────────────────────────
if (inRustScope) {
  // Read existing file (if it exists). If creating new, treat as "no tests".
  let content = "";
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    // New file — block; expect tests in same edit.
  }
  // Heuristic: the file has any `#[cfg(...test...)]` attribute, which
  // covers `#[cfg(test)]`, `#[cfg(all(test, target_os = ...))]`, etc.
  // (a single regex can't reliably balance nested parens; this looser
  // form just looks for the substring `cfg(` followed by `test` on the
  // same line). Whole-file scope per plan; function-level scoping is
  // out of scope for v1 of this guard.
  if (/#\[cfg\([^\]]*\btest\b[^\]]*\)\]/.test(content)) process.exit(0);

  const msg = [
    "",
    "  TDD gate (multi-format-tdd-guard): no #[cfg(test)] block in this Rust file.",
    "",
    `  Source:    ${rel}`,
    "",
    "  Per .claude/rules/10-tdd.md, RED comes before GREEN.",
    "  Add an inline `#[cfg(test)] mod tests { ... }` with a failing test before",
    "  modifying production code in this file.",
    "",
    "  Scope: multi-format rebrand (dev-docs/plans/20260506-multi-format-rebrand.md).",
    "  Note: this guard uses whole-file scope — once the file has any test block,",
    "  individual edits are allowed.",
    "",
  ].join("\n");
  process.stderr.write(msg);
  process.exit(2);
}

process.exit(0);
