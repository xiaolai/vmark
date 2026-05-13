# Cadence

Match interval to rot rate. Running everything daily wastes compute; running everything quarterly skips real signal.

## Schedule

| Concern | Tier | Cadence | Trigger |
|---|---|---|---|
| Lint, format, type-check, test, build | T1 | Every commit | CI |
| Coverage threshold | T1 | Every commit | CI (`vitest.config.ts`) |
| Slopsquat dependency check | T1 | Every PR | `scripts/check-new-deps.sh` (CI) |
| Work-item linkage | T1 | Every PR | `scripts/check-wi-linkage.sh` (CI) |
| TDD hook (high-risk paths) | T1 | Every Write/Edit | `.claude/hooks/gha-tdd-guard.mjs` |
| Dependency freshness (patch/minor) | T2 | Weekly | Monday |
| Unused code, exports, deps | T2 | Weekly | Monday |
| File size cap (>300 lines) | T2 | Weekly | Monday |
| Locale key parity | T2 | Weekly | Monday |
| Design-token violations | T2 | Weekly | Monday |
| Responsive breakpoint violations | T2 | Weekly | Monday |
| Stale branches, PRs, issues | T2 | Weekly | Monday |
| Architecture drift | T3 | Monthly | First Saturday |
| Documentation sync (dev-docs ↔ code ↔ website) | T3 | Monthly | First Saturday |
| Mutation testing on hot paths | T3 | Monthly | First Saturday |
| Bundle / build performance | T3 | Monthly | First Saturday |
| Accessibility pass | T3 | Monthly | First Saturday |
| Cross-platform smoke (Linux/Windows build) | T3 | Monthly | First Saturday |
| Plan hygiene (`dev-docs/plans/`) | T3 | Monthly | First Saturday |
| Trend review (12 prior ledger entries) | T4 | Quarterly | First weekend of quarter |
| Top-10 debt list | T4 | Quarterly | First weekend of quarter |
| Dependency strategy (majors) | T4 | Quarterly | First weekend of quarter |
| Rule efficacy review | T4 | Quarterly | First weekend of quarter |
| Capability / permission audit | T4 | Quarterly | First weekend of quarter |
| Cross-model audit (Codex) | T4 | Quarterly | First weekend of quarter |

## Override triggers

Some events demand a procedure run regardless of the calendar. When any of these fire, run the relevant procedure within 24 hours and record an entry in the ledger marked `"trigger": "override"`.

| Event | Run |
|---|---|
| Production bug postmortem | Add gate that would have caught it; update the matching procedure |
| New external dependency added (outside CI auto-checks) | Weekly dependency procedure on that dep |
| Plan reaches "phase complete" | Plan hygiene procedure on that plan |
| Major release (e.g., v1.0 cut) | Full T4 strategic review |
| Two consecutive T2 runs flag the same finding | Promote to issue with owner; surface in next T3 |
| High/critical CVE in any dependency | Dependency procedure now; ignore the schedule |
| File grows past 600 lines (2× cap) | File-size procedure on that file now |

## Skipping a tier

Skipping is allowed but must be recorded so the gap doesn't go invisible.

| Skip | How to record |
|---|---|
| T2 (weekly) | Note in the next cycle's findings: "skipped 2026-MM-DD — reason" |
| T3 (monthly) | Open issue tracking why and when it will run; ledger entry with `"status": "skipped"` |
| T4 (quarterly) | Escalate to project owner; quarterly strategy gaps compound — never silent-skip |

Two consecutive skips at any tier means the cadence is wrong, not the cleanup. Adjust the schedule rather than continuing to skip.

## Ownership

| Tier | Owner | Reviewer |
|---|---|---|
| T1 | CI | n/a |
| T2 | Whoever is on duty Monday | Self-review |
| T3 | Single dev (rotated or fixed) | Project owner sees ledger entry |
| T4 | Project owner | n/a |

Single-owner per tier prevents diffusion of responsibility. "Everyone is responsible" means no one runs it.
