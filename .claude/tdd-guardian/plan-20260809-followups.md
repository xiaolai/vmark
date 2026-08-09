# Architecture-review follow-ups — closing what the 21-WI refactor left open

**Status:** Phase 0 (plan written, cross-model review pending) · **Date:** 2026-08-09
**Branch:** `refactor/architecture-review-followups`
**Predecessor:** `.claude/tdd-guardian/plan-20260803-161713.md` (21 WIs, landed
`85dc54405`, 2026-08-04)
**Origin:** verification pass over that plan's delivered state, 2026-08-09. Every
finding below was reproduced against the tree, not read off the tracker.

**Verify status at any time:**

```bash
bash scripts/check-followups-phase.sh <0-5>   # per-phase DoD, exit 0 = phase complete
bash scripts/check-followups-phase.sh all     # every phase, one report
```

That script is the contract. This file explains *why*; the script decides *whether*.

---

## What the verification pass established

The predecessor plan is in unusually good shape. All 21 work items are genuinely
landed — no stubs, no renamed proxies. Verified green on 2026-08-09 at `981afc010`:
`tsc --noEmit` clean on a cold cache (WI-21), `test:gates` 645/645, all eight new
ratchet gates pass, `check-baseline-ratchet.mjs origin/main` holds 27 baselines,
and `build` + `lint:eager` + `size` pass with `vendor-xyflow` and the format
chunks confirmed lazy (WI-12, WI-13).

This plan does **not** revisit that work. It closes five gaps at its edges.

## The five findings

| # | Finding | Class | Phase |
|---|---|---|---|
| F1 | `tier0-e2e.yml` has never run — zero runs, ever | unproven gate | 2 |
| F2 | Mutation testing is proven by one hand-dispatch; every scheduled run in history was cancelled | unproven gate | 2 |
| F3 | `check-wi-linkage.sh` cannot see `scripts/*.test.mjs`, and invents phantom WIs from prose | gate defect | 1 |
| F4 | The refactor landed as one 652-file commit, against its own "no big-bang commit" criterion | no control | 4 |
| F5 | ~450 units of frozen debt across 27 baselines, none ratcheting down | invisible debt | 3 |

Plus two documentation-hygiene items (Phase 5).

## ADRs

**ADR-1 — A date-triggered gate must offer a re-date, not just a failure.**
F5's fix makes every frozen baseline carry a review date and fail when it passes.
A bare date bomb reddens an unrelated PR with no action its author can take, which
trains people to disable it. So the failure has exactly two remedies, both stated
in the message: lower the number, or record a `deferReview` entry with a reason —
one deferral per baseline, expiring by itself, exactly the `allowRaise` idiom the
manifest already uses and that the codebase has already proven it trusts.

**ADR-2 — Work-item IDs come from headings, never from prose.**
F3's phantom-WI class (`WI-1.6`, extracted from a quoted label inside WI-6's
description) is the third instance of the same defect in this repo: the plugin
coupling detector counted `@/stores` in comments, and the keybinding gate anchored
on mentions rather than declarations. Both were fixed by parsing structure instead
of grepping text. The linkage checker gets the same treatment — a WI-ID is an ID
only where the plan *declares* it as a work item.

**ADR-3 — The change-size control gates the PR, not the commit.**
F4 cannot be fixed retroactively and must not be fixed by banning large changes:
a genuine 21-WI program legitimately touches 652 files. What was missing is that
the size was never a *decision*. The gate therefore runs PR-only against the merge
base (same tier and failure posture as `check-new-deps.sh`), and an oversized PR
passes as soon as its body carries an explicit acknowledgement. It converts an
accident into a signature.

**ADR-4 — `.claude/tdd-guardian/` is a legitimate plan home; §1 is what is wrong.**
Governance §1 says plans live in `dev-docs/plans/YYYYMMDD-name.md`. `dev-docs/` is
gitignored (`.gitignore:8`) and `.claude/tdd-guardian/` is tracked. Moving the
predecessor plan to satisfy §1 would delete a tracked plan from the repo — strictly
worse than the deviation. §1 is amended to name both homes and the rule for
choosing, rather than the plan being moved.

**ADR-5 — Liveness is a property of a gate, not a property of a workflow file.**
F1 and F2 are the same defect wearing two faces: a workflow that exists, is wired,
looks green in review, and has never produced a verdict. A one-off dispatch closes
F1 today and nothing else. The durable half is WI-2.3 — a scheduled audit that
asks, of every non-PR gate, "did you produce a verdict recently, and does your
on-failure path still fire?" That is the deferred item from the predecessor plan
whose absence is why F1 survived merge.

---

## Phase 0 — Scaffolding and review (gate for everything after)

### WI-0.1 — DoD checker
- **Deliver:** `scripts/check-followups-phase.sh` + `scripts/check-followups-phase.test.mjs`.
- **Acceptance:**
  - [ ] Per-phase assertions; `all` runs every phase.
  - [ ] Unstarted phase reports NOT STARTED and exits non-zero (never a vacuous pass — the `check-wi-linkage.sh` zero-match lesson).
  - [ ] Test drives the real script as a subprocess over fixture trees, asserting both directions per phase.
  - [ ] Lands in the gates vitest tier automatically (`scripts/*.test.mjs`); `pnpm test:gates` green.

### WI-0.2 — Cross-model review (governance §6, mandatory: >3 phases)
- **Deliver:** `/cc-suite:review-plan` against this file; adopted deltas recorded per WI.
- **Acceptance:**
  - [ ] Review run, thread ID recorded in this header.
  - [ ] Every blocker either adopted or refused with a stated reason.
  - [ ] **No Phase 1 commit lands before this completes.**

---

## Phase 1 — Repair the linkage gate (F3)

`scripts/check-wi-linkage.sh` is the governance §2 enforcement mechanism. It has
three defects and no test.

> **Governance §9 note.** §9 forbids changing this script without explicit user
> authorization, and its header already records one such grant from 2026-07-14.
> Authorization for this change was granted by the maintainer on 2026-08-09
> ("fix all"). Every WI below appends its reason to that header, as §9 requires.

### WI-1.1 — See the gates tier
- **Problem:** `TEST_HEADERS` globs `src/**/*.test.ts(x)` and `src-tauri/**/*.test.rs`
  only. The repo has a fourth test root — `scripts/**` and `.claude/hooks/**`, owned
  by `vitest.gates.config.ts`, 31 files and 645 tests. WI-16's only test lives there,
  so a correctly-linked work item reports NOT LINKED.
- **Acceptance:**
  - [ ] RED first: a test asserting WI-16 links via `scripts/check-baseline-ratchet.test.mjs` fails before the fix.
  - [ ] Glob covers every root the tier partition recognises; adding a fifth root fails the checker's test, not silently.
  - [ ] `bash scripts/check-wi-linkage.sh .claude/tdd-guardian/plan-20260803-161713.md` reports 0 unlinked.

### WI-1.2 — IDs from declarations, not prose (ADR-2)
- **Problem:** `grep -E -o "$WI_RE" "$PLAN"` matches every occurrence anywhere in the
  file. The predecessor plan quotes `"WI-1.6 live-webview cap enforced"` inside WI-6's
  description, so the gate demands linkage for a work item that does not exist.
- **Acceptance:**
  - [ ] RED first: fixture plan with a prose mention of a foreign WI-ID → that ID is not extracted.
  - [ ] A real work item declared in a heading IS extracted, in both `### WI-N:` and `**WI-N.M — title**` forms (both live in this repo).
  - [ ] Zero-match still FAILS CLOSED (the 2026-07-14 property is preserved and pinned).
  - [ ] Predecessor plan extracts exactly 21 work items, not 22.

### WI-1.3 — Delete or implement the phase claim
- **Problem:** The header states "only checks WIs from phases reported as 'complete'
  in the plan's Status header. Skips phases not yet started." No code parses a Status
  header. The claim is false in the file that enforces honesty elsewhere.
- **Acceptance:**
  - [ ] Either implemented and pinned by test, or deleted from the header. Decision recorded in the header with its reason.
  - [ ] `--phase=N` behaviour (which *is* implemented) documented accurately.

### WI-1.4 — First test file for the script
- **Acceptance:**
  - [ ] `scripts/check-wi-linkage.test.mjs` drives the real script over fixture plans + fixture test trees in tmpdir.
  - [ ] Covers: linked-via-commit, linked-via-test-header, unlinked, zero-match fail-closed, phantom-prose ID, gates-tier header, `--phase` filter, malformed plan path (exit 64).
  - [ ] `pnpm test:gates` green.

**Phase 1 DoD:** `bash scripts/check-followups-phase.sh 1` exits 0.

---

## Phase 2 — Prove the unproven gates (F1, F2, ADR-5)

### WI-2.1 — First live run of `tier0-e2e.yml`
- **Problem:** Zero runs, ever. The workflow's own header requires its first live run
  to be a `workflow_dispatch` verified with `gh run view --json headSha,conclusion,jobs`.
  The predecessor's WI-17 carried that as acceptance and it was never met. Headless
  WebKitGTK under Xvfb is the one part no local check can prove.
- **Authorized:** maintainer, 2026-08-09 — dispatch and iterate to green.
- **Acceptance:**
  - [ ] Dispatched against an explicit `--ref`; run ID captured.
  - [ ] `gh run view <id> --json headSha,conclusion,jobs` shows the dispatched SHA, `conclusion: success`, and per-job success. Never a bare `gh run watch`.
  - [ ] Any failure found is FIXED, not recorded — the run is the point.
  - [ ] Result (run ID, SHA, date) written into the workflow header, replacing the "its first live run is…" future tense.

### WI-2.2 — Mutation's scheduled lane
- **Problem:** One success in project history, all `workflow_dispatch`. Every
  *scheduled* run since June was cancelled. Post-repair, no scheduled run has come due
  yet (next: Monday 2026-08-10 06:00 UTC), so the schedule path is untested, not broken.
- **Acceptance:**
  - [ ] Root cause of the historical cancellations identified and stated (concurrency group vs 6h limit vs manual) — a guess is not an answer.
  - [ ] If the cause is structural, fixed; if it was pre-repair timeouts, that is recorded with the evidence.
  - [ ] The 2026-08-10 scheduled run is checked and its verdict recorded here.

### WI-2.3 — Gate-liveness audit (the deferred item that would have caught F1)
- **Deliver:** `scripts/check-gate-liveness.mjs` + test + a scheduled workflow.
- **Acceptance:**
  - [ ] RED first: fixture with a gate whose last verdict is older than its declared cadence → exit 1 naming the gate.
  - [ ] A manifest declares each non-PR gate (`mutation`, `tier0-e2e`, `soak`, `rust-coverage`) with its cadence and its expected on-failure path.
  - [ ] Reads real run history via `gh api`; **fails closed** on unreachable `gh`, malformed JSON, or a workflow with zero runs — never a silent pass. (Zero runs is the F1 state; it must be the loudest case, not the quietest.)
  - [ ] A gate on disk but missing from the manifest fails, and a manifest entry with no workflow fails — two-way staleness, house standard.
  - [ ] Reports into a single rolling issue, the `mutation.yml` pattern.
  - [ ] Registered wherever a scheduled workflow is registered so it cannot itself become the unwatched watcher — state explicitly in its header who watches it.

**Phase 2 DoD:** `bash scripts/check-followups-phase.sh 2` exits 0 — which requires a
recorded green tier0-e2e run ID, not merely the file's existence.

---

## Phase 3 — Frozen debt becomes scheduled debt (F5, ADR-1)

Today's frozen debt, measured 2026-08-09:

| Baseline | Frozen | Movement since 2026-08-04 |
|---|---:|---|
| `mock-boundaries-baseline.json` | 274 store-mock triples / 140 files | none |
| `command-error-baseline.json` | 99 legacy `Result<T, String>` / 36 files | none |
| `.dependency-cruiser-known-violations.json` | 75 per-edge violations | none |
| `plugin-store-coupling-baseline.json` | services/hooks/components channels | none |
| `file-size-baseline.json` | 92 files | down from 153 ✅ |

The ratchets work — they make the debt visible and monotone. What none of them has
is a *deadline*. Scope here is the mechanism, not bulk paydown (maintainer decision,
2026-08-09); paying these down is its own plan.

### WI-3.1 — `review` dates in the ratchet manifest
- **Acceptance:**
  - [ ] RED first: fixture manifest entry with a past `review` date → real script exits 1 naming the baseline.
  - [ ] Schema extends `MANIFEST` entries with `review: { by: "YYYY-MM-DD", owner, target }`; `target` states what "progress" means for that baseline (a number, or "zero").
  - [ ] A past date fails with both remedies named: lower the number, or add a `deferReview` entry with a reason.
  - [ ] `deferReview` mirrors `allowRaise`: one deferral, mandatory reason, **fails as stale** once the review date has moved past it on the base.
  - [ ] An entry with no `review` field fails — every baseline is dated, no opt-out.
  - [ ] Dates are read from a real clock injected at the seam, never `Date.now()` inside the comparator, so the tests are deterministic.

### WI-3.2 — Date every one of the 27 baselines
- **Acceptance:**
  - [ ] All 27 carry `review`, `owner`, `target`; no placeholder dates (a date nobody chose is a date nobody honours).
  - [ ] Dates are staggered — a single shared date makes one bad Monday redden everything.
  - [ ] `node scripts/check-baseline-ratchet.mjs origin/main` exits 0.

### WI-3.3 — Rules stop quoting numbers they do not own
- **Problem:** `.claude/rules/00-engineering-principles.md` says the file-size baseline
  "freezes the 153 pre-existing violators"; it is 92. The number drifted the moment the
  gate did its job. Docs that restate a gate's number are drift generators.
- **Acceptance:**
  - [ ] Rule text references the baseline file as the authority instead of restating its count. Same sweep for any other rule quoting a live gate number.
  - [ ] Corrected wherever the count is genuinely load-bearing prose.

**Phase 3 DoD:** `bash scripts/check-followups-phase.sh 3` exits 0.

---

## Phase 4 — A control on change size (F4, ADR-3)

### WI-4.1 — `scripts/check-change-size.sh`
- **Acceptance:**
  - [ ] RED first: fixture PR diff over threshold without acknowledgement → exit 1; with acknowledgement → exit 0.
  - [ ] Thresholds committed as data with a stated rationale, not magic numbers in the script.
  - [ ] Acknowledgement is an explicit token in the PR body; its absence is the failure, its presence is a recorded decision.
  - [ ] **Fails closed** when the base ref or PR body cannot be resolved — never skips.
  - [ ] PR-only in `ci.yml`, alongside `check-new-deps.sh` and the baseline ratchet, deliberately absent from `check:all` (a local checkout cannot guarantee a base ref — the documented reason the ratchet is CI-tier).
  - [ ] The predecessor's own 652-file / +33,935 commit is used as the fixture that must trip it.

### WI-4.2 — Test + governance text
- **Acceptance:**
  - [ ] `scripts/check-change-size.test.mjs`, real script over scratch-git fixtures, both directions.
  - [ ] `.claude/rules/60-ai-governance.md` gains a short §12 stating the control and why the predecessor plan motivated it.
  - [ ] `check-scripts-parity.test.mjs` still green (new gate has a CI home; `check:all` composition unchanged).

**Phase 4 DoD:** `bash scripts/check-followups-phase.sh 4` exits 0.

---

## Phase 5 — Documentation hygiene

### WI-5.1 — `dev-docs/README.md` exists
- **Problem:** `.claude/rules/20-logging-and-docs.md` designates it the per-topic index
  and links target; AGENTS.md tells agents to link finished deep-researches from it.
  It does not exist. Maintainer-local (gitignored), so it lands unversioned.
- **Acceptance:**
  - [ ] Index covering `plans/`, `deep-researches/`, `audit/`, `grills/`, `baselines/`, `e2e/`.
  - [ ] Every existing deep-research linked (AGENTS.md's archive rule).

### WI-5.2 — Reconcile governance §1 with reality (ADR-4)
- **Acceptance:**
  - [ ] §1 names both plan homes and the rule for choosing: `dev-docs/plans/` for maintainer-local, `.claude/tdd-guardian/` for a plan that must ship with the repo.
  - [ ] The reason is recorded — a rule that would delete a tracked plan is the rule that is wrong.
  - [ ] `check-wi-linkage.sh` accepts a plan from either home (it takes a path, so this is a test, not a change).

**Phase 5 DoD:** `bash scripts/check-followups-phase.sh 5` exits 0.

---

## Risks

- **WI-2.1 is the only item with unbounded cost.** A first-ever headless-WebKitGTK run
  can fail for reasons that have nothing to do with this plan (Xvfb, the 9323 bridge,
  sidecar spawn, cache-cold Rust build inside 45 min). Mitigation: it is its own phase
  boundary; if it proves to be a multi-day fight, Phases 3–5 are independent and land
  first rather than waiting behind it.
- **WI-3.1 introduces a time-dependent gate.** Wrong, this becomes the flake generator
  the coverage-floor lesson warns about. Mitigation: injected clock, staggered dates,
  and a deferral path that a blocked author can actually take (ADR-1).
- **WI-1.2 changes a §9-protected script's extraction grammar.** Widening it once
  already produced a false green (2026-07-14). Mitigation: WI-1.4's test lands with it,
  pinning the fail-closed property in the same commit as the grammar change.
- **WI-4.1 could annoy more than it protects** if thresholds are set from taste. Mitigation:
  measure the repo's actual PR size distribution and set the threshold above the
  legitimate mass, then verify it trips on `85dc54405` and not on a normal PR.

## Deferred / out of scope

- **Bulk paydown of the frozen baselines** — maintainer decision 2026-08-09: this plan
  makes the debt self-policing; paying it down is a separate program. WI-3.1's review
  dates are what schedules it.
- **Retroactively splitting `85dc54405`** — history rewrite on `main`, protected branch,
  no benefit that the Phase-4 control does not deliver going forward.
- **Migrating `src/test/setup.ts` off its silent-success `invoke` default** — still live
  at `setup.ts:111`, still the false-confidence class, still too much blast radius
  (predecessor's own deferral, unchanged). WI-3.1 is the mechanism that will eventually
  put a date on it, once it is baselined at all.
- **Popup-layer convergence (A1 follow-on)** — unchanged from the predecessor's deferral.

## Definition of Done (whole plan)

```bash
bash scripts/check-followups-phase.sh all   # exit 0
pnpm check:all                              # exit 0
```

Plus: a recorded green `tier0-e2e.yml` run ID, and `bash scripts/check-wi-linkage.sh
.claude/tdd-guardian/plan-20260809-followups.md` reporting zero unlinked.
