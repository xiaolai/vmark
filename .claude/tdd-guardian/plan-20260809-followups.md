# Architecture-review follow-ups — closing what the 21-WI refactor left open

**Status:** Phase 0 complete (revision 2, post-review) · **Date:** 2026-08-09
**Branch:** `refactor/architecture-review-followups`
**Predecessor:** `.claude/tdd-guardian/plan-20260803-161713.md` (21 WIs, landed
`85dc54405`, 2026-08-04)
**Origin:** verification pass over that plan's delivered state, 2026-08-09. Every
finding below was reproduced against the tree, not read off the tracker.

**Cross-model review (governance §6, mandatory — >3 phases):**
Review thread: `019fe450-545a-7022-b664-d9dfbe71f9df` · Codex `gpt-5.6-sol`,
effort `high`, 2026-08-09 · **Verdict: MAJOR GAPS** (revision 1).
Every load-bearing claim was independently verified against the tree before
adoption; five were checked directly and all five held. Revision 2 below adopts
them. Deltas are recorded per WI rather than silently patched, because the
errors are instructive about how this kind of plan goes wrong.

**Verify status at any time:**

```bash
bash scripts/check-followups-phase.sh <0-5>   # per-phase DoD
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
| F1 | `tier0-e2e.yml` has never run — zero runs, ever | unproven gate | 2A |
| F2 | Mutation is proven by one hand-dispatch; every scheduled run was cancelled | unproven gate | 2A |
| F3 | `check-wi-linkage.sh` cannot see `scripts/*.test.mjs`, and invents phantom WIs from prose | gate defect | 1 |
| F4 | The refactor landed as one 652-file commit, against its own "no big-bang commit" criterion | no signal | 4 |
| F5 | ~450 units of frozen debt across 27 baselines, none ratcheting down | invisible debt | 3 |
| F6 | Commit-side linkage is satisfied by *any* mention of an ID, including prose describing the bug | gate defect | 1 |

Plus two documentation-hygiene items (Phase 5).

**F6 was found by this plan's own first commit.** That commit message describes
the F3 defect and therefore contains the string `WI-16`; `check-wi-linkage.sh`
scans commit bodies for the bare ID, so it now reports the predecessor plan as
"0 unlinked" — satisfied by prose *about* the bug rather than by the fix. It is
ADR-2's defect on the other side of the gate: the plan-file half invents work
items from prose, and the commit half accepts prose as proof of work. Both halves
need the same treatment, and until WI-AF1.5 lands, "0 unlinked" is a weak signal —
which is why the DoD's load-bearing Phase-1 assertion is the 21-vs-22 count.

## What revision 1 got wrong

Recorded because the failure modes generalise:

1. **The deferral mechanism could not be built as specified.** ADR-1 said
   `deferReview` "mirrors `allowRaise`" and fails as stale against the merge base.
   `allowRaise` works because baseline *values* are read at the base ref;
   `loadManifest` (`check-baseline-ratchet.mjs:138`) only ever loads the **HEAD**
   manifest. Review dates living in the manifest are therefore invisible at the
   base, and the staleness rule was unimplementable. *I asserted a mechanism by
   analogy without reading the loader.* — ADR-1 rewritten.
2. **A date that blocks PRs is the flake class the ADR claimed to avoid.** An
   injected clock makes *tests* deterministic; it does nothing for CI, where the
   same unchanged PR passes at 23:59 and fails at 00:01. — ADR-1 rewritten.
3. **`## 12` already exists** (dark-feature verdicts, `60-ai-governance.md:326`).
   — now §13.
4. **`AGENTS.md:303` carries the same plan-home mandate as governance §1.**
   Amending one authority leaves the repo contradicting itself. — WI-AF5.2 widened.
5. **The DoD checker printed DONE over skipped assertions.** With only its
   REAL-ROOT checks skipped, a fixture phase exited 0 — a green verdict over work
   nobody performed, in the script written to police exactly that. — fixed in
   revision 2 (ADR-6), and the test that asserted the buggy behaviour was
   rewritten to forbid it.

Finding 5 is the one worth sitting with: the checker reproduced the *predecessor's*
fiction class on its first day of life.

## ADRs

**ADR-1 (rewritten) — overdue debt REPORTS on a schedule; PR CI enforces only
transitions.** Two mechanisms, because they answer different questions.
- *Is this debt overdue?* is a question about **today**, so it belongs to a
  scheduled job that opens/updates a rolling issue. No PR is blocked by the
  calendar, which removes the flake class entirely.
- *Did this PR quietly push a deadline out?* is a question about a **diff**, so it
  belongs to the merge-base ratchet. For that to be checkable at all, the review
  schedule moves OUT of `baselineRatchetManifest.mjs` and into
  `scripts/baseline-review-schedule.json` — a plain JSON baseline the existing
  base-reading machinery already handles natively, registered in the manifest
  like any other. A date moved later without an accompanying `deferReview` entry
  is a loosening and fails; the mechanism is the one already trusted, not a new one.

**ADR-2 — Work-item IDs come from declarations, never from prose.** F3's phantom
(`WI-1.6`, quoted inside WI-6's description) is the third instance of one defect
in this repo: the plugin-coupling detector counted `@/stores` in comments, and the
keybinding gate anchored on mentions rather than declarations. Both were fixed by
parsing structure. The linkage checker gets the same treatment — and must preserve
every ID form the current grammar accepts (`WI-AF1.2`, `WI-S1.3`, `WI-SOC.2`,
trailing-letter suffixes), which is wider than the two forms revision 1 named.

**ADR-3 (revised) — the change-size gate is a FORCING FUNCTION, not a control.**
With `required_approving_review_count: 0`, an acknowledgement token the PR author
adds is self-authorized: it cannot prevent anything a determined author wants.
Calling it a control would be the fiction this program exists to delete. What it
honestly buys is that size becomes a *recorded decision* rather than an
unremarked accident, and that the number appears where humans and future audits
can see it. It is telemetry with a speed bump. The gate reads the PR body through
`gh api` at run time, not from the event payload, because `pull_request` without
`types:` does not fire on body edits — a token added after a red check would
otherwise never take effect.

**ADR-4 — `.claude/tdd-guardian/` is a legitimate plan home; §1 is what is wrong.**
Governance §1 and `AGENTS.md:303` both say plans live in `dev-docs/plans/`.
`dev-docs/` is gitignored (`.gitignore:8`); `.claude/tdd-guardian/` is tracked.
Moving the predecessor plan to comply would delete a tracked plan from the repo.
Both authorities are amended together.

**ADR-5 — Liveness is a property of a gate, not of a workflow file.** F1 and F2 are
one defect with two faces: a workflow that exists, is wired, reviews clean, and has
never produced a verdict. Discovery is by an explicit `# liveness-gate: true` marker
so the manifest cannot drift from the workflows, and **no workflow watches itself** —
a disabled workflow's cron stops firing and it cannot report its own silence. The
liveness job and one existing scheduled job watch each other on different cadences.

**ADR-6 (new) — UNVERIFIED is a third state, distinct from DONE and FAILED.** A DoD
assertion that could not be run has not passed. The checker reports UNVERIFIED and
exits non-zero, and phase 5's gitignored index is UNVERIFIED on a clean checkout
rather than silently required. Present-on-disk and property-holds are different
claims; conflating them is how a checker certifies work nobody did.

**ADR-7 (new) — one PR per phase, starting now.** F4's own lesson applies to this
plan first. Phases land as separate PRs; no phase waits for another to be
reviewable. This is the part of Phase 4 that costs nothing and starts immediately,
rather than arriving in Phase 4 after this plan has already accumulated three
phases in one branch.

---

## Phase 0 — Scaffolding and review ✅

### WI-AF0.1 — DoD checker ✅
`scripts/check-followups-phase.sh` + `scripts/check-followups-phase.test.mjs`,
22 tests over fixture trees in both directions. Revision 2 added ADR-6's
UNVERIFIED state after the review found the checker certifying skipped work.

### WI-AF0.2 — Cross-model review ✅
Thread `019fe450-545a-7022-b664-d9dfbe71f9df`, verdict MAJOR GAPS, all findings
adopted or answered above. **No Phase 1 commit lands before this** — satisfied.

---

## Phase 1 — Repair the linkage gate (F3)

> **Governance §9 note.** §9 forbids changing this script without explicit
> authorization; its header already records one grant (2026-07-14). Authorization
> for this change was granted by the maintainer on 2026-08-09. Each WI appends its
> reason to that header, as §9 requires.

**Ordering (review Dim 5 #3): the harness comes first.** Revision 1 demanded
RED-first tests in WI-AF1.1/1.2 while putting the test file last — you cannot write
a failing test in a harness that does not exist.

### WI-AF1.1 — Test harness for the linkage gate
- **Deliver:** `scripts/check-wi-linkage.test.mjs`, real script over fixture plans
  and fixture test trees in tmpdir.
- **Acceptance:**
  - [ ] Covers: linked-via-commit, linked-via-test-header, unlinked, zero-match fail-closed, `--phase` filter, bad path (exit 64).
  - [ ] The zero-match fail-closed property (2026-07-14) is pinned BEFORE the grammar is touched, so widening it cannot silently undo it.

### WI-AF1.2 — See the gates tier (renumbered from revision 1's WI-AF1.1)
- **Problem:** `TEST_HEADERS` globs `src/**/*.test.ts(x)` and `src-tauri/**/*.test.rs`.
  The repo has a fourth test root — `scripts/**` and `.claude/hooks/**`, owned by
  `vitest.gates.config.ts`, 32 files. WI-16's only test lives there, so a correctly
  linked work item reports NOT LINKED.
- **Acceptance:**
  - [ ] RED first: WI-16 links via `scripts/check-baseline-ratchet.test.mjs`.
  - [ ] Glob covers every root the tier partition recognises; a fifth root fails the checker's test rather than being silently unsearched.

### WI-AF1.3 — IDs from declarations, not prose (ADR-2)
- **Acceptance:**
  - [ ] RED first: a prose mention of a foreign ID is not extracted; a declared work item is.
  - [ ] **Every currently-accepted ID form still parses**: `WI-1`, `WI-AF1.2`, `WI-S1.3`, `WI-SOC.2`, trailing-letter suffixes. Table-driven.
  - [ ] Declaration forms both live in this repo: `### WI-N: title` and `**WI-N.M — title**`.
  - [ ] Non-declaration contexts do not count: prose, code fences, blockquotes, tables. Duplicate declarations collapse to one.
  - [ ] Zero-match still FAILS CLOSED.
  - [ ] Predecessor plan extracts exactly 21 work items, not 22.

### WI-AF1.5 — Commit-side linkage requires the tag form (F6)
- **Problem:** `grep -F -q -- "$wi" <<<"$COMMIT_LOG"` accepts the ID anywhere in a
  commit subject or body. A commit that merely *discusses* a work item vouches for
  it. Governance §2 documents the intended form — `feat(scope): change (WI-AF1.2)` —
  and the gate does not require it.
- **Acceptance:**
  - [ ] RED first: a commit whose body mentions `WI-9` in prose does NOT link WI-9; a commit whose subject ends `(WI-9)` does.
  - [ ] The accepted form matches what §2 documents; §2 is corrected if the two disagree, rather than the gate being bent to fit.
  - [ ] Trailer form (`WI: 1.2`) either accepted deliberately or rejected deliberately — decided, not left ambiguous.
  - [ ] Re-running the gate on this branch no longer reports WI-16 linked on the strength of a commit that describes the bug.

### WI-AF1.4 — Delete or implement the phase claim
- **Problem:** the header says it checks only WIs from phases marked complete in the
  plan's Status header. No code parses a Status header. A false claim in the file
  that enforces honesty elsewhere.
- **Acceptance:**
  - [ ] Implemented and pinned, or deleted, with the decision and its reason in the header.
  - [ ] `--phase=N` (which *is* implemented) documented accurately.

**Phase 1 DoD:** `bash scripts/check-followups-phase.sh 1` exits 0.

---

## Phase 2A — Live evidence (F1, F2)

Split from revision 1's single Phase 2 (review Dim 5 #2): getting a real verdict
out of an existing workflow and *building a supervision system* are different
risks and should not share a phase gate.

### WI-AF2.1 — First live run of `tier0-e2e.yml`
- **Authorized:** maintainer, 2026-08-09 — dispatch and iterate to green.
- **Acceptance:**
  - [ ] Dispatched against an explicit `--ref`; run ID captured.
  - [ ] `gh run view <id> --json headSha,conclusion,jobs` shows the dispatched SHA, `conclusion: success`, and per-job success. Never a bare `gh run watch`.
  - [ ] Any failure is FIXED, not recorded — the run is the point.
  - [ ] Result recorded in the workflow header, replacing the "its first live run is…" future tense.
  - [ ] **The record is verified, not trusted** (review Dim 2 #6): a comment is forgeable, so the DoD re-checks the recorded id/SHA through `gh api` — workflow identity, event, head SHA, conclusion, job conclusions.

### WI-AF2.2 — Mutation's scheduled lane
- **Acceptance:**
  - [ ] A **structured evidence record** (not narrative): per historical run — id, event, conclusion, timestamps, and cancellation reason where the API exposes it.
  - [ ] Root cause stated from that evidence: concurrency group, 6-hour limit, or manual. A guess is not an answer, and "probably timeouts" is a guess.
  - [ ] If structural, fixed. If pre-repair timeouts, that is the recorded conclusion.
  - [ ] The 2026-08-10 06:00 UTC scheduled run is checked and its verdict recorded. A `workflow_dispatch` is **not** evidence about the schedule path.

**Phase 2A DoD:** a verified-green tier0 run record and a mutation evidence record.

---

## Phase 2B — Gate-liveness supervision (ADR-5)

The deferred item from the predecessor plan whose absence is why F1 survived merge.
**Spike first** (review Dim 5 #2): GitHub run-history semantics, workflow identity
across renames, pagination, and the supervision topology are all unresolved.

### WI-AF2.3 — Liveness spike
- **Acceptance:**
  - [ ] A runnable probe answering, against real `gh api` data: what counts as a *verdict* (which conclusions), how cadence grace is computed, how a renamed or disabled workflow is identified, how pagination and rate limits behave.
  - [ ] Findings recorded before any production script is written.

### WI-AF2.4 — `scripts/check-gate-liveness.mjs` + schedule
- **Acceptance:**
  - [ ] RED first: fixture gate whose last verdict predates its cadence → exit 1 naming it.
  - [ ] **Discovery by marker**, not a hand-list: a workflow opts in with `# liveness-gate: true` and declares cadence + expected on-failure path. Two-way staleness — a marked workflow missing from the manifest fails, and vice versa.
  - [ ] **Zero runs is the loudest case, not the quietest** — it is the F1 state.
  - [ ] **Fails closed** on unreachable `gh`, malformed JSON, or rate limiting.
  - [ ] **No self-watching** (ADR-5): the liveness job and one existing scheduled job watch each other on different cadences. The topology is stated in the workflow header, and the mutual arrangement is what enforces it — a header sentence is not supervision.
  - [ ] Reports into a single rolling issue (the `mutation.yml` pattern).
  - [ ] Verifies WI-AF2.1's recorded tier0 run through `gh api`, so Phase 2A's evidence stays true rather than merely having been true once.

**Phase 2B DoD:** `bash scripts/check-followups-phase.sh 2` exits 0.

---

## Phase 3 — Frozen debt becomes scheduled debt (F5, ADR-1)

Frozen debt, measured 2026-08-09:

| Baseline | Frozen | Movement since 2026-08-04 |
|---|---:|---|
| `mock-boundaries-baseline.json` | 274 store-mock triples / 140 files | none |
| `command-error-baseline.json` | 99 legacy `Result<T, String>` / 36 files | none |
| `.dependency-cruiser-known-violations.json` | 75 per-edge violations | none |
| `plugin-store-coupling-baseline.json` | services/hooks/components channels | none |
| `file-size-baseline.json` | 92 files | down from 153 ✅ |

Scope is the mechanism, not bulk paydown (maintainer decision, 2026-08-09).

### WI-AF3.1 — Spike the schedule mechanism on two baselines
Review Dim 5 #4: revision 1 went from a loosely specified mechanism straight to
dating all 27 entries. A wrong transition model blocks CI repo-wide.
- **Acceptance:**
  - [ ] One synthetic baseline + one real debt baseline only.
  - [ ] All six transitions exercised against scratch git repos: first introduction (absent at base), a brand-new baseline, an earlier date, an unauthorized later date, an authorized deferral, and a stale deferral.
  - [ ] Migration case settled explicitly: every date is absent from the base on the introducing PR, so "absent at base" must be *allowed once* and never confusable with a silent extension.

### WI-AF3.2 — `scripts/baseline-review-schedule.json` (ADR-1)
- **Acceptance:**
  - [ ] Schedule lives in its own JSON baseline, registered in the manifest — so the merge-base machinery reads it natively and the HEAD-only manifest-loader limitation never applies.
  - [ ] **Per-check, not per-entry** (review Dim 1 #1): entries like `file-size-baseline.json` carry four independent checks; one `target` cannot describe them.
  - [ ] `target` semantics defined per comparison mode, with how progress is computed.
  - [ ] An explicit **exemption class with a stated reason** for baselines that are not debt (immutable corpora, empty invariants). An exemption is a claim, not a convenience — and a stale one fails, like every other allowlist here.
  - [ ] Strict schema: UTC dates, malformed/impossible dates rejected, due-day equality defined, `deferReview` fields `{path, check, from, to, reason}` with an exact transition rule and a maximum horizon.
  - [ ] Clock injected at the seam; never `Date.now()` inside a comparator.

### WI-AF3.3 — Overdue reporter
- **Acceptance:**
  - [ ] Scheduled job opens/updates a rolling issue listing overdue baselines with owner and target. **No PR is blocked by the calendar.**
  - [ ] Registered as a liveness gate under WI-AF2.4's marker — the reporter must not become the next thing that silently stops running.

### WI-AF3.4 — Date all 27, and stop quoting live numbers
- **Acceptance:**
  - [ ] All 27 carry a schedule entry or a reasoned exemption; no placeholder dates; dates staggered.
  - [ ] `.claude/rules/00-engineering-principles.md` stops asserting "153 pre-existing violators" (it is 92) and references the baseline file as the authority. Same sweep for any other rule restating a live gate number.
  - [ ] `node scripts/check-baseline-ratchet.mjs origin/main` exits 0.

**Phase 3 DoD:** `bash scripts/check-followups-phase.sh 3` exits 0.

---

## Phase 4 — Make change size a recorded decision (F4, ADR-3)

### WI-AF4.1 — `scripts/check-change-size.sh`
- **Acceptance:**
  - [ ] RED first: fixture diff over threshold without acknowledgement → exit 1; with → exit 0.
  - [ ] **Metrics defined, not implied** (review Dim 4 #3): files vs churn, additions vs deletions, renames, binaries, generated artifacts, locale fan-out, vendored trees — with exclusions and threshold-combination logic committed as data plus the measured PR-size distribution that justifies the numbers.
  - [ ] PR body read via `gh api` by PR number at run time (ADR-3), never from the event payload; body text passed through env/API data, never shell interpolation.
  - [ ] **Fails closed** when base ref, PR number, or body cannot be resolved.
  - [ ] PR-only in `ci.yml` beside `check-new-deps.sh`; deliberately absent from `check:all` (a local checkout cannot guarantee a base ref).
  - [ ] `85dc54405` (652 files, +33,935) is the fixture that must trip it; a normal PR from the measured distribution must not.

### WI-AF4.2 — Test + governance §13
- **Acceptance:**
  - [ ] `scripts/check-change-size.test.mjs`, real script over scratch-git fixtures, both directions.
  - [ ] `.claude/rules/60-ai-governance.md` gains **§13** — §12 is taken by the dark-feature verdicts.
  - [ ] §13 states what the gate does **and does not** buy: with zero required approvals the token is self-authorized, so this is a forcing function, not enforcement. Overselling it would recreate the class this program deletes.
  - [ ] `check-scripts-parity.test.mjs` green (new gate has a CI home; `check:all` composition unchanged).

**Phase 4 DoD:** `bash scripts/check-followups-phase.sh 4` exits 0.

---

## Phase 5 — Documentation hygiene

### WI-AF5.1 — `dev-docs/README.md` (maintainer-local)
- **Acceptance:**
  - [ ] Index covering `plans/`, `deep-researches/`, `audit/`, `grills/`, `baselines/`, `e2e/`; every deep-research linked (AGENTS.md's archive rule).
  - [ ] Explicitly local-only: `dev-docs/` is gitignored, so a clean checkout reports UNVERIFIED for this assertion rather than failing or silently passing (ADR-6).

### WI-AF5.2 — Reconcile BOTH plan-home authorities (ADR-4)
- **Acceptance:**
  - [ ] Governance §1 **and** `AGENTS.md:303` amended in the same change, naming both homes and the rule for choosing.
  - [ ] The reason recorded: a rule that would delete a tracked plan is the rule that is wrong.

**Phase 5 DoD:** `bash scripts/check-followups-phase.sh 5` exits 0.

---

## Sequencing

One PR per phase (ADR-7). The DAG:

```
Phase 0 ✅
  ├─ Phase 1  (independent)
  ├─ Phase 2A (independent, externally blocked on runner + the 08-10 schedule)
  │    └─ Phase 2B (needs 2A's evidence to have something to supervise)
  ├─ Phase 3  (WI-AF3.1 spike gates WI-AF3.2..3.4; WI-AF3.3 registers with 2B's marker,
  │            so it lands after 2B or carries a stated follow-up)
  ├─ Phase 4  (independent)
  └─ Phase 5  (independent)
```

Phases 1, 3, 4, 5 do not wait on 2A. If the live run becomes a multi-day fight,
everything else still lands.

## Risks

- **WI-AF2.1 has unbounded cost.** A first-ever headless-WebKitGTK run can fail for
  reasons unrelated to this plan (Xvfb, the 9323 bridge, sidecar spawn, a
  cache-cold Rust build inside 45 min). Mitigation: its own phase; nothing blocks on it.
- **WI-AF2.4 is as risky as WI-AF2.1** (review Dim 5 #2), which revision 1 denied.
  Mitigation: WI-AF2.3 spikes the API semantics and supervision topology first.
- **Phase 3 can block CI repo-wide** if the transition model is wrong. Mitigation:
  WI-AF3.1's two-baseline spike, and ADR-1 moving overdue-ness off the PR path entirely.
- **WI-AF1.3 changes a §9-protected grammar.** Widening it once already produced a
  false green (2026-07-14). Mitigation: WI-AF1.1 lands the harness and pins
  fail-closed *before* the grammar moves.
- **ADR-3 is a weak control by construction.** Stated plainly rather than mitigated;
  strengthening it needs a trusted-actor review requirement, which is a governance
  change beyond this plan.

## Deferred / out of scope

- **Bulk paydown of the frozen baselines** — maintainer decision 2026-08-09. WI-AF3.2's
  dates are what schedule it.
- **Retroactively splitting `85dc54405`** — history rewrite on a protected branch, no
  benefit Phase 4 does not deliver forward.
- **Requiring a trusted approver for oversized PRs** — the only thing that would make
  ADR-3 a real control; a branch-protection change, its own decision.
- **Migrating `src/test/setup.ts` off its silent-success `invoke` default** — still live
  at `setup.ts:111`, still the false-confidence class, still too much blast radius
  (predecessor's deferral, unchanged).
- **Popup-layer convergence (A1 follow-on)** — unchanged from the predecessor's deferral.

## Definition of Done (whole plan)

```bash
bash scripts/check-followups-phase.sh all   # exit 0
pnpm check:all                              # exit 0
```

Plus a `gh api`-verified green `tier0-e2e.yml` run, and
`bash scripts/check-wi-linkage.sh .claude/tdd-guardian/plan-20260809-followups.md`
reporting zero unlinked.
