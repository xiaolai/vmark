---
description: Fast audit for small changes - logic, duplication, dead code, refactoring needs, shortcuts
---

## User Input

```text
$ARGUMENTS
```

## Mini Audit Checklist

Use TodoWrite to track progress through these phases:

```
☐ Identify changed files
☐ Dimension 1: Logic & Correctness
☐ Dimension 2: Duplication
☐ Dimension 3: Dead Code
☐ Dimension 4: Refactoring Debt
☐ Dimension 5: Shortcuts & Patches
☐ Generate mini audit report
```

## Model & Settings Selection

Before starting, present the user with choices using `AskUserQuestion`. Ask both questions at once:

**Question 1 — Model:**

| Model | Best for |
|-------|----------|
| `gpt-5.2-codex` | Good balance of speed and quality (Recommended) |
| `gpt-5.3-codex` | Flagship — deepest analysis if you want thoroughness |
| `gpt-5-codex-mini` | Fastest and cheapest for trivial changes |

**Question 2 — Reasoning effort:**

| Level | Best for |
|-------|----------|
| `medium` | Standard mini-audit — fast with good coverage (Recommended) |
| `high` | Thorough scan — slower but catches more |
| `low` | Quick surface-level check |

## Delegation Strategy

**Prefer Codex MCP** for per-file analysis when available:
1. Use `ToolSearch` with query `+codex` to discover the Codex MCP tool
2. **Availability test** — send a short ping:
   ```
   mcp__codex__codex with:
     prompt: "Respond with 'ok' if you can read this."
     model: {chosen_model}
     model_reasoning_effort: {chosen_effort}
   ```
   If Codex does not respond or errors out, skip to **Phase 4: Fallback** immediately. Do not retry.
3. If available, delegate per-file audits to Codex (run SEQUENTIALLY — one at a time)
4. If Codex returns empty, perform the audit manually using Read/Grep

All Codex calls must use `model: {chosen_model}`, `model_reasoning_effort: {chosen_effort}`, `sandbox: read-only`, and `approval-policy: never`.

### Phase 1: Identify Scope

Parse `$ARGUMENTS` to determine scope:
| Input | Scope |
|-------|-------|
| (empty) | Uncommitted changes (`git diff HEAD --name-only`) |
| `staged` | Staged changes only (`git diff --cached --name-only`) |
| `commit -1` | Last commit (`git diff HEAD~1 --name-only`) |
| `commit -N` | Last N commits (`git diff HEAD~N --name-only`) |
| `path/to/file` | Specific file or directory |

**Skip if no changes**: If scope is empty (no changed files), respond:
```
No changes detected in scope.
Nothing to audit.
```
And STOP.

### Phase 2: Audit All 5 Dimensions

For each changed file, analyze:

**Dimension 1: Logic & Correctness**
- Race conditions: shared state, async operations, concurrent access
- Edge cases: null/undefined, empty arrays, boundary values
- Off-by-one errors: loop bounds, array indices
- Async issues: missing await, unhandled promises, stale closures
- VMark-specific: Zustand `getState()` stale reads, missing hook cleanup

**Dimension 2: Duplication**
- Copy-paste code: similar blocks that should be unified
- Repeated patterns: logic that appears multiple times
- Near-duplicates: functions that differ by 1-2 lines

**Dimension 3: Dead Code**
- Unused imports: modules imported but never used
- Unreachable branches: conditions that can never be true
- Commented-out code: old code left as comments
- Unused variables: declared but never read
- Orphaned functions: defined but never called

**Dimension 4: Refactoring Debt**
- Long functions: >30 lines that should be split
- Deep nesting: >3 levels of if/loop/try
- Unclear names: vague variable/function names
- Files >300 lines (VMark convention)
- Missing abstractions: inline logic that deserves a function

**Dimension 5: Shortcuts & Patches**
- TODOs left behind: unfinished work markers
- Hardcoded values: magic numbers, inline color strings, hardcoded ports
- Workarounds: code comments mentioning 'hack', 'workaround', 'temporary'
- Incomplete error handling: empty catch, swallowed errors, `error as Error`
- Quick fixes: patches that don't address root cause

Report each issue as: `file:line | dimension | severity(High/Medium/Low) | issue | fix`

Skip non-code files (*.md, *.json, *.yaml, *.css, images) unless specifically requested.

### Phase 3: Generate Report

After all audits complete, compile findings:

```markdown
# Mini Audit Report

**Date**: {today}
**Scope**: {what was audited}
**Files**: {count}
**Model**: {chosen_model} | **Effort**: {chosen_effort}
**Verdict**: CLEAN / NEEDS ATTENTION / NEEDS WORK

## Findings

| File:Line | Dim | Severity | Issue | Fix |
|-----------|-----|----------|-------|-----|
| {file}:{line} | {1-5} | High/Med/Low | {description} | {suggestion} |

## Summary by Dimension

| Dimension | High | Medium | Low |
|-----------|------|--------|-----|
| 1. Logic & Correctness | X | X | X |
| 2. Duplication | X | X | X |
| 3. Dead Code | X | X | X |
| 4. Refactoring Debt | X | X | X |
| 5. Shortcuts & Patches | X | X | X |

## Action Items

1. **[High]** {action} - {file:line}
2. **[Medium]** {action} - {file:line}

## Notes

- For security/performance/dependency audits, run `/project:codex-audit --full`
- For verification after fixes, run `/project:codex-verify`
```

### Phase 4: Fallback — Manual Audit

**CRITICAL**: If Codex returns empty/no findings, you MUST perform the audit manually.

When Codex returns nothing:

1. **Read each changed file** using the Read tool
2. **Analyze all 5 dimensions** as described above
3. **Use Grep** to search for common issues:
   ```
   # Dimension 3: Dead code markers
   grep -rn "TODO|FIXME|HACK|XXX" {files}

   # Dimension 5: Shortcut indicators
   grep -rn "workaround|temporary|quick fix|DEPRECATED" {files}
   ```
4. **Report findings** in the same format as Phase 3

**Do NOT say "Codex didn't return findings" and stop. Always complete the audit manually if Codex fails.**

### When to Use Full Audit Instead

Use `/project:codex-audit` instead of `/project:codex-audit-mini` when:
- Auditing security-sensitive code (auth, IPC, MCP bridge)
- Reviewing dependencies or third-party integrations
- Checking performance-critical paths
- Changes span >10 files
