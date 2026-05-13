# Findings Template

Copy the markdown block below for every procedure run. File the result at:

| Tier | Path |
|---|---|
| T2 weekly | `dev-docs/audit/weekly-YYYY-MM-DD.md` |
| T3 monthly | `dev-docs/audit/monthly-YYYY-MM.md` |
| T4 quarterly | `dev-docs/audit/quarterly-YYYY-QN.md` |

Severity grades come from `dev-docs/audit/protocol.md` — Critical / Warning / Info. Reuse them so past chunk reports and new findings stay comparable.

## Verdict rules

Every finding must end with one of three verdicts. No "TBD" — that's how reports become noise.

| Verdict | What it looks like |
|---|---|
| **Fixed** | "Fixed in commit `<sha>`" — link the commit |
| **Issue filed** | "Issue #N filed, owner `@name`, target `<release or date>`" |
| **Intentional** | "Intentional — `<one-line justification>`" |

## Template

```markdown
# Cleanup Findings — <Tier> <Date>

**Tier:** T2 / T3 / T4
**Date:** YYYY-MM-DD
**Duration:** Nm (target: 30m / 2h / 4h)
**Branch:** main @ `<short-sha>`
**Trigger:** scheduled / override / manual

## Summary

One paragraph. Suggested shape:

> Ran <tier> cleanup. Fixed N items in cycle, filed M issues for items
> deferred. Notable: <the one thing worth surfacing>. Compared to last
> <tier> entry: <trend in one sentence>.

## Per-area status

| Area | Status | Findings | Action |
|---|---|---|---|
| Dependency freshness | clean / N / deferred | … | … |
| Unused code | clean / N / deferred | … | … |
| File size | clean / N / deferred | … | … |
| Locale parity | clean / N / deferred | … | … |
| Token violations | clean / N / deferred | … | … |
| Responsive violations | clean / N / deferred | … | … |
| Stale branches & PRs | clean / N / deferred | … | … |

<!-- T3 monthly adds these rows: -->
<!--
| Architecture drift | … | … | … |
| Documentation sync | … | … | … |
| Mutation testing | … | … | … |
| Bundle / build perf | … | … | … |
| Accessibility | … | … | … |
| Cross-platform | … | … | … |
| Plan hygiene | … | … | … |
-->

<!-- T4 quarterly adds these rows: -->
<!--
| Trend review | … | … | … |
| Architecture review | … | … | … |
| Top-10 debt list | filed | N items | issues linked below |
| Dependency strategy | … | … | … |
| Rule efficacy | … | … | … |
| Capability audit | … | … | … |
| Cross-model audit | … | … | … |
-->

## Findings detail

Use the audit protocol severity grades (Critical / Warning / Info).

### Critical (must fix this cycle)

#### [C1] Title
- **File:** `path:line`
- **Issue:** description
- **Verdict:** Fixed in commit `<sha>` / Issue #N filed / Intentional

### Warning (should fix this cycle)

#### [W1] Title
- **File:** `path:line`
- **Issue:** description
- **Verdict:** …

### Info (consider)

#### [I1] Title
- Brief note
- **Verdict:** …

## Metrics

Appended to `.github/cleanup-ledger.json`. Key deltas vs. last entry of same tier:

| Metric | Last | Now | Δ |
|---|---:|---:|---:|
| `files_over_300_lines` | 12 | 11 | -1 |
| `deps_outdated` | 7 | 4 | -3 |
| `knip_unused_exports` | 18 | 12 | -6 |
| … | … | … | … |

(For T3 and T4, include the full metric set. For T2, only the metrics that moved are worth tabulating.)

## Issues filed this cycle

- #N — title (owner `@name`, target `<release or date>`)
- …

## Comparison to previous <tier> entry

<!-- Required for T3 and T4. Optional but encouraged for T2. -->
One paragraph contrasting this run with the previous entry of the same tier. Focus on direction, not detail — detail is in the metrics table.

## Notes for next cycle

Anything the next run should know up front:
- Deferred items that should be picked up first.
- Partial fixes still in progress.
- Flaky tests being watched.
- Procedures that overran their budget and why.
```

## Filing pattern

```bash
# T2 example
date_today=$(date -u +%Y-%m-%d)
cp dev-docs/house-cleaning/findings-template.md "dev-docs/audit/weekly-$date_today.md"
# Then edit; the template block above is what you keep.
```

(The template file itself ships only the block above as the canonical source — the rest of this file is explanatory.)
