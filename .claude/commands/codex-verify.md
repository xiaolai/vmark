---
description: Autonomous verification auditor running in isolated context - confirms fixes from previous audit
argument-hint: "<audit-report-file>"
---

## User Input

```text
$ARGUMENTS
```

## Verification Checklist

Use TodoWrite to track progress through these phases:

```
☐ Parse audit report and extract issues
☐ Verify fixes for each dimension found in the audit report
☐ Generate verification report
```

**Note**: The audit report may contain 5 dimensions (mini audit) or 9 dimensions (full audit). Verify only the dimensions that appear in the report — do not assume all 9 are present.

## Model & Settings Selection

Follow the instructions in `commands/_model-selection.md` to discover available models and present choices.

- **Recommended model**: `gpt-5.2-codex`
- **Recommended reasoning effort**: `medium`
- **Include sandbox question**: No (verification always uses `read-only`)

## Execution

**CRITICAL**: This command verifies fixes from a PREVIOUS audit. It does NOT discover new issues.

### Phase 1: Input Parsing

`$ARGUMENTS` should contain or reference the previous audit report:
- If empty: Look for recent `audit-*.md` file in current directory
- If file path: Read that audit report
- If contains "Critical Issues": Use as inline report

### Pre-check

If no audit report found, respond:
```
No previous audit report found.

Options:
1. Run /codex-audit first to generate baseline
2. Provide report: /codex-verify audit-2025-11-18.md
3. Paste inline: /codex-verify [audit report text]
```
And STOP - do not launch Codex.

### Phase 2: Launch Codex via MCP Tool

**Availability test** — before the real verification, send a short ping to Codex:
```
mcp__codex__codex with:
  prompt: "Respond with 'ok' if you can read this."
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
```
If Codex does not respond or errors out, skip to **Phase 4: Fallback** immediately. Do not retry.

If audit report found, use ToolSearch to find and load `mcp__codex__codex`, then call it:

```
mcp__codex__codex with:
  model: {chosen_model}
  config: {"model_reasoning_effort": "{chosen_effort}"}
  sandbox: read-only
  approval-policy: never
  developer-instructions: "You are a verification auditor. Only check issues from a previous audit report."
  prompt: "Your ONLY job is to confirm fixes from a previous audit.

## Previous Audit Report
{AUDIT_REPORT_CONTENT}

## Your Mission

1. **Extract Issue Checklist by Dimension**:
   Parse all issues organized by whatever dimensions appear in the audit report.
   Full audits have 9 dimensions; mini audits have 5. Only verify what's present.

2. **Verify Each Issue**:
   For each issue from the report:
   - Read the file at the exact location
   - Check if the issue still exists
   - Mark status:
     - FIXED - Issue resolved properly
     - NOT FIXED - Issue still present
     - PARTIAL - Partially addressed
     - MOVED - Code relocated, verify new location

3. **Quick Spot Check** (5 min max):
   - Only check files that were modified
   - Look for obvious new problems introduced by fixes
   - DO NOT run comprehensive scan

## Requirements
- ONLY verify issues from the audit report
- Do NOT discover new issues systematically
- Be fast (2-10 minutes)
- Clear pass/fail per issue"
```

**IMPORTANT**: Do NOT use the Task tool with subagent_type "codex" — that agent does not exist. Instead:
1. Use `ToolSearch` with query `select:mcp__codex__codex` to load the Codex MCP tool
2. Call `mcp__codex__codex` directly with the prompt above
3. If Codex needs follow-up, use `mcp__codex__codex-reply`

### Phase 3: Generate Report

```markdown
# Verification Report

**Date**: {today}
**Original Audit**: {audit date/file}
**Model**: {chosen_model} | **Effort**: {chosen_effort}
**Thread ID**: `{threadId}` _(use `/codex-continue {threadId}` to iterate on findings)_
**Status**: PASSED / PARTIAL / FAILED

## Summary by Dimension

| Dimension | Fixed | Not Fixed | Partial | Total |
|-----------|-------|-----------|---------|-------|
| {for each dimension in the audit report} | X | X | X | X |
| **TOTAL** | **X** | **X** | **X** | **X** |

## Verification Details

{For each dimension present in the audit report:}

### {Dimension Name}
| Issue | File:Line | Status | Notes |
|-------|-----------|--------|-------|
| {description} | {file:line} | FIXED/NOT FIXED/PARTIAL | {notes} |

## Remaining Issues (Not Fixed)

| Priority | Dimension | Issue | File:Line |
|----------|-----------|-------|-----------|
| Critical | X | {issue} | {file:line} |
| High | X | {issue} | {file:line} |

## New Issues Introduced (if any)

| Severity | Dimension | Issue | File:Line |
|----------|-----------|-------|-----------|
| ... | ... | ... | ... |

## Verdict

{PASSED / PARTIAL / FAILED}

## Next Steps
{What needs to be done if not passed}
```

### Phase 4: Fallback - Manual Verification

**CRITICAL**: If Codex returns empty/no response, you MUST verify manually using Claude's tools.

When Codex returns nothing:

1. **Parse the audit report** to extract all issues organized by dimension (5 for mini, 9 for full)
2. **Create todo list** with verification tasks for each dimension present in the report
3. **Read each file** at the specified lines
4. **Check if the issue still exists**:
   - Compare current code against the reported issue
   - Mark status: FIXED, NOT FIXED, PARTIAL, MOVED
5. **Mark each dimension complete** as you verify it
6. **Generate the verification report** in the same format as Phase 3

**Do NOT say "Codex didn't return findings" and stop. Always complete verification manually if Codex fails.**

### Example Execution

```
1. User picks model + effort level
2. Parse audit report → extract issues by dimension
3. Create todo list with all 11 verification phases
4. Mark "Parse audit report" complete
5. For each dimension:
   a. Mark dimension in_progress
   b. Read files at reported locations
   c. Check if issues are fixed
   d. Mark dimension complete
6. Compile verification report
7. Mark "Generate report" complete
```
