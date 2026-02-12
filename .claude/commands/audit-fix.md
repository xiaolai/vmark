---
description: Codex audit → fix all → verify → repeat until zero findings
argument-hint: "[scope: empty=uncommitted, commit -N, path]"
---

# Audit-Fix Loop

Minimal audit-fix-verify cycle: Codex audits, Claude fixes everything, Codex verifies. Loops until zero findings remain.

## Input

```text
$ARGUMENTS
```

## Phase 1: Scope

Parse `$ARGUMENTS` to determine what to audit:

| Input | Scope |
|-------|-------|
| (empty) | Uncommitted changes (`git diff HEAD --name-only`) |
| `staged` | Staged changes (`git diff --cached --name-only`) |
| `commit -1` | Last commit (`git diff HEAD~1 --name-only`) |
| `commit -N` | Last N commits (`git diff HEAD~N --name-only`) |
| `path/to/file` | Specific file or directory |

If no changed files found: report "Nothing to audit" and STOP.

## Phase 2: Audit (Codex)

Use `ToolSearch` with query `+codex` to discover Codex MCP tools.

**Audit prompt to `mcp__codex__codex`:**
```
Audit these changed files in the VMark project:
Files: {changed file list}
Diff: {git diff or git diff HEAD~N, as appropriate}
Focus:
1. Correctness & logic — is the code logically sound? No patching around symptoms.
2. Edge cases — boundary conditions, null/empty, Unicode/CJK, concurrent access
3. Security — no vulnerabilities (injection, XSS, path traversal)
4. Duplicate code — copy-paste patterns, repeated logic that should be unified
5. Dead code — unused imports, unreachable branches, orphaned functions
6. Shortcuts & patches — workarounds, TODO markers, band-aids, bypass flags
7. VMark compliance — Zustand selectors (no destructuring), CSS tokens (no hardcoded colors), file size <300 lines
Report EVERY issue as: file:line | severity (Critical/High/Medium/Low) | issue | fix
Be thorough. Do not omit minor issues.
```

### Fallback — manual audit

If Codex MCP is unavailable, perform the audit manually:
1. Read each changed file with the Read tool
2. Analyze all 7 dimensions above
3. Use Grep to search for common issues (unused imports, hardcoded colors, TODO markers, `as Error` casts)
4. Report findings in the same format

## Phase 3: Fix All (Claude)

Fix **every** finding — Critical, High, Medium, and Low. No exceptions, no deferrals, no "noted for later."

Rules:
- Fix the root cause, not the symptom.
- If fixing introduces new code, apply the same 7 audit dimensions to it mentally before moving on.
- Keep diffs minimal and focused.
- Follow project conventions (`.claude/rules/*.md`).

## Phase 4: Verify (Codex)

Use `mcp__codex__codex-reply` on the **same thread** as Phase 2:

```
I fixed these issues: {list of fixes with file:line}
Verify ALL fixes are correct. Check for new issues introduced by the fixes.
The audit passes ONLY when zero findings remain — any severity.
Updated diff: {updated diff}
Be thorough. Report any remaining or newly introduced issues.
```

### Fallback — manual verify

If Codex is unavailable, verify manually:
1. Re-read each fixed file
2. Confirm the original issue is resolved
3. Check for regressions or new issues introduced by the fix
4. Report any remaining findings

## Phase 5: Loop or Exit

```
┌─────────────────────────────────────┐
│ Zero findings? ──YES──→ DONE ✅     │
│       │                             │
│      NO                             │
│       │                             │
│ Iteration < 3? ──YES──→ Phase 3    │
│       │                             │
│      NO                             │
│       │                             │
│    STOP ❌                          │
│    Report remaining issues          │
│    to user. Code is not ready.      │
└─────────────────────────────────────┘
```

- **Zero findings** (all severities): audit passes. Report "Clean" to user.
- **Findings remain** and iteration < 3: go back to Phase 3, fix, then Phase 4 verify again.
- **3 iterations exhausted**: STOP. List all remaining findings. Do not declare clean.

## Phase 6: Gate (optional)

If the loop exited clean, offer to run the full gate:

```bash
pnpm check:all
```

If Rust files were among the changed files:
```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Report pass/fail to user.
