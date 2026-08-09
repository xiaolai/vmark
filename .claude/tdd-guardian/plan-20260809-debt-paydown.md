# Baseline debt paydown — the mechanical half

**Status:** Phase 0 (plan written, cross-model review pending) · **Date:** 2026-08-09
**Branch:** `plan/debt-paydown` (stacked on `refactor/architecture-review-followups`,
which carries the debt register this plan pays down — must merge after it)
**Predecessor:** `.claude/tdd-guardian/plan-20260809-followups.md` (all phases complete)
**Origin:** the register that plan built says WHAT the debt is. It does not pay it.

**Verify status:**

```bash
bash scripts/check-paydown-phase.sh <0-4>   # per-phase DoD
bash scripts/check-paydown-phase.sh all
```

**Work-item namespace: `WI-DP*`.** Bare `WI-N.M` collides across plans and the
linkage gate searches the whole repo — governance §1, learned the hard way.

---

## Why this plan exists, and what it corrects

The follow-ups plan built a debt register and a weekly staleness report. That was
the right instrument for the wrong assumption: it treats attention as the scarce
resource and debt as something to be *watched*. Most of this debt is not waiting
on judgement, it is waiting on throughput — and throughput is the thing that is
no longer scarce here.

The evidence is in the shape of the debt, not in optimism about it:

| Baseline | Units | Shape |
|---|---:|---|
| `mock-boundaries-baseline.json` | 274 across 139 files | 28 distinct targets; **4 stores are 188 of 274**; only 5 files hold >4 |
| `bespoke-buttons-baseline.json` | 88 named + 80 styled | one conversion to `.vm-btn`, repeated |
| `command-error-baseline.json` | 99 across 36 files | established pattern, 8 `From` impls, coherence migrated as the worked example |
| `knip-baseline.json` | 75 findings / 6 families | 16 dead exports, 59 dead types |
| `merge-drop-allowlist.json` | 2 | both already state where the change was re-applied |

Four stores account for 69% of the largest item. That is one pattern applied
repeatedly across independent files, not a programme of work.

**What this plan does NOT touch** — the register keeps reporting these, because
for them a standing report IS the right instrument. They are waiting on
decisions, and no amount of throughput substitutes:

- `plugin-store-coupling` (23) and `.dependency-cruiser-known-violations` (75) —
  the same coupling from two sides. Every edge needs a seam/option/port choice
  (`00-engineering-principles` documents three strategies and when each applies),
  and some cannot be an option at all: a node view that ProseMirror constructs
  has no host to pass one in.
- the four spec/fidelity ledgers — each entry is a markdown-dialect judgement:
  a bug, or a deliberate deviation from CommonMark?
- `file-size` (165) — splitting is mechanical; *where* to split is a design call
  per file, and a bad split is worse than a long file.

## ADRs

**ADR-1 — The existing gate is the DoD. No new measurement.** Each phase is done
when the baseline number reaches its target and `pnpm lint:<gate>` says so. This
plan introduces no counter of its own, because a second definition of "how much
debt is left" can disagree with the first, and then neither is trusted.

**ADR-2 — Never buy green by weakening the check.** The ratchet already forbids
raising a number. This forbids the subtler purchase: removing a `vi.mock` by
deleting the test, converting a command by widening its error to `internal`,
silencing a knip finding with an ignore comment instead of deleting the code.
Every unit removed must leave the same behaviour asserted, or better.

**ADR-3 — Mock removal goes per-store, never as one sweep.** The thing being
modified is the safety net. 139 test files changed at once cannot be reviewed and
cannot be bisected. One store per batch, full suite green before the next, so a
regression is attributable to 30 files rather than 139. This is also the shape
Phase 4 of the predecessor plan now flags — the acknowledgement is expected and
its reason is stated in the PR, which is exactly what that gate is for.

**ADR-4 — "Mechanical" is a hypothesis, and each phase can refute it.** The
classification above is a reading of shape, not a proof. A mock that exists
because the real store performs persistence, a command whose error genuinely has
no typed code, a "dead" export with a runtime consumer the graph cannot see —
each is an item that turns out to need design. When one appears: leave the
baseline entry, record the reason in the register's `tracked` target, and move on.
A phase completes at its *revised* target with the exceptions named. Forcing a
number to zero by reclassifying the hard cases as done is the failure mode.

**ADR-5 — Delete the register entry at zero.** A baseline that reaches its target
is removed from `tracked` and its file deleted, not left at 0. The two-way
staleness check then requires the manifest entry to go too. Debt that is paid
should stop costing attention — an empty baseline is still a file everyone reads.

---

## Phase 0 — Scaffolding and review

### WI-DP0.1 — DoD checker
- [ ] `scripts/check-paydown-phase.sh` + `.test.mjs`, same contract as its
      predecessor: a phase with nothing done reports NOT STARTED, a skipped
      REAL-ROOT assertion reports UNVERIFIED, and neither shares an exit code
      with DONE.
- [ ] Per-phase assertions read the REAL baselines, so the DoD cannot drift from
      what the gates measure (ADR-1).

### WI-DP0.2 — Cross-model review (governance §6, mandatory: >3 phases)
- [ ] `/cc-suite:review-plan`; thread recorded here; blockers adopted or refused
      with a reason.
- [ ] **No Phase 1 commit lands before this completes.**

---

## Phase 1 — Shakedown: the two smallest (75 + 2 units)

Deliberately first, and deliberately small: this is where the paydown *procedure*
gets exercised — batch size, gate cadence, PR shape — on debt where a mistake is
cheap and obvious.

### WI-DP1.1 — `merge-drop-allowlist` → zero
- **Problem:** 2 entries, each already naming where the dropped change was
  re-applied. The target says "fixed or shown to be intended", and both appear to
  already be the latter.
- [ ] Verify each claim against the code it names (`closeSaveShared.ts`
      `saveFiltersForFilePath`; `workspaceOpen.ts` disk-open ingest routing).
- [ ] A claim that still holds → the entry is not debt: move it to `exempt` with
      the verification recorded, or delete it if the gate no longer needs it.
- [ ] A claim that does NOT hold → that is a lost change, and it gets fixed. This
      is the outcome worth looking for; the allowlist is only safe if its claims
      are true.

### WI-DP1.2 — `knip` 75 → as low as the code allows
- [ ] 16 dead exports and 59 dead types deleted, or justified AT THE DEFINITION
      (not in the baseline) with the consumer named.
- [ ] Each deletion is a real deletion — no `knip-ignore` comments (ADR-2).
- [ ] `pnpm knip && pnpm lint:knip-baseline` green with the counts lowered.

**Phase 1 DoD:** `bash scripts/check-paydown-phase.sh 1` exits 0.

---

## Phase 2 — `command-error` 99 → 0

Migration is defined and demonstrated: `CommandError`, twelve codes, eight `From`
impls, and the coherence surface already migrated file-by-file as the pattern.

Order by concentration: `browser/commands.rs` (14), `pty.rs` (8),
`browser/commands_auth.rs` (7), `content_server/commands.rs` (5),
`hot_exit/commands.rs` (5), then the tail of 31 files.

### WI-DP2.1 … WI-DP2.n — one batch per module
- [ ] Each command returns `Result<T, CommandError>` with a code from the closed
      vocabulary — never `internal` as a shortcut for "I did not classify this"
      (ADR-2).
- [ ] User-facing variants carry an `i18nKey` resolving in **all ten** locale
      bundles; the existing Rust test enforces it.
- [ ] Frontend callers branch on `code`, never message text; any string-sniffing
      branch the migration reaches is deleted in the same change.
- [ ] `cargo test` + `cargo clippy --all-targets -- -D warnings` green per batch.
- [ ] `scripts/command-error-baseline.json` lowered per batch, never raised.

**Phase 2 DoD:** baseline at 0, entry and file deleted (ADR-5).

---

## Phase 3 — `mock-boundaries` 274 → 0

The largest, and the one touching the safety net. Per ADR-3, one store per batch.

Order by count: `tabStore` (53), `documentStore` (52), `settingsStore` (52),
`uiStore` (31) — 188 of 274 — then `workspaceStore` (21), `editorStore` (11),
then the tail across 22 more targets.

### WI-DP3.1 … WI-DP3.n — one batch per store
- [ ] Each `vi.mock("@/stores/X")` replaced by the REAL store, reset in
      `beforeEach` (the sanctioned alternative, per the gate's own header).
- [ ] Where the real store cannot be used — persistence, a Tauri boundary, a
      genuine isolation need — an explicit store-factory seam with a recorded
      reason, NOT a re-mock. If neither works, ADR-4 applies: leave the entry.
- [ ] Every test still asserts the same behaviour. A test that got *easier* to
      pass is a test that stopped testing.
- [ ] Full `pnpm test` green per batch — not `test:changed`. The import graph
      cannot see what a global mock was hiding.
- [ ] `scripts/mock-boundaries-baseline.json` entries removed per batch.

**Phase 3 DoD:** baseline at 0 or at a stated, reasoned floor (ADR-4).

---

## Phase 4 — `bespoke-buttons` 168 → down

88 by name + 80 by usage, 61 of which the name check cannot see.

### WI-DP4.1 — convert to the canonical components
- [ ] Each bespoke class replaced by `.vm-btn` / `.popup-icon-btn` /
      `.universal-toolbar-btn` per `32-component-patterns.md`.
- [ ] CSS-only changes are TDD-exempt (`10-tdd.md`) — so **visual QA replaces
      tests**, in both themes, against `dev-docs/css-reference.md`. Skipping it
      because "no test failed" would be trusting a gate that was never watching.
- [ ] Focus indicators survive conversion (`33-focus-indicators.md`); a
      caret-only case needs its declared marker.
- [ ] Both budgets lowered.

> One of these classes was `.workspace-approval-approve`. It vanished in an
> earlier consolidation, and the e2e harness went on clicking it for weeks —
> `?.click()` made a miss indistinguishable from a click. Converting a button is
> not only a CSS change; anything selecting it by class breaks silently.
> `grep -rn "<class>" e2e/ src/` before deleting each one.

**Phase 4 DoD:** both budgets lowered, visual QA recorded, no e2e selector left
pointing at a deleted class.

---

## Effort

Agent-time, not person-time, and the two do not convert:

| Phase | Irreducible thinking | Mechanical | Clock-time |
|---|---|---|---|
| 1 | verifying 2 merge claims | 75 deletions | one `check:all` per PR (~15 min) |
| 2 | error-code choice per command | 99 signatures | `cargo test` + `check:all` per batch |
| 3 | the isolation exceptions (ADR-4) | ~250 substitutions | **full `pnpm test` per batch** — this dominates |
| 4 | none | 168 conversions | visual QA is human clock-time, unavoidable |

Phase 3's cost is the full-suite run per store, and that is deliberate: the
alternative is bisecting a regression across 139 test files.

## Risks

- **A converted test that passes for the wrong reason.** Removing a mock can make
  a test pass by exercising nothing. Mitigation: the assertion must be unchanged;
  where behaviour genuinely differs, the test is rewritten with the change stated.
- **Phase 3 discovers the classification was wrong at scale.** If a large fraction
  needs seams, this stops being mechanical. Mitigation: ADR-4, and `tabStore`
  first as the largest single sample — if it is ugly, that is the signal to stop.
- **Phase 4 breaks a selector nobody tests.** Mitigation: the grep above, and the
  Tier-0 e2e suite now actually runs.
- **Stacked on an unmerged branch.** This plan's Phase 1 cannot land before the
  register does. Stated at the top; the DoD checker asserts the register exists.

## Deferred

The irreducible half stays in the register and is NOT in scope here:
`plugin-store-coupling`, `.dependency-cruiser-known-violations`, the four
spec/fidelity ledgers, `file-size`. Each needs decisions rather than passes, and
mixing them into a throughput plan is how a paydown stalls halfway with the easy
half done and the register no longer describing reality.
