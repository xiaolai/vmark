---
description: Fast audit for small changes - logic, duplication, dead code, refactoring needs, shortcuts
argument-hint: "[file-or-dir] [commit -N]"
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
☐ Dimension 6: Code Comments
☐ Generate mini audit report
```

## Model & Settings Selection

Follow the instructions in `commands/_model-selection.md` to discover available models and present choices.

- **Recommended model**: `gpt-5.2-codex`
- **Recommended reasoning effort**: `medium`
- **Include sandbox question**: No (mini-audits always use `read-only`)

## Audit Strategy

**IMPORTANT**: Run Codex calls SEQUENTIALLY (one at a time) to avoid timeouts.

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

### Phase 2: Audit All 6 Dimensions

**Availability test** — before the real audit, send a short ping to Codex:
```
mcp__codex__codex with:
  prompt: "Respond with 'ok' if you can read this."
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
```
If Codex does not respond or errors out, skip to **Phase 4: Fallback** immediately. Do not retry.

For each changed file, run Codex with focused prompt:

```
mcp__codex__codex with:
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
  sandbox: read-only
  approval-policy: never
  developer-instructions: "You are a fast code quality reviewer focused on logic, duplication, and dead code."
  prompt: "Mini audit {filename} - focus on code quality for small changes:

    **Dimension 1: Logic & Correctness**
    - Race conditions: shared state, async operations, concurrent access
    - Edge cases: null/undefined, empty arrays, boundary values
    - Off-by-one errors: loop bounds, array indices
    - Async issues: missing await, unhandled promises, callback hell
    - State mutations: unexpected side effects, stale closures

    **Dimension 2: Duplication**
    - Copy-paste code: similar blocks that should be unified
    - Repeated patterns: logic that appears multiple times
    - DRY violations: same calculation/check in multiple places
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
    - Missing abstractions: inline logic that deserves a function
    - God objects: classes/objects doing too many things

    **Dimension 5: Shortcuts & Patches**
    - TODOs left behind: unfinished work markers
    - Hardcoded values: magic numbers, inline strings
    - Workarounds: code comments mentioning 'hack', 'workaround', 'temporary'
    - Incomplete error handling: empty catch, swallowed errors
    - Quick fixes: patches that don't address root cause
    - Backward-compat shims: code kept 'just in case'

    **Dimension 6: Code Comments**
    - Missing file headers: .ts/.tsx source files without a Purpose: line in header block
    - Stale comments: doc comments or inline comments that don't match current code behavior
    - Misleading docs: function/class documentation that describes different behavior than implementation
    - Missing function docs: exported functions without any doc comment
    - Orphaned TODOs: TODO/FIXME/HACK without actionable description

    Report each issue as: file:line | dimension | severity(High/Medium/Low) | issue | fix"
```

**Wait for each Codex call to complete before starting the next one.**

Skip non-code files (*.md, *.json, *.yaml, *.css, images) unless specifically requested.

### Phase 3: Generate Report

After all audits complete, compile findings:

```markdown
# Mini Audit Report

**Date**: {today}
**Scope**: {what was audited}
**Files**: {count}
**Model**: {chosen_model} | **Effort**: {chosen_effort}
**Thread ID**: `{threadId}` _(use `/codex-continue {threadId}` to iterate on findings)_
**Verdict**: CLEAN / NEEDS ATTENTION / NEEDS WORK

## Findings

| File:Line | Dim | Severity | Issue | Fix |
|-----------|-----|----------|-------|-----|
| {file}:{line} | {1-6} | High/Med/Low | {description} | {suggestion} |

## Summary by Dimension

| Dimension | High | Medium | Low |
|-----------|------|--------|-----|
| 1. Logic & Correctness | X | X | X |
| 2. Duplication | X | X | X |
| 3. Dead Code | X | X | X |
| 4. Refactoring Debt | X | X | X |
| 5. Shortcuts & Patches | X | X | X |
| 6. Code Comments | X | X | X |

## Action Items

1. **[High]** {action} - {file:line}
2. **[Medium]** {action} - {file:line}
3. ...

## Notes

- For security/performance/dependency audits, run `/codex-audit --full`
- For verification after fixes, run `/codex-verify`
```

### Phase 4: Fallback - Manual Audit

**CRITICAL**: If Codex returns empty/no findings, you MUST perform the audit manually.

When Codex returns nothing:

1. **Read each changed file** using the Read tool
2. **Analyze all 6 dimensions** as described above
3. **Use Grep** to search for common issues:
   ```bash
   # Dimension 3: Dead code markers
   grep -rn "TODO\|FIXME\|HACK\|XXX" {files}

   # Dimension 5: Shortcut indicators
   grep -rn "workaround\|temporary\|quick fix\|DEPRECATED" {files}

   # Dimension 3: Commented code (lines starting with //)
   grep -rn "^[[:space:]]*//.*[{};]" {files}
   ```

4. **Report findings** in the same format as Phase 3

**Do NOT say "Codex didn't return findings" and stop. Always complete the audit manually if Codex fails.**

### Example Execution

```
1. User picks model + effort level
2. Parse arguments: (empty) → git diff HEAD --name-only → [file1.ts, file2.ts]
3. Create todo list with 7 phases
4. Mark "Identify changed files" complete
5. Run Codex for file1.ts covering all 6 dimensions
6. If Codex empty → Read file1.ts and analyze manually
7. Repeat for file2.ts
8. Mark each dimension complete as findings accumulate
9. Compile mini audit report
10. Mark "Generate report" complete
```

### When to Use Full Audit Instead

Use `/codex-audit` instead of `/codex-audit-mini` when:
- Auditing security-sensitive code (auth, payments, crypto)
- Reviewing dependencies or third-party integrations
- Checking performance-critical paths
- Auditing documentation or API contracts
- Running compliance checks
- Running a deep comment compliance audit (full audit has 10 sub-checks vs mini's 5)
- Changes span >10 files
