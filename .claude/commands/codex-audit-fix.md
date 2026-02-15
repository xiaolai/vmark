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
2. **Fix** — Claude or Codex fixes the issues (your choice)
3. **Verify** — check that each fix actually resolved the issue
4. **Repeat** — if issues remain, loop back to fix

Continues until all issues are resolved or the user decides to stop.

## Model & Settings Selection

Follow the instructions in `commands/shared/model-selection.md` to discover available models and present choices.

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

### Step 1b: Trivial Scope Check

Before proceeding, analyze the diff to determine if the changes warrant an audit.

**Get the diff**:
- For uncommitted changes: `git diff HEAD`
- For commit ranges: `git diff HEAD~N`
- For specific paths: read the files directly

**Classify as trivial if ALL of the following are true**:
- Total code changes ≤ 5 lines (excluding blank lines and comments)
- Changes are purely mechanical: typo fixes, formatting, whitespace, import reordering, comment edits, version bumps in config files
- No logic, control flow, or data handling changes whatsoever

**NEVER classify as trivial if ANY of these apply**:
- Any change to logic, conditionals, loops, or data flow — even a single character (`>` vs `>=`)
- Files in security-sensitive paths (auth, crypto, permissions, payments, sessions)
- New dependencies added or removed
- Config changes that affect runtime behavior (env vars, feature flags, API endpoints)
- Changes to error handling or validation

**If trivial**:
```
AskUserQuestion:
  question: "This looks like a trivial change ({N} lines — {description, e.g. 'typo fix in comment'}). An audit is unlikely to find anything. Proceed anyway?"
  header: "Scope"
  options:
    - label: "Skip audit (Recommended)"
      description: "Change is too minor to warrant an audit"
    - label: "Audit anyway"
      description: "Run the audit→fix loop regardless"
```

If "Skip audit" → respond with "Scope too trivial for audit — no issues expected." and STOP.

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

**Save the `threadId`** from the audit Codex call as `{audit_threadId}`. This will be reused for fix and verify steps when Codex is the fixer, giving it cumulative context about what it found.

Display the report to the user.

If **no issues found** → report CLEAN and STOP.

### Step 3: Fix loop

**IMPORTANT**: Maximum **3 iterations** of the fix→verify cycle. After 3 rounds, stop and report remaining issues regardless.

Set `iteration = 1`.

#### 3a: Ask before fixing

Show the findings summary and ask two questions:

**Question 1 — Scope** (severity filter):

For a **full audit** (has Critical severity):
```
AskUserQuestion:
  question: "Found {N} issues ({critical} Critical, {high} High, {medium} Medium, {low} Low). Fix them?"
  header: "Fix scope"
  options:
    - label: "Fix all (Recommended)"
      description: "Fix all findings"
    - label: "Fix Critical + High only"
      description: "Only fix Critical and High severity issues"
    - label: "Stop here"
      description: "Keep the audit report, fix manually"
```

For a **mini audit** (no Critical severity — uses High/Medium/Low only):
```
AskUserQuestion:
  question: "Found {N} issues ({high} High, {medium} Medium, {low} Low). Fix them?"
  header: "Fix scope"
  options:
    - label: "Fix all (Recommended)"
      description: "Fix all findings"
    - label: "Fix High only"
      description: "Only fix High severity issues"
    - label: "Stop here"
      description: "Keep the audit report, fix manually"
```

If "Stop here" → display final report and STOP.

**Question 2 — Who fixes**:

```
AskUserQuestion:
  question: "Who should fix these issues?"
  header: "Fixer"
  options:
    - label: "Claude (Recommended)"
      description: "Fix directly using Read/Edit — has full project context, precise edits"
    - label: "Codex"
      description: "Send to Codex for autonomous fixing — sandboxed, isolated"
```

Store the choice as `{chosen_fixer}` for use in 3b.

#### 3b: Fix issues

##### If `{chosen_fixer}` is **Claude**:

Fix each issue directly using Claude's tools:

1. For each issue in the filtered findings list:
   - Read the file at the reported location
   - Understand the surrounding context
   - Apply the minimal correct fix using the Edit tool
   - If a fix requires changing multiple related locations, fix all of them
2. Do NOT refactor surrounding code — only fix what was reported
3. Do NOT delete code unless the issue specifically calls for removal (dead code, unused imports)
4. After fixing all issues, run available tests if the project has them
5. Show a summary of what was fixed

Display a summary of changes:
- Run `git diff --stat` to show modified files
- List each fix applied: file:line, what was changed

##### If `{chosen_fixer}` is **Codex**:

**Reuse the audit thread** via `codex-reply` so Codex has full context of what it found:

```
mcp__codex__codex-reply with:
  threadId: {audit_threadId}
  prompt: "Fix the following issues from your audit. For each issue, make the minimal correct fix at the exact file:line location.

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

**Fallback**: If `codex-reply` fails (e.g. thread expired or MCP server restarted), fall back to a fresh `codex` call:

```
mcp__codex__codex with:
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
  sandbox: {chosen_sandbox}
  approval-policy: never
  developer-instructions: "You are an autonomous code fixer. Fix every issue precisely at the reported location. Do not introduce new issues."
  prompt: "{same prompt as above}"
```

Update `{audit_threadId}` to the new threadId from whichever call succeeded.

**Wait for Codex to complete.**

Display a summary of what Codex changed:
- Run `git diff --stat` to show modified files
- Show Codex's fix report

#### 3c: Verify fixes

**If `{chosen_fixer}` was Codex** — continue the same thread so Codex can verify its own fixes with full context:

```
mcp__codex__codex-reply with:
  threadId: {audit_threadId}
  prompt: "Verify whether the following issues have been fixed. Check each file at the exact location.

ORIGINAL ISSUES:
{the issues that were sent for fixing}

For each issue report:
- FIXED — issue resolved properly
- NOT FIXED — issue still present (explain why)
- PARTIAL — partially addressed (explain what remains)
- REGRESSED — fix introduced a new problem (describe it)"
```

**If `{chosen_fixer}` was Claude** — use a fresh Codex call for independent verification (Claude already applied fixes, Codex verifies with fresh eyes):

```
mcp__codex__codex with:
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
  sandbox: read-only
  approval-policy: never
  developer-instructions: "You are a verification auditor. Only check issues from the provided audit report."
  prompt: "{same verification prompt as above}"
```

Update `{audit_threadId}` if a new thread was created.

**Fallback**: If `codex-reply` fails, fall back to a fresh `codex` call (same as the Claude-fixer path).

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
          description: "Send unfixed issues to {chosen_fixer} for another attempt"
        - label: "Switch fixer"
          description: "Try the other fixer (Claude↔Codex) on remaining issues"
        - label: "Stop here"
          description: "Accept current state, fix remaining issues manually"
    ```
  - If "Fix remaining" → go back to **3b** with only the remaining issues (same fixer)
  - If "Switch fixer" → flip `{chosen_fixer}` (Claude→Codex or Codex→Claude), go back to **3b**
  - If "Stop here" → proceed to Step 4

- **iteration = 3** → proceed to Step 4 with whatever remains

### Step 4: Final report

```markdown
# Audit Fix Report

**Date**: {today}
**Scope**: {what was audited}
**Audit type**: Full (9-dim) / Mini (5-dim)
**Fixer**: {Claude / Codex}
**Model**: {chosen_model} | **Effort**: {chosen_effort} | **Sandbox**: {chosen_sandbox}
**Thread ID**: `{audit_threadId}` _(use `/codex-continue {audit_threadId}` to iterate further — Codex only)_
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
- Continue: `/codex-continue {audit_threadId}` to address remaining issues
```

### Verdicts

- **ACCEPTED** — all issues fixed, verification passed
- **PARTIAL** — some issues fixed, some remain
- **UNCHANGED** — user chose to stop before fixing, or Codex couldn't fix anything
