# House Cleaning — Procedures and Cadence

A recurring framework for paying down measurable debt without touching working features. Complements the daily auto-audit by running deeper, less-frequent passes against well-defined targets.

**Status:** Active (introduced 2026-05-13).
**Scope:** maintenance hygiene across code, tests, dependencies, docs, design tokens, i18n, architecture, security.
**Out of scope:** feature work, refactors driven by feel, library replacements (see [Non-goals](#non-goals) below).

## How this fits with existing docs

| Existing doc | Role |
|---|---|
| Daily auto-audit (CI) | Tier 1 — fast, mandatory, blocks merge on failure |
| `dev-docs/audit/protocol.md` | Defines severity grades (Critical / Warning / Info) and the chunk-report format; this framework writes to that format |
| `dev-docs/audit/SUMMARY.md` and `chunk-*.md` | Past one-shot audit reports; future findings land alongside as `weekly-YYYY-MM-DD.md`, `monthly-YYYY-MM.md`, `quarterly-YYYY-QN.md` |
| `dev-docs/plans/20260418-housecleaning.md` | One-shot 3-phase deep cleanup plan (dead code → file splits → test audit). Pre-dates this framework; remains the template for *bounded, one-time* pushes when a single concern needs more than a monthly slot |
| `.claude/rules/` | Engineering guardrails the daily audit enforces. House cleaning catches what slips past |

This framework does **not** replace the existing plan or audit reports — it provides the *recurring schedule* that prevents debt accumulating to the point where another one-shot plan is needed.

## Guiding principles

1. **Decouple cadence from concern.** Different problems decay at different rates — type checks daily, dependency freshness weekly, architecture quarterly. Matching interval to rot rate is the whole point.
2. **Track drift, not state.** A snapshot ("12 files over 300 lines") is noise. A trend ("12 → 18 in two weeks") is signal. Every procedure records metrics to `.github/cleanup-ledger.json` so deltas are visible.
3. **Every finding gets a verdict.** Fixed in cycle, issue filed with owner, or explicit "intentional / won't fix". Findings without verdicts ossify into background noise that inoculates against future reports.
4. **Cleanup is budgeted, not opportunistic.** Reserve ~10% of capacity per cycle. Without an explicit slot, debt always loses to features.
5. **Self-improving gates.** When a real bug slips past daily checks, the postmortem must add the check that would have caught it. Otherwise gates ossify around old problems while new ones leak.

## Non-goals

These are forbidden inside any tier of this framework. They are grooming, not cleaning.

- Renaming stores, hooks, plugins, files, or variables for feel.
- Consolidating, regrouping, or flattening directory layout.
- Replacing libraries (Zustand, Tiptap, Tauri, Vite, Vitest).
- Rewriting working plugins or handlers.
- Adding new abstractions or "cleanup" utilities.
- Touching code unrelated to the current procedure's explicit target.

If a procedure tempts you toward any of the above — stop. File an issue and let it go through normal planning.

## Tier overview

| Tier | Cadence | Budget | Output |
|---|---|---|---|
| **T1 — Inner loop** | Daily | CI run | Pass/fail gate, daily audit report |
| **T2 — Weekly cleanup** | Mondays | ~30 min | `dev-docs/audit/weekly-YYYY-MM-DD.md` + ledger entry |
| **T3 — Monthly deep clean** | First Saturday | ~2 hr | `dev-docs/audit/monthly-YYYY-MM.md` + ledger entry + issues filed |
| **T4 — Quarterly strategic** | First weekend of quarter | ~half day | `dev-docs/audit/quarterly-YYYY-QN.md` + top-10 debt list |

See [`cadence.md`](./cadence.md) for the full schedule and override triggers.

## Suggested first run

Before adopting the whole cadence, run **one** T2 weekly cycle this Monday to:

1. Establish the baseline `.github/cleanup-ledger.json` entry.
2. Calibrate how long each step actually takes on this codebase.
3. Surface the first real findings — they tell you whether T2 is well-scoped or whether some procedures should move to T3.

Adjust the runbooks before committing to the schedule. Process designed without data calcifies around assumptions that turn out to be wrong.

## Index

- [`cadence.md`](./cadence.md) — schedule and override triggers
- [`weekly.md`](./weekly.md) — T2 procedures (dependencies, dead code, file size, locale, tokens, stale branches, autonomous audit wire-in)
- [`monthly.md`](./monthly.md) — T3 procedures (architecture, docs, mutation, bundle, accessibility, cross-platform, `fix-attempted` triage, plan hygiene)
- [`quarterly.md`](./quarterly.md) — T4 procedures (trend review, debt list, dependency strategy, rule efficacy, capability audit, cross-model audit)
- [`ledger.md`](./ledger.md) — metrics tracked and JSON schema
- [`findings-template.md`](./findings-template.md) — output format for procedure runs
