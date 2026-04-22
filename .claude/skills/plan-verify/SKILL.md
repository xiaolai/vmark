---
name: plan-verify
description: Verify a completed implementation against a plan by running gates and checking acceptance criteria. Use when the user asks to verify work items or confirm completion.
---

# Plan Verify

## Overview

Runs the plan’s required tests/gates and validates acceptance criteria, producing a pass/fail verification report.

## Workflow (Verify)

1) **Locate the plan**
   - Prefer `dev-docs/plans/<plan>.md`.
   - If unclear, ask for the plan path.

2) **Extract verification checklist**
   - For each WI, list:
     - Acceptance criteria
     - Required tests
     - Manual checks (if any)

3) **Run gates**
   - Use repo-specific gates from `.claude/commands/feature-workflow.md` or plan “Testing Procedures”.
   - If tests are not runnable, note the blocker explicitly.

4) **Verify acceptance**
   - For each WI, mark each acceptance criterion as Pass/Fail/Blocked.
   - Include evidence (test output, file refs, manual steps).

5) **Report results**
   - Summarize pass/fail with concrete next actions.

## Output Format (required)

- **Verification Summary**
  - Total WIs verified
  - Pass/Fail/Blocked counts
- **Gate Results**
  - Command → status
  - Failures with key error lines
- **Acceptance Matrix**
  - WI‑### → criterion → Pass/Fail/Blocked
- **Manual Checks**
  - Steps executed + outcome

## Verification Rules

- Always run tests unless the user explicitly forbids it.
- If tests are skipped or fail, mark WI as **Blocked**.
- Do not claim “verified” without test evidence.
- Manual checks must include evidence (step list + observed result).
