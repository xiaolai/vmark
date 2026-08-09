# Baseline debt paydown — the mechanical half

**Status:** revision 4. Phases 0 and 1 **DONE**. Phase 2 **IN PROGRESS** (99 → 67
legacy signatures; the migration also exposed a red file-size gate and rustfmt
drift at HEAD, both now fixed). Phase 3 pilot **DONE**, bulk not started.
Phase 4 **DONE for the exact duplicates** (88 → 80); the remaining 80 are blocked
on a design ruling, not on throughput — see WI-DP4.1.
**Date:** 2026-08-09
**Cross-model review (governance §6):** Review thread: `019fe5eb-36fb-7ee2-9f1b-65d8512e84c6`
· Codex `gpt-5.6-sol`, effort high · **Verdict on revision 1: MAJOR GAPS.**
Load-bearing claims verified against the tree before adoption.
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
| `mock-boundaries-baseline.json` | 268 across 135 files | mixed: ~48 files need assertion rewrites, the rest are substitution (measured by WI-DP3.0) |
| `bespoke-buttons-baseline.json` | 88 named + 80 styled, **149 unique** | 61 of the 80 are usage-only; 19 overlap the named set |
| `command-error-baseline.json` | 99 across 36 files | established pattern, 8 `From` impls, coherence migrated as the worked example |
| `knip-baseline.json` | **0** (was 75) | cleared, WI-DP1.2 |
| `merge-drop-allowlist.json` | **0** (was 2) | both claims verified real, entries removed, WI-DP1.1 |

Revision 1 called the whole set "one pattern applied repeatedly". For
`command-error`, `knip` and `merge-drops` that held — both of the latter are now
zero. For `mock-boundaries` it did not, but revision 2 then over-corrected: it
claimed 112 of 139 files assert on mocked store actions, from a `grep -c
toHaveBeenCalled` that also counted local callbacks and `@tauri-apps` boundary
mocks. **WI-DP3.0 measured it properly: ~48.** Roughly a third need assertion
rewrites; the rest are substitution. Both earlier numbers were wrong, in
opposite directions — see WI-DP3.0 for the method and the table.

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

**ADR-1 (amended) — the baseline is a PROGRESS METRIC; the DoD is baseline +
gate + evidence.** Revision 1 said "the baselines are the DoD", and the checker
implements that literally: it reads JSON and nothing else. So a hand-lowered
number passes it while the code got worse, `CommandError::internal` abuse is
invisible to a signature count, and a deleted test lowers the mock count exactly
like a converted one. Three things are now required per phase: the baseline
target, the real gate exiting 0, and phase-specific semantic evidence (named per
phase). The checker still introduces no counter of its own — that part was right.

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

**ADR-5 (REVERSED after review) — a zero baseline is kept, permanently.**
Revision 1 said to delete the file at zero. That is provably wrong here:
`check-mock-boundaries.mjs` and `check-command-error-ratchet.mjs` both read their
baseline and fail when it cannot be parsed, so deleting one breaks `check:all` —
the phase could never complete. It is also wrong in principle. A zero baseline is
not documentation of paid debt; it is the *expected-set* that makes recurrence
fail, exactly as `i18n-untranslated-baseline.json` is kept empty on purpose.
Remove it from the attention REPORT (move it to `exempt` with the reason
"already zero, the gate keeps it there"), never from enforcement.

---

## Phase 0 — Scaffolding and review

### WI-DP0.1 — DoD checker
- [x] `scripts/check-paydown-phase.sh` + `.test.mjs`. A phase with nothing done
      reports NOT STARTED, which does not share an exit code with DONE. There is
      deliberately no UNVERIFIED state — every assertion reads a file that is
      always present. Revision 1 copied that branch from the predecessor and
      nothing incremented its counter: a contract claimed in a header and
      unreachable in code. Removed.
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

**Status:** DONE — 2026-08-09
**Changed:** scripts/merge-drop-allowlist.json, scripts/baseline-review-schedule.json
**Verified:** `pnpm lint:merge-drops` PASS · `pnpm lint:review-schedule` (28 baselines, 12 tracked / 16 exempt) · `node scripts/check-baseline-ratchet.mjs origin/main` held
**Outcome:** both claims verified as REAL relocations, so both entries were removed
rather than fixed. `resolveSaveFilters` → `saveFiltersForFilePath` at
`services/windowClose/closeSaveShared.ts:66` (used by `closeSave.ts:98`,
`closeSaveBatch.ts:76`); disk-open ingest routing at
`services/mcpBridge/v2/workspaceOpen.ts:137`. Baseline kept at zero per ADR-5 and
moved `tracked` → `exempt`.
**Found while verifying:** both allowlist KEYS named `src/hooks/…` paths that
WI-10 moved to `src/services/…` on 2026-08-04. The entries outlived their files
by five days and nothing noticed — this gate has no staleness check, unlike every
other allowlist here. Recorded under Outstanding work; fixing it is outside this
WI's scope.

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

### WI-DP1.2 — `knip` 75 → 0

**Status:** DONE — 2026-08-09
**Changed:** 55 source files across `src/`, `server/mcp/`, `server/content/`; `scripts/knip-baseline.json`
**Verified:** `pnpm knip` → zero unused exports/types · `npx tsc -p tsconfig.json --noEmit` exit 0 · `pnpm lint` PASS · `pnpm lint:knip-baseline` held at 0 · **`pnpm test` exit 0 (1,449 files, 34,960 tests)**
**How:** two distinct fixes, not one. Where the symbol was still used inside its
own file, the export keyword came off — that is what knip's "unused export"
actually means, and the symbol stays. Where it was used nowhere, it was deleted
outright (`CONSOLE_SHIM`, `SitePublisher` and its orphaned `PublishInput` /
`PublishResult`, `BridgeOperationName`, `MDAST_NODE_TYPES`). No `knip-ignore`
comments (ADR-2), and no entry-point declarations were needed.
**Two things worth keeping:**
1. **A blanket transform was wrong.** Stripping `export ` mangled five type-only
   re-export statements (`export type { A, B } from "…"`) into invalid syntax,
   and `tsc` caught every one. knip findings need per-item judgement.
2. **Four of them had real consumers.** `LineMatch`, `EffectiveTerminalPosition`,
   `SetContentOptions` and `MAX_TERMINAL_SESSIONS` were flagged at their
   definition site because only a barrel referenced them; removing both ends
   broke live imports in `ContentSearch`, `TerminalTabBar` and `useTerminalPosition`.
   `tsc` caught these too. **Running the full suite was the load-bearing check** —
   test files are excluded from `tsconfig`, so a test importing a removed export
   would have survived typecheck.

> **Target frozen at zero**, not "as low as the code allows" (revision 1). A
> movable target lets the phase redefine success once the hard cases appear. If a
> finding turns out to be a legitimate public export, the fix is to declare it as
> an entry point in `knip.json` — a reviewed configuration change — not to leave
> a number and call it done.
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

### WI-DP2.1 — `browser/commands.rs` 14 → 0

**Status:** DONE — 2026-08-09
**Changed:** src-tauri/src/browser/commands.rs, scripts/command-error-baseline.json
**Verified:** `cargo clippy --all-targets -- -D warnings` exit 0 · `cargo test` exit 0 · `pnpm lint:command-errors` held at 85 · merge-base ratchet held · frontend consumers 66 files / 1,314 tests green · `tsc` exit 0
**Result:** baseline 99 → 85.

**What the module was doing:** flattening every failure through
`fn err<E: Debug>(e) -> String { format!("{e:?}") }` — a typed error rendered to
its Debug form, class discarded. And `browser_create` hand-rolled
`Err("BROWSER_DISABLED".into())` *beside* `ai_guards::require_browser_enabled`,
a typed helper for the identical condition. Every helper this migration needed
already existed one file away.

**Classification, per ADR-2 — no `internal` as a shortcut:**
- policy gate → `require_browser_enabled` (`FeatureDisabled` + mcpCode)
- poisoned mutex → `lock_failure` (`Internal`; that is what it is)
- registry failures → the existing `From<BrowserError>` impl
- native/`surface::*` failures → `surface_failure`, which already classifies
  window-gone vs. rejected-URL rather than lumping them
- `validate_bounds` → `CommandError::invalid_input`, **not** localized. A NaN
  rect comes from a detached node's `getBoundingClientRect`: a caller bug, never
  user-readable prose. My first pass invented `errors.browser.invalidBounds` and
  it resolved in **0 of 10** locale bundles — rule 50 §10 reserves `i18nKey` for
  user-facing text, and ten translations of a programmer error is the wrong
  artifact.

**Not done, and why:** the transitional `String(error).includes("APPROVAL_REQUIRED")`
in `browserFailure.ts:29` stays. Its own comment says it dies with the last
unmigrated producer, and `authorize.rs` and `commands_auth.rs` still return the
bare token. Deleting it now would break the human approval path.

### WI-DP2.2 — `pty.rs` 8 → 0

**Status:** DONE — 2026-08-09
**Changed:** src-tauri/src/pty.rs, scripts/command-error-baseline.json
**Verified:** `cargo clippy --all-targets -- -D warnings` exit 0 · `cargo test` exit 0 · `pnpm lint:command-errors` held at 77 · terminal frontend 48 files / 989 tests green · `tsc` exit 0
**Result:** baseline 85 → 77.

Three classes, each named once in a helper rather than restated per call site:
`not-found` for an unknown pid (the frontend polls after a `pty:exit` event, so
"session gone" is an ordinary race and must be distinguishable from a fault),
`io` for a real device failure on write/resize/kill, and `internal` for a
poisoned mutex or tokio join failure. A second `pty_start` on one session became
`conflict` — caller sequencing, not I/O.

`internal` is used only where the process is in a state it should not be able to
reach. ADR-2 forbids it as a shortcut for "unclassified", which is exactly why
the other three exist.

### WI-DP2.3 — the driver-authorization gate 10 → 0

**Status:** DONE — 2026-08-09
**Changed:** src-tauri/src/browser/{authorize,commands_auth,session_commands,eval_macos}.rs,
authorize.test.rs, all ten `src-tauri/locales/*.yml`, browserFailure.ts, scripts/command-error-baseline.json
**Verified:** `cargo clippy --all-targets -- -D warnings` exit 0 · `cargo test` exit 0 · `pnpm lint:i18n` 0 untranslated · `pnpm lint:command-errors` held at 67 · merge-base ratchet held · 45 frontend files / 497 tests green · `tsc` exit 0
**Result:** baseline 77 → 67 (`authorize.rs` gate + `commands_auth.rs` 7 + `session_commands.rs` 3).

**BEHAVIOUR IS PRESERVED EXACTLY, and that constraint chose the codes.** None of
this gate's refusals raised an approval prompt before: they were bare strings, so
`parseCommandError` returned null and `needsNavigationApproval` fell through to a
substring test none of them contained. Mapping `ATTACHMENT_REQUIRED` to
`approval-required` — which is what it *means* — would have started prompting
where VMark previously refused outright: a UX change smuggled in under a typing
change. So the liftable-looking ones are `permission-denied` and the
world-changed ones are `conflict`, each carrying its original token as
`detail.mcpCode` so shipped MCP clients match exactly what they did before.
The day one of them should prompt, that becomes a deliberate edit.

`PROFILE_ORIGIN_CONFINED` is the one that is genuinely hard-denied — the call
site says not even a one-shot may rescue it — and `permission-denied` is the code
that says "no approval lifts this".

**Five new i18n keys, translated in all ten bundles** (staleCommand,
noCommittedPage, notGranted, attachmentRequired, profileOriginConfined).

**The tests got better, not just different.** Every assertion here compared an
error STRING (`assert_eq!(err, "POLICY_STALE")`, `err.contains("stale command")`)
— the wiring shape `10-tdd.md` calls an anti-pattern, which passed on any reword
and could not tell `permission-denied` from `conflict`. They now assert `code()`
AND `mcpCode`, so both audiences are pinned.

**The substring match is still there, deliberately.** `browserFailure.ts:29`'s
comment named "the unmigrated `browser_create` path", which is typed as of
WI-DP2.1, and a sweep finds no remaining bare-token producer. It is kept because
a grep is weaker evidence than a gate and the cost of being wrong is asymmetric:
losing that line turns "ask the user" into "fail silently" on a security path.
The comment now says exactly that, and names the condition that retires it —
`pnpm lint:command-errors` reporting 0.

### WI-DP2.4 … WI-DP2.n — the remaining 67, one module per batch

**Next, and deliberately not taken at the end of a long session:**
`commands_auth.rs` (7) plus its `authorize.rs` helper. That pair is where
`APPROVAL_REQUIRED` is produced, so migrating it is what finally deletes the
`String(error).includes(...)` in `browserFailure.ts:29`. It is also a security
DECISION surface: each token maps to a code that determines whether the UI
raises an approval prompt (`approval-required`) or refuses outright
(`permission-denied`), and `PROFILE_ORIGIN_CONFINED` vs `ATTACHMENT_REQUIRED`
are on opposite sides of that line. Getting one wrong changes what the user is
asked. It needs a focused pass, not a tired one.
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

## Phase 3 — `mock-boundaries` — RECLASSIFIED, not yet plannable

**Revision 1 called this mechanical. It is not, and the number that settles it is
112 of 139.** That many mocked-store test files assert `toHaveBeenCalledWith` on
a mocked store action. Those assertions cannot survive the migration: a real
Zustand action is not a spy, so there is nothing to have been called. Revision 1's
safeguard — "every test still asserts the same behaviour" — is *impossible* for
80% of the files, which means it was not a safeguard, it was a sentence.

What this work actually is: converting wiring assertions (`10-tdd.md` Level 6-7,
which that rule names an anti-pattern and says must never stand alone) into
behaviour assertions on real state (Level 1/4). That is worth doing and is
strictly better than the status quo — but it is a per-file design decision about
what each test is really for, repeated 112 times. It is a test-architecture
migration wearing a substitution's clothes.

Three further defects in revision 1's approach, all confirmed:

- **Per-store batching makes it worse, not safer.** Many files mock three to six
  stores. Store-first batching walks each of those files through hybrid
  real/fake configurations that never existed before or after, so a regression is
  attributable to a state no version of the code was ever in. Conversion must be
  **atomic per test file**, batched by archetype.
- **No reset harness exists.** Real stores bring persistence middleware,
  import-time subscriptions, module caches and cross-store invariants. There is
  no canonical snapshot/teardown, and 274 conversions cannot each invent one.
- **"Store-factory seam" is four different architectures** — production factory,
  DI port, test helper, alternate Zustand instance — and revision 1 named none.

**WI-DP3.0 (new, blocking): pilot before planning.** Convert one file from each
archetype — persistence-backed store, React-selector consumer, multi-store
service, `vi.doMock` — and record what each cost and what the assertions became.
Only then is the rest of Phase 3 estimable. Scope, batching and target are set
from the pilot, not from revision 1's guess.

### WI-DP3.0 — pilot

**Status:** DONE — 2026-08-09
**Changed:** `src/components/Terminal/fileLinkProvider.test.ts`,
`src/components/BottomBar/BottomBar.test.tsx`,
`src/components/Editor/useTiptapFlush.test.ts`,
`src/plugins/markdownCopy/tiptap.test.ts`,
`src/components/Terminal/setupCopyOnSelect.test.ts`,
`scripts/mock-boundaries-baseline.json`
**Verified:** each file's suite green on conversion; then 46 files / 975 tests
green together · `pnpm lint:mock-boundaries` held · `pnpm lint` PASS
**Result:** 274 → 268 triples, 139 → 135 files.

**THE ESTIMATE THAT PRODUCED THIS PHASE'S RECLASSIFICATION WAS WRONG.** Revision 2
said 112 of 139 files assert on mocked store actions and concluded the phase was
design-heavy throughout. That number came from `grep -c toHaveBeenCalled` over
whole files — it counted assertions on local callbacks and on legitimate boundary
mocks. Measuring what the assertions are actually *on*:

| Measurement | Files | Why it was wrong |
|---|---:|---|
| any `toHaveBeenCalled` in the file | 112 | counts local callbacks and `@tauri-apps/*` mocks |
| name declared `vi.fn` anywhere in a hoisted block | 25 | undercount; misses spies wired inside the factory |
| **name referenced INSIDE the store's mock factory** | **~48** | the defensible upper bound |

So roughly **a third** of the files need assertion rewrites, not 80%. The other
two thirds are the substitution revision 1 described.

**What the five conversions cost, and what they taught:**

1. **`fileLinkProvider` (plain)** — ~5 min, purely mechanical. Its eight
   `toHaveBeenCalledWith` assertions are on `onActivate`, a callback the *test*
   owns. Untouched.
2. **`BottomBar` (React selector)** — the mock replaced `useTabStore` with a bare
   `selector(state)` call; the real hook subscribes. **The first version of this
   claimed the conversion "exercises the subscription" while every `setActive()`
   ran BEFORE `render()`** — which only tests the initial snapshot. Audit
   019fe61c caught it. A mounted document→browser→document transition was added,
   and that case a `selector(state)` fake could not have covered; the claim is
   now true rather than asserted.
3. **`useTiptapFlush` (multi-store)** — two stores converted together. Confirms
   ADR-3's revision: a store-by-store pass would have left this file half real
   and half fake, a configuration no version of the code has ever had.
4. **`markdownCopy` (`vi.doMock`)** — the only store `doMock` lived inside
   `_getPluginInstance`, which nothing called, beside `_mockSettingsGetState`,
   which nothing read. The conversion was a **deletion**. A count of mocks cannot
   tell this apart from the expensive cases.
5. **`setupCopyOnSelect` (looks hard, is easy)** — flagged as unconvertible
   because `mockWriteText` and `mockClipboardWarn` are asserted and were declared
   in the same `vi.hoisted` block. They mock `@tauri-apps/plugin-clipboard-manager`
   and `@/utils/debug` — boundaries that stay. Only the store fake went; every
   assertion survived.

**Phase 3 is now estimable.** ~87 files are substitution at roughly the cost of
(1) and (3); ~48 need assertion rewrites, which is the real work and is worth
doing on its own terms — those tests assert wiring, which `10-tdd.md` names an
anti-pattern. Batch atomically per file, easy archetypes first to keep the
baseline moving while the hard set is worked through deliberately.

**Remaining Phase 3 target: 268 → 0, with the ~48 rewrite files tracked
separately.** Not attempted in this pass.

## Phase 4 — `bespoke-buttons` 168 → down

88 by name + 80 by usage, 61 of which the name check cannot see.

### WI-DP4.1 — convert to the canonical components

**Status:** DONE (duplicates) — 2026-08-09 · all 8 exact duplicates converted, 88 → 80 by name
**Changed:** src/plugins/{linkPopup,footnotePopup,imagePasteToast,mediaPopup,sourceLinkPopup,sourceImagePopup,sourceWikiLinkPopup,sourceFootnotePopup}/*, src/styles/media-popup-shared.css, scripts/{bespoke-buttons,file-size}-baseline.json
**Verified:** `pnpm lint:bespoke-buttons` 80/80 both counts · 1006 tests across the nine touched plugins · `tsc`, `lint:design-tokens`, `lint:file-size`, `lint:store-coupling` green

**The remaining 80 are NOT duplicates** — the deliberately-different set below
still needs a design ruling, which is why this WI is done only for the half it
could settle on evidence.

**How the last 7 were proven equal — the comparator lied first.** A per-rule
diff initially reported 6 of the 7 as REVIEW and `.media-popup-btn` as
DUPLICATE. Both verdicts were artifacts: it captured leading CSS comments into
the selector key, it did not normalise the canonical's `:hover:not(:disabled)`
against a bespoke `:hover`, and — the dangerous one — it reported DUPLICATE for
`.media-popup-btn` because it matched **zero** rules there (wrong path), so an
empty diff read as identical. A vacuous pass looks exactly like a real one.
The rebuilt comparator diffs declarations per suffix and reports which side is
missing a rule, which is what produced the actual finding: **the canonical is a
strict superset of all seven** — identical base/hover/active/svg, plus
`flex-shrink: 0`, a real `:disabled` rule, and the `:not(:disabled)` guards.

**Two apparent differences that were aliases, checked rather than assumed:**
- `--accent-primary` vs `--primary-color` in the image-paste-toast focus ring.
  A grep for `--token:` assignments was NOT sufficient — a runtime writer using
  `setProperty` would not match it. `computeCoreColorVars` writes both from the
  same `colors.link` field, and the committed `emittedCssVars` snapshot has them
  equal in all six themes. Stronger than a screenshot, and it covers dark mode.
- `4px` vs `var(--radius-sm)` — the same value.

**A base class can be a BEHAVIOURAL consumer, not just a style hook.**
`.image-paste-toast-btn` was how the Tab focus trap enumerated its buttons, so
retiring it broke focus cycling — caught by the plugin's own tests, not by any
gate. A sweep of all eight retired classes for `querySelector` /
`classList.contains` / `closest` found no second instance, so this was one case
rather than a class. **Check for this before retiring any future class.**

**The file-size gate was already red at HEAD, and nothing had said so.** The
WI-DP2.x migration pushed `browser/authorize.rs` to 337 and `pty.rs` to 315;
`check:all` had not been run since. Split into `browser/refusals.rs` (the
refusal vocabulary) and `pty/reader.rs` (`pty_start` + its reader thread) —
270 and 197. `cargo fmt` also rewrapped five files whose typed signatures had
grown past 100 columns, i.e. **rustfmt drift had reached a commit**, exactly as
`60-ai-governance.md` §10 describes: `check:all` is frontend-only and never
runs `cargo fmt --check`.

**THE PHASE SPLITS IN TWO, AND ONLY ONE HALF IS MECHANICAL.** A declaration-set
comparison against the two canonical surfaces separates them:

- **Exact duplicates — 8 classes** (`link-popup-btn`, `media-popup-btn`,
  `math-popup-btn`, `footnote-popup-btn`, `image-paste-toast-btn`,
  `source-link-popup-btn`, `source-image-popup-btn`,
  `source-footnote-popup-btn`, `source-wiki-link-popup-btn`) re-declare
  `.popup-icon-btn` with **zero differing declarations** — base rule, hover,
  active, focus-visible and its `::after` underline, and svg sizing. Converting
  these is free and provably so.
- **Deliberately different — the rest.** `.find-bar-nav-btn` is 24px with a 12px
  icon against the canonical 26/14, and `.find-bar-icon-btn` adds a border the
  canonical does not have. "Converting" those CHANGES THE UI. That is a design
  decision about how the find bar should look, not cleanup, and it is not mine
  to make silently.

So the honest target is not 149 → 0. It is: convert the duplicates, and for each
remaining class decide whether its difference was intended. The budget can only
fall by the duplicates without someone ruling on the rest.

**Verification method, which turned out to matter more than screenshots.** The
first attempt screenshotted the popup and could not even see it — the popup
renders but was not in frame. Diffing COMPUTED STYLES from the live app is
stronger evidence for "no visual change" than a picture and my eye: it compares
13 resolved properties per button plus icon geometry, and it is what "identical"
actually means. The screenshot remains useful for layout, not for equality.

**Two mechanics worth recording for the next conversion:**
1. **Vite HMR does not re-run the popup builder.** The class name is assigned in
   `linkPopupDom.ts`; after editing it the live DOM still carried the old class
   until a full `location.reload()`. Measuring before the reload would have
   compared the old build against itself and reported a false pass.
2. **The canonical is strictly better than what it replaced.** `.popup-icon-btn`
   guards hover/active with `:not(:disabled)` and defines a `:disabled` rule the
   duplicate lacked, so a disabled link-popup button used to take hover styling.

- [x] Every EXACT duplicate replaced by `.popup-icon-btn` per
      `32-component-patterns.md`. 8 of 8 done; budget 88 → 80.
- [ ] **Open, and it is a design call, not cleanup:** the remaining 80 differ
      on purpose or are unexamined. `.find-bar-nav-btn` is 24px/12px against
      the canonical 26/14 and `.find-bar-icon-btn` carries a border the
      canonical lacks — converting those CHANGES THE UI. Someone has to rule
      on whether the find bar should look like everything else; until then the
      budget cannot fall further on evidence alone.
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
- **Phase 3's classification WAS wrong, and the review found it before any code
  was written.** That is ADR-4 working as intended, one phase earlier than
  expected. The residual risk is now the pilot's: that converting wiring
  assertions to behaviour assertions turns out to be genuinely hard per file, in
  which case this phase is a multi-week programme and should be split out of this
  plan entirely rather than carried as its bulk.
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
