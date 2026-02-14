---
description: Audit→fix→verify loop — finds issues, fixes them, verifies fixes, repeats until clean or you stop
argument-hint: "[scope] [--full | --mini]"
---

## User Input

```text
$ARGUMENTS
```

## What This Does

Runs a complete audit→fix→verify cycle:

1. **Audit** — find issues (full 9-dimension or mini 5-dimension)
2. **Fix** — send findings to Codex to fix them autonomously
3. **Verify** — check that each fix actually resolved the issue
4. **Repeat** — if issues remain, loop back to fix

Continues until all issues are resolved or the user decides to stop.

## Model & Settings Selection

Follow the instructions in `commands/_model-selection.md` to discover available models and present choices.

- **Recommended model**: `gpt-5.3-codex`
- **Recommended reasoning effort**: `high`
- **Recommended sandbox level**: `workspace-write`
- **Include sandbox question**: Yes (fixes require write access)

## Workflow

### Step 1: Determine audit type and scope

Parse `$ARGUMENTS`:

| Input | Interpretation |
|-------|----------------|
| (empty) | Mini audit on uncommitted changes |
| `--full` | Full 9-dimension audit on uncommitted changes |
| `--mini` | Mini 5-dimension audit (explicit, same as default) |
| `--full path/to/dir` | Full audit on specific path |
| `path/to/file` | Mini audit on specific file/directory |
| `commit -N` | Mini audit on last N commits |
| `--full commit -N` | Full audit on last N commits |

If scope is empty (no changes), tell the user and STOP.

Ask the user to confirm:

```
AskUserQuestion:
  question: "Which audit depth?"
  header: "Audit type"
  options:
    - label: "Mini (5 dimensions) (Recommended)"
      description: "Logic, duplication, dead code, refactoring debt, shortcuts — fast"
    - label: "Full (9 dimensions)"
      description: "Adds security, performance, compliance, dependencies, documentation — thorough"
```

### Step 2: Run initial audit

**Availability test** — ping Codex first:
```
mcp__codex__codex with:
  prompt: "Respond with 'ok' if you can read this."
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
```
If Codex does not respond, fall back to manual audit and STOP (no fix loop without Codex).

Run the audit using the appropriate prompt from `codex-audit.md` (full) or `codex-audit-mini.md` (mini). For each file in scope:

```
mcp__codex__codex with:
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
  sandbox: read-only
  approval-policy: never
  developer-instructions: "You are a thorough code auditor. Report every issue with exact file:line locations."
  prompt: "{audit prompt for the chosen audit type, per file}"
```

**Wait for each call to complete before the next.**

Collect all findings into a structured audit report (same format as codex-audit or codex-audit-mini).

Display the report to the user.

If **no issues found** → report CLEAN and STOP.

### Step 3: Fix loop

**IMPORTANT**: Maximum **3 iterations** of the fix→verify cycle. After 3 rounds, stop and report remaining issues regardless.

Set `iteration = 1`.

#### 3a: Ask before fixing

Show the findings summary and ask:

For a **full audit** (has Critical severity):
```
AskUserQuestion:
  question: "Found {N} issues ({critical} Critical, {high} High, {medium} Medium, {low} Low). Fix them?"
  header: "Fix"
  options:
    - label: "Fix all (Recommended)"
      description: "Send all findings to Codex for autonomous fixing"
    - label: "Fix Critical + High only"
      description: "Only fix Critical and High severity issues"
    - label: "Stop here"
      description: "Keep the audit report, fix manually"
```

For a **mini audit** (no Critical severity — uses High/Medium/Low only):
```
AskUserQuestion:
  question: "Found {N} issues ({high} High, {medium} Medium, {low} Low). Fix them?"
  header: "Fix"
  options:
    - label: "Fix all (Recommended)"
      description: "Send all findings to Codex for autonomous fixing"
    - label: "Fix High only"
      description: "Only fix High severity issues"
    - label: "Stop here"
      description: "Keep the audit report, fix manually"
```

If "Stop here" → display final report and STOP.

#### 3b: Send fixes to Codex

```
mcp__codex__codex with:
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
  sandbox: {chosen_sandbox}
  approval-policy: never
  developer-instructions: "You are an autonomous code fixer. Fix every issue precisely at the reported location. Do not introduce new issues."
  prompt: "Fix the following issues found during code audit. For each issue, make the minimal correct fix at the exact file:line location.

ISSUES TO FIX:
{filtered findings in file:line | severity | issue | fix format}

RULES:
- Fix each issue at the exact location reported
- Make minimal, targeted changes — do not refactor surrounding code
- If a fix requires changing multiple related locations, fix all of them
- Do not delete code unless the issue specifically calls for removal (dead code, unused imports)
- After fixing all issues, run any available tests to check for regressions
- Report: what you fixed, what you couldn't fix, and any test results"
```

**Wait for Codex to complete.**

Display a summary of what Codex changed:
- Run `git diff --stat` to show modified files
- Show Codex's fix report

#### 3c: Verify fixes

Run verification using the same approach as `codex-verify.md`:

```
mcp__codex__codex with:
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
  sandbox: read-only
  approval-policy: never
  developer-instructions: "You are a verification auditor. Only check issues from the provided audit report."
  prompt: "Verify whether the following issues have been fixed. Check each file at the exact location.

ORIGINAL ISSUES:
{the issues that were sent for fixing}

For each issue report:
- FIXED — issue resolved properly
- NOT FIXED — issue still present (explain why)
- PARTIAL — partially addressed (explain what remains)
- REGRESSED — fix introduced a new problem (describe it)"
```

**Wait for Codex to complete.**

#### 3d: Evaluate results

Parse verification results:

- **All FIXED** → proceed to Step 4 (success)
- **Some NOT FIXED / PARTIAL / REGRESSED** and `iteration < 3`:
  - Increment `iteration`
  - Show remaining issues to user
  - Ask:
    ```
    AskUserQuestion:
      question: "{remaining} issues remain after round {iteration-1}. Try fixing again?"
      header: "Continue"
      options:
        - label: "Fix remaining issues (Recommended)"
          description: "Send unfixed issues to Codex for another attempt"
        - label: "Stop here"
          description: "Accept current state, fix remaining issues manually"
    ```
  - If "Fix remaining" → go back to **3b** with only the remaining issues
  - If "Stop here" → proceed to Step 4

- **iteration = 3** → proceed to Step 4 with whatever remains

### Step 4: Final report

```markdown
# Audit Fix Report

**Date**: {today}
**Scope**: {what was audited}
**Audit type**: Full (9-dim) / Mini (5-dim)
**Model**: {chosen_model} | **Effort**: {chosen_effort} | **Sandbox**: {chosen_sandbox}
**Thread ID**: `{threadId}` _(use `/codex-continue {threadId}` to iterate further)_
**Rounds**: {iteration count}

## Result: {ACCEPTED / PARTIAL / UNCHANGED}

## Summary

| Status | Count |
|--------|-------|
| Fixed | {n} |
| Not Fixed | {n} |
| Partial | {n} |
| Regressed | {n} |
| Total | {n} |

## Fixed Issues

| File:Line | Severity | Issue | Status |
|-----------|----------|-------|--------|
| {file:line} | {sev} | {issue} | FIXED |

## Remaining Issues (if any)

| File:Line | Severity | Issue | Status | Notes |
|-----------|----------|-------|--------|-------|
| {file:line} | {sev} | {issue} | NOT FIXED | {why} |

## Changes Made

{git diff --stat output}

## Next Steps

- Review changes: `git diff`
- Run tests: {project-appropriate test command}
- Commit: if satisfied with the fixes
- Revert: `git checkout .` to undo all changes
- Continue: `/codex-continue {threadId}` to address remaining issues
```

### Verdicts

- **ACCEPTED** — all issues fixed, verification passed
- **PARTIAL** — some issues fixed, some remain
- **UNCHANGED** — user chose to stop before fixing, or Codex couldn't fix anything
