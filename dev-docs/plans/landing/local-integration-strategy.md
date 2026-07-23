# Local-integration strategy — refactoring parks on `refactor/vmark-core`

**Decision (2026-07-23).** The refactoring roadmap is developed **locally with no
releases**. Nothing is tagged, version-bumped, pushed to a release workflow, or
merged to `main`. Everything accumulates on the long-lived local integration
branch `refactor/vmark-core` and **parks there** until a separate, explicit
decision. This supersedes the versioned release train in
`../20260723-landing-refactor-to-main.md`.

## Branch model

- **`refactor/vmark-core`** — long-lived local integration branch (the
  accumulator). Currently 63 commits ahead of `main`, 0 behind. Not pushed, not
  released, not merged to `main`.
- **Per-unit feature branches** — each refactoring unit (a plan phase or a
  cohesive WI cluster) is a short-lived branch off `refactor/vmark-core`,
  developed in **this one worktree** (`.claude/worktrees/refactor`), then merged
  back `--no-ff`. One branch is active at a time — sequential, not parallel.
  (Parallel phases would need additional worktrees; not currently used.)

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

## Remaining development units (sequence)

| Order | Unit | Plan | State |
|---|---|---|---|
| — | Extension re-architecture | `../20260722-extension-architecture.md` | ✅ code-complete, parked (deferrals WI-3.4, WI-5.2–5.5, 0B are by-design, not pending) |
| 1 | Command-registry unification | `../20260723-command-registry-unification.md` | Designed, Codex-reviewed, Phase-0 recon done; **ready to build** — unblocks ADR-015 `Contribution.commands` (WI-4.1) |
| later | WI-3.4 explicit ordering constraints (126 steps) | `../20260722-extension-architecture.md` §WI-3.4 | Deliberately deferred — only safe after each order-sensitive entry carries an explicit `Prec`/`before`/`after` |

One refactor is completed and merged back before the next begins — the
build-alongside discipline, just against the local integration branch instead of
a shippable `main`.

## End state

When the whole roadmap is complete **and confirmed**, everything is parked on
`refactor/vmark-core`. Whether it then merges to `main` (locally, still no
release) is a separate decision, made explicitly — not implied by completion.
