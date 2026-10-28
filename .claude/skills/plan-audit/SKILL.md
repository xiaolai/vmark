---
name: plan-audit
description: Audit or verify an implementation against a plan (dev-docs/plans/* or .claude/tdd-guardian/*). Audit mode inspects for gaps, logic errors and missing tests; verify mode runs the gates and marks each acceptance criterion. Use when asked to check work items against a plan or confirm they are complete.
---

# Plan Audit

## Overview

Two modes over the same plan. **Audit** (default) inspects completed work against the plan (WIs + acceptance + tests) and reports gaps, logic errors, and missing coverage with file/line references; it runs nothing. **Verify** runs the gates and marks every acceptance criterion; use it when asked to verify or confirm completion.

## Workflow (Audit)

1) **Locate the plan**
   - `dev-docs/plans/<plan>.md` (local) or `.claude/tdd-guardian/<plan>.md` (tracked).
   - If unclear, ask for the plan path or the WI list.

2) **Extract audit checklist**
   - For each WI, list:
     - Goal
     - Acceptance criteria
     - Tests required
     - Touched areas (files/symbols)

3) **Map implementation to WIs**
   - Use `git log`, `git show --stat`, `rg`, and file inspection.
   - Record which files/commits satisfy each WI.

4) **Gap & correctness analysis**
   - Check each acceptance item vs actual behavior.
   - Find logic errors, edge-case failures, and incomplete flows.
   - Validate test coverage against the “Tests (first)” section.
   - If the plan references specs, verify implementation matches those specs.
   - If the plan is missing acceptance/tests, record it as a plan-quality gap.

5) **Report findings**
   - Order by severity: Critical → High → Medium → Low.
   - Each finding must include:
     - WI reference
     - File path + line
     - Why it violates the plan
     - Expected behavior per plan

## Output Format (required)

- **Findings (ordered by severity)**  
  - `File:line` and WI reference
  - Impact and suggested fix
- **Plan Gaps Summary**  
  - WI‑### → missing/partial acceptance items
- **Test Coverage Gaps**  
  - Missing tests, broken tests, or “test not written”
- **Notes / Risks**  
  - Any assumptions or unverified areas
- **Evidence**
  - Cite concrete evidence for each finding (files/lines/commit IDs).

## Audit Rules

- In audit mode, do **not** run tests unless the user explicitly asks; it is an inspection pass.
- Be strict about spec drift: if behavior diverges from plan text, flag it.
- If you cannot locate the plan, stop and ask for it.

## Verify mode

1) Locate the plan and list, for each WI, its acceptance criteria, required
   tests and manual checks.
2) Run the plan's own gates (its "Testing Procedures", or the phase script
   `scripts/check-*-phase.sh` it names); otherwise pick from the `AGENTS.md`
   gate table. Note any gate that cannot run as a blocker.
3) Mark each criterion Pass / Fail / Blocked with evidence: the command and its
   result line, file references, or manual steps with the observed result.
4) Report: a summary (WIs verified, Pass/Fail/Blocked counts), gate results
   (command → status, key error lines for failures), the acceptance matrix
   (WI → criterion → status), and manual checks.

Rules: always run the gates unless the user forbids it; a skipped or failing
test makes its WI **Blocked**; never claim "verified" without test evidence.
