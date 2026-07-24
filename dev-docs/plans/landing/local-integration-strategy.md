# Local-integration strategy — refactoring parks on `refactor/vmark-core`

**Decision (2026-07-23).** The refactoring roadmap is developed **locally with no
releases**. Nothing is tagged, version-bumped, pushed to a release workflow, or
merged to `main`. Everything accumulates on the long-lived local integration
branch `refactor/vmark-core` and **parks there** until a separate, explicit
decision. This supersedes the versioned release train in
`../20260723-landing-refactor-to-main.md`.

## Branch model

- **`refactor/vmark-core`** — long-lived local integration branch (the
  accumulator), many commits ahead of `main`, 0 behind. Pushed to `origin`
  (2026-07-25) for cross-machine work — but **not released and not merged to
  `main`**; `origin/refactor/vmark-core` is a backup/sync point, not a release
  train. (`ci.yml` triggers only on `main`, so pushing the branch costs no CI.)
- **Per-unit feature branches** — each refactoring unit (a plan phase or a
  cohesive WI cluster) is a short-lived branch off `refactor/vmark-core`,
  developed **in the primary checkout** (`git switch -c`), then merged back
  `--no-ff` and deleted. One branch is active at a time — sequential, not
  parallel. (The earlier `.claude/worktrees/refactor` worktree was removed on
  2026-07-25: an in-repo second checkout of the same tracked files made every doc
  collide with its twin's `vmark.id`, spamming the coherence layer with
  `duplicate-id` diagnostics. Parallel phases, if ever needed, would use a
  worktree OUTSIDE the repo tree.)

```
refactor/vmark-core ──┬─(branch)─ refactor/<unit-a> ─(check:all green)─┐
                      │                                                 │
                      └────────────────── merge --no-ff ◀───────────────┘
                      │
                      └─(branch)─ refactor/<unit-b> ─ … (next unit)
```

## Per-unit workflow

1. `git switch -c refactor/<unit>` off `refactor/vmark-core`.
2. Build the unit per its plan file (TDD: RED → GREEN → REFACTOR; the plan's WIs
   and DoD are the contract). WI linkage via commit message or test-file header,
   per `.claude/rules/60-ai-governance.md` §2.
3. `pnpm check:all` green (the local mirror of CI's `frontend` check). For
   Rust-touching units also run `cargo fmt --check` + `cargo clippy
   --all-targets -- -D warnings` + `pnpm check:cross`.
4. `git switch refactor/vmark-core && git merge --no-ff refactor/<unit>`.
5. Delete the merged feature branch. Next unit.

No `pre-push` gate fires (nothing is pushed). The safety net is the same:
`pnpm check:all` before each merge-back, plus the reusable regression harness
`scripts/landing-differential.sh` for any pipeline-touching unit.

## What "no release" cancels

- No version bumps (rule 40 is not run).
- No `v*` tags, no release workflow, no `main` push/merge.
- The reconstruct-into-releasable-slices apparatus and the
  `v0.9.8`→`v0.10.0` train in the superseded landing plan.

## Development units (sequence + status)

Completed units are banked into `refactor/vmark-core` (`--no-ff`, feature branch
deleted). The one remaining buildable unit is **WI-3.4**; everything below it is
by-design blocked with no consumer.

| Order | Unit | Plan | State |
|---|---|---|---|
| — | Extension re-architecture | `../20260722-extension-architecture.md` | ✅ code-complete, parked |
| 1 | Tier-boundary restoration | `../20260722-tier-boundary-restoration.md` | ✅ **COMPLETE** (2026-07-24) — Phases 1–3 |
| 2 | Command-registry unification | `../20260723-command-registry-unification.md` | ✅ **COMPLETE** (2026-07-24) — Phases 0–5 |
| 3 | Keybinding unification | `../20260724-keybinding-unification.md` | ✅ **COMPLETE** (2026-07-24) — 8 phases + 3 audit rounds (ADR-018) |
| 4 | Palette multi-selection fidelity | `../20260723-command-registry-unification.md` §Phase 2 | ✅ **COMPLETE** (2026-07-25) — closed WI-2.2 residuals (a)(b): palette now delegates to the adapters' `canRunActionInMultiSelection` |
| **5 — next** | **WI-3.4 explicit ordering constraints** (126 steps: 77 + 49) | `../20260722-extension-architecture.md` §WI-3.4 | ⏳ **The one buildable unit left.** Encode an explicit `Prec` bucket or named `before`/`after` on each order-sensitive extension entry across both composition roots (+ a test each), then alphabetize so array position is no longer load-bearing |
| blocked | Extension Tier A–C + Phase 0B security residuals (WI-5.2–5.5, 0B.1/0B.3/0B.4) | `../20260722-extension-architecture.md` | ⏸️ **Not queued (ADR-016).** Need a caller principal / isolation boundary that cannot exist inside a single JS context, or a package contract that creates a consumer. Reopen only then |

One refactor is completed and merged back before the next begins — the
build-alongside discipline, just against the local integration branch instead of
a shippable `main`.

## Post-roadmap decision (open)

When WI-3.4 lands, the planned sequence is complete. Whether `refactor/vmark-core`
then merges to `main` (locally, still no release) is a **separate, explicit
decision** — not implied by completion (see End state below).

## End state

When the whole roadmap is complete **and confirmed**, everything is parked on
`refactor/vmark-core`. Whether it then merges to `main` (locally, still no
release) is a separate decision, made explicitly — not implied by completion.
