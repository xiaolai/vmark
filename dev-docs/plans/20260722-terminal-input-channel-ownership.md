---
title: "Terminal input — Channel Ownership migration"
created_at: "2026-07-22 00:17 local"
mode: "full-plan"
status: "IN PROGRESS — Phases 1-3/5 code-complete behind default-off flag; Phase 4 blocked (human IME matrix). Codex-reviewed 2026-07-22 (MAJOR GAPS on Phase 4 → split into 4a/4b)."
audit: "dev-docs/deep-researches/20260721-terminal-input-architecture-audit.md"
plan_review: "Codex gpt-5.6-terra, thread 019f8744, 2026-07-22 — MAJOR GAPS for Phase 4; findings folded into WI-4a/4b"
dod_checker: "scripts/check-terminal-input-phase.sh"
---

## Status header

| Phase | Name | State | DoD gate |
|---|---|---|---|
| 0 | Trace harness + measurement | **DONE for automatable parts** — Q1/Q3 measured, recorder built, browser tier stood up + smoke; real IME trace *capture* is human (WI-0.3) | `bash scripts/check-terminal-input-phase.sh 0` |
| 1 | Safe structural fixes (no arbitration change) | **DONE** (gate 7/7, `check:all` green) | `… 1` |
| 2 | Channel Ownership behind a flag | **CODE DONE, default-off** (gate 10/10; T1/T2/T3 verified in real WebKit for ASCII + direct non-ASCII **only** — real IME composition cycles are NOT machine-verifiable and remain pending human, WI-0.3) | `… 2` |
| 3 | Collapse to a single writer | **CODE DONE, default-off** (gate 4/4; resolveCommit 100% mutation). Achieved via direct-to-PTY commit, NOT `term.input` — see WI-3.1. **Real IME cycles still pending human (WI-0.3), same as Phase 2.** | `… 3` |
| 4a | Flip default to `gate` (legacy kept intact) | **DONE** (2026-07-22, gate 5/5) — human confirmed gate works across macOS Pinyin/Zhuyin + WeChat, Linux fcitx5/rime, Windows MS-IME; default flipped, persisted-value migration added, Settings rollback toggle shipped, legacy fully retained. **NOTE:** verification was a developer smoke test, not the checked-in forensic matrix; that matrix is still owed before 4b. | `… 4` |
| 4b | Delete legacy + guards (after baked release) | **BLOCKED — follows a baked 4a release** (irreversible; NOT the same release as the flip — Codex D1.1/D5.1). Held deliberately even though the owner requested immediate deletion: no bake, no fallback if a gate edge case surfaces in the wild. | `… 4` |
| 5 | Test-estate repair + mutation gate | **DONE for now** (gate 4/4; compositionGuard deletion deferred to Phase 4) | `… 5` |

**Phase Status ticks to the next row only after its DoD gate exits 0 AND `pnpm check:all` is green.**
Per `.claude/rules/60-ai-governance.md` §6, this plan spans >3 phases and deletes load-bearing
code — a cross-model (Codex) review via `/cc-suite:review-plan` is **mandatory before Phase 4**
(the irreversible guard deletion + default flip). Phases 1–3/5 shipped behind a default-off
flag with no change to anyone's behavior, so they did not gate on that review; Phase 4 does.

**Progress note (2026-07-22, overnight autonomous run) — branch `feat/terminal-input-channel-ownership`:**
Built and verified everything that is verifiable without a human typing:
- Phase 0 probes resolved Q1=NO / Q3=NO (jsdom can't model the boundary; xterm is globally
  mocked). A follow-up spike found the sharper truth: **synthetic `dispatchEvent` in real WebKit
  ALSO can't reproduce it** — only Playwright's real keyboard (`userEvent`) gives `[L1,mt,L2]`.
- Stood up the real-WebKit browser tier (`pnpm test:browser`, `*.webkit.test.ts`) and proved
  the gate path's single-writer guarantee there for ASCII + direct non-ASCII input.
- Built the gate path (T1/T2/T3, `resolveCommit`, single writer) behind `terminal.inputGate`,
  default `legacy`. Everything reversible; macOS untouched at the default.

**The one thing left is Phase 4, and it is human-only by nature:** flipping the default and
deleting the legacy guards is irreversible and can only be justified after a human types with
each real IME (macOS Pinyin/Zhuyin/Japanese/Korean, WeChat, Linux fcitx5+rime, Windows MS-IME) —
Playwright cannot drive an OS IME composition cycle. **To test gate mode now:** in DevTools,
`useSettingsStore.getState().updateTerminalSetting("inputGate","gate")`, then open a new
terminal. Revert with `"legacy"`. To capture traces for the record:
`localStorage.setItem("vmark:trace-input","1")`, reload, type, `window.__vmarkInputTrace.download()`.

---

## Outcomes

- **Desired behavior:** One physical keystroke produces exactly one `pty.write`, on every
  platform and IME, without per-IME timing proxies. Adding support for a new IME becomes a
  trace fixture, not a new guard.
- **Constraints:**
  - macOS (WKWebView) is the primary platform and MUST NOT regress at any step.
  - Every step is independently shippable and revertible.
  - No `--no-verify`; all gates stay green (`.claude/rules/60-ai-governance.md` §9).
  - Uses **public xterm API only** — the whole point is to stop depending on `_keyDownSeen`,
    `_inputEvent`, `_handleAnyTextareaChanges`, and listener-registration order.
- **Non-goals:**
  - Rewriting xterm or forking it.
  - Fixing IME *rendering* (candidate-window position, ghost-text) — out of scope.
  - Reconversion/henkan support (clearing the textarea on `compositionend` disables it; the
    status quo already effectively does — documented as a known limitation, not a regression).
  - The Linux/Windows readline-chord theft finding (separate audit row; tracked, not in scope).

## Constraints & Dependencies

- Runtime/toolchain: `@xterm/xterm` ^6.0.0 (public API surface only), React 19, Vitest 4,
  Tauri v2. Rust `src-tauri/src/pty.rs` unchanged except the destroy-guard in WI-1.3.
- OS/platform: macOS WKWebML primary; Linux WebKitGTK, Windows WebView2 best-effort.
- External services: none.
- Feature flag: **`terminal.inputGate: "gate" | "legacy"`** added to `TerminalSettings`
  (`src/stores/settingsTypes/system.ts:30`), default `"legacy"` until Phase 4.
- Required tools for Phase 0/2/4 acceptance: a debug build (`pnpm tauri:dev`) and a **human
  typing with each IME** — not simulatable (see Real-world waits).

## Current Behavior Inventory

- **Entry points:** physical key → WKWebView DOM events on xterm's hidden helper textarea →
  (xterm internals AND VMark listeners) → `pty.write()` → `invoke("pty_write")` → Rust PTY.
- **Two PTY write paths, no provenance:**
  - `terminalSessionInputWiring.ts:88` (`onCompositionCommit` → `e.pty.write(text)`).
  - `terminalSessionInputWiring.ts:157` (`onData` → `e.pty.write(data)`).
- **Registration order (the root cause):** `createTerminalInstance.ts:200` `term.open(container)`
  binds all xterm input listeners on the textarea **before** `:203` `setupImeComposition({ container })`
  binds VMark's. On a shared target, order = registration order, so xterm always writes first.
- **Proxy guards (all empirical fits to one IME):**
  - `IME_COMPOSITION_GRACE_MS = 80` (`setupImeComposition.ts:45`) — post-commit blackout.
  - `IME_DEDUP_WINDOW_MS = 150` (`createTerminalInstance.ts:56`) — Path A/B dedup window.
  - Cross-path echo token (`terminalSessionInputWiring.ts:75`, macrotask-scoped as of `cb954392`).
  - Path A consumed-prefix pointer + Path B integer-multiple (`terminalSessionInputWiring.ts:117-146`).
- **Known invariants relied on:** the helper textarea is found by the internal class
  `.xterm-helper-textarea` (`setupImeComposition.ts:93`); the comment at `:267-268`
  ("Capture phase: run before xterm's own input handler") asserts an ordering guarantee that
  **does not exist** — capture phase does not reorder two listeners on the same node.

## Target Rules

- **R1 — Single DOM writer.** For a given `input` event, exactly one component writes text.
  VMark takes the text channel by calling `stopPropagation()` in a capture-phase `input`
  listener on **`container`** (a strict ancestor of the textarea, DOM-guaranteed by
  `open()`'s `appendChild`), so the event never reaches xterm's textarea listener.
  - Exclusion: `compositionend` listeners on `document` (`imeToast.ts`) must NOT be stopped.
- **R2 — Single writer per keystroke.** ~~All VMark-generated bytes go through the public
  `term.input(text, true)` → `onData` funnel.~~ **SUPERSEDED by WI-3.1 (2026-07-22):** the shipped
  design writes IME commits straight to the PTY and keeps ASCII on xterm's `onData`; they never
  write the same keystroke. The `term.input` funnel was rejected — see WI-3.1 for the precise
  reasons. The invariant that survives is "exactly one writer per physical keystroke."
- **R3 — Minimise timing proxies (softened 2026-07-22, Codex D1.3).** The LEGACY proxies
  (`IME_COMPOSITION_GRACE_MS`, `IME_DEDUP_WINDOW_MS`, Path A/B, the wiring echo token) die in WI-4b.
  Honesty note: gate mode is NOT fully proxy-free — it keeps a same-task macrotask `echoText` guard
  (F1/F2/re-fire dedup) because a purely structural discriminator for post-commit echoes needs real
  IME traces we don't yet have. This is a much smaller, single, same-task proxy, not the legacy
  timing-window maze — but it IS a residual proxy and must be characterised against real traces.
- **R4 — Pure commit resolution.** The five sequential early-returns in `onCompositionEnd`
  (`setupImeComposition.ts:143, 162, 186, 205, 220`) become one **synchronous** pure function
  `resolveCommit(candidates) → string | null` with total case coverage. Keep it synchronous —
  do not defer to a successor task.
- **R5 — Assert absence, not inequality.** Trace tests assert `xtermOriginatedBytes.length === 0`,
  never "not this specific string", so an xterm upgrade that reopens a producer fails loudly.
- **R6 — Public API only, fail loud.** Locate the textarea via the public `term.textarea`
  getter; on miss, throw in dev / `terminalError` + status-bar warning in prod (today it logs
  to a production no-op and silently disables the whole IME layer).
- **R7 — Consume, never abstain.** During composition/grace the key handler MUST
  `stopPropagation()` rather than `return true`, so a keyCode-229 Toggle-Terminal chord cannot
  bubble to the window handler and hide the panel while a commit is pending.

### Edge-case pass (must each have a fixture)
- Empty/none: empty-string `onData` (observed repeating at ~80 ms live) — trace its producer;
  must not reach `pty_write`.
- Invalid: `compositionend` with no preceding `compositionstart` (fcitx5/rime orphan).
- Boundary: multi-syllable commit (你好), rapid back-to-back commits, key-repeat held key.
- Conflicting state: DA1/DA2/DSR/CPR device reply arriving one task after a commit — MUST be
  forwarded (today the 80 ms blackout eats it).
- Multi-surface: two terminal tabs; session switch mid-composition; Toggle-Terminal during grace.
- Persistence/restore: shell exit mid-composition; dispose while a commit is pending.
- I/O failure: PTY killed before dispose-time flush.

## Decision Log

- **D1 — Channel Ownership (Proposal 3), not Single-Writer-ASCII (P1) or State-Machine (P2).**
  - Options: P1 route printable ASCII through a VMark `beforeinput` channel; P2 effects-as-data
    state machine (~+550 lines); P3 xterm keeps keys, VMark takes the text channel.
  - Decision: **P3**, grafting P1's `term.input()` single-funnel and absence-assertion, and
    P2's container-anchor invariant + pure `resolveCommit`.
  - Rationale: P3's levers are one listener move, one `return false`, one existing line made
    safe — each independently revertible, which is the only property that matters when macOS
    regressions are unacceptable. P1 reroutes the most-used path (lowercase ASCII, never once
    implicated in the 18 bugs) onto a new platform dependency for no benefit. P2 defers the
    commit to a successor task, reintroducing "wait for xterm" exactly where R4 deletes it.
  - Rejected: P1 (blast radius), P2 (deferral + line count).
- **D2 — Flag `terminal.inputGate`, default `legacy` until Phase 4.**
  - Rationale: five guards are deleted at once in Phase 4; a one-release flag lets macOS bake
    on real IMEs before `legacy` is removed. Kill switch = flip to `legacy`.
- **D3 — Trace fixtures are recorded from real hardware, never synthesised from reading code.**
  - Rationale: synthesising a fixture reproduces the exact defect this audit found — the fixture
    would encode the author's model of the IME and the suite would agree forever.

## Open Questions

- **Q1 — Does jsdom reproduce the microtask checkpoint between two listeners on one node?**
  - Why it matters: if not, ordering assertions are worthless in jsdom and the fixture tier must
    run in a real engine (`@vitest/browser` + Playwright WebKit).
  - **ANSWERED 2026-07-22 (probe): NO.** jsdom drains microtasks as `[L1, L2, microtask]`; a real
    browser gives `[L1, microtask, L2]`. **jsdom cannot model the listener/microtask boundary at
    all** — the exact mechanism the original bug rode. Consequence: the trace-replay tier and every
    gate-path ordering assertion MUST run in the browser tier. Gate-path unit tests in jsdom would
    reproduce the false-green defect.
- **Q2 — WeChat Shift-punctuation keydown order: does its keydown carry keyCode 229, and does it
  precede or follow `input`?**
  - Why it matters: it decides whether the DEL-hazard (audit table, last row) is live or
    theoretical, i.e. whether Phase 2 must ship T2 before T3 or can relax.
  - Who decides: measured in Phase 0, WI-0.3 (**human — WeChat on real hardware**). Default if
    unresolved: assume live → T2-before-T3.
- **Q3 — Is a real `Terminal` instantiable under jsdom at all, or does it need canvas/measurement
  the browser tier must provide?**
  - Why it matters: sets whether the trace tier can gate `check:all` or needs a separate CI job.
  - **ANSWERED 2026-07-22 (probe): NO — and worse.** `@xterm/xterm` is **globally mocked** in
    `src/test/setup.ts:217`, so no test in the repo ever touches the real class. WI-5.1's
    real-Terminal rewrite and the whole trace-replay tier are **impossible in jsdom** and require
    the browser tier (`@vitest/browser` + Playwright WebKit, ~200 MB, new CI job) — **deferred to
    a human**, not made unilaterally overnight.

### Phase 0 measurement outcome (2026-07-22) — SCOPE-CHANGING

Both probes resolved decisively against jsdom, re-scoping what was implementable overnight:

- **Verifiable in jsdom (built on `feat/terminal-input-channel-ownership`):** Phase 1 in full
  (structural, not timing-dependent), WI-2.1 flag plumbing (pure state), and the WI-0.1
  **recorder** (a dev tool the user runs against the real app to capture real traces).
- **Blocked until the browser test tier exists (human infra decision):** WI-0.1 replay harness,
  all gate-path WIs (2.2/2.3/2.4, 3.1/3.2), WI-5.1's real-Terminal rewrite.
- **Blocked until the human IME matrix exists:** WI-0.3 traces, WI-4.1 flip.

The measurement did its job: it stopped ~two-thirds of the plan from being built with tests that
cannot fail — the precise pathology under repair.

## API / Contract Changes

- `TerminalSettings` (`src/stores/settingsTypes/system.ts:30`) gains
  `inputGate: "gate" | "legacy"`. Additive, defaulted in `defaults.ts:119`, clamped in
  `clamp.ts:33`. No persisted-format break (new optional key; old configs read as `legacy`).
- No MCP tool / schema changes.

## Observability

- Dev-only `terminalInputTrace.ts` ring buffer (WI-0.1): records every input-family event with
  `type`, `eventPhase`, `data`, `inputType`, `isComposing`, `composed`, `key`, `code`,
  `keyCode`, modifier flags; textarea value before/after each listener; every `onData` chunk;
  every `pty.write` with a dispatch id; and the **raw PTY echo byte stream**. Compiled out of
  production via the `debug.ts` no-op pattern.

---

## Work Items

### WI-0.1: Trace recorder + replay harness against a real `Terminal`
- **Goal:** A dev-only recorder and a test harness that replays recorded DOM-event sequences
  into a **real** xterm `Terminal` with a recording fake PTY, asserting exact bytes + write count.
- **Acceptance (measurable):** Harness reproduces the pre-`cb954392` 「。」 doubling when that one
  line (`terminalSessionInputWiring.ts:153` macrotask → the old `queueMicrotask`) is reverted;
  reverting the revert makes it green. If it can't reproduce the doubling, the harness isn't
  modelling the seam and the WI is not done.
- **Tests (first):**
  - `src/components/Terminal/traceReplay.test.ts` — replays the two already-measured sequences
    (「。」 no-composition; 「？」 Shift), asserts `ptyWrites.join("") === expected`.
- **Touched areas:** new `src/components/Terminal/terminalInputTrace.ts`,
  `src/components/Terminal/traceReplay.ts` (+ test); `src/utils/debug.ts` (logger).
- **Dependencies:** none. Resolves Q3.
- **Risks + mitigations:** jsdom may not instantiate a real `Terminal` (Q3) → if so, stand up the
  `@vitest/browser` + Playwright WebKit tier here and scope it out of `check:all`.
- **Rollback:** delete the new files; dev-only, no production surface.
- **Estimate:** L (4–6 h agent + human IME time).

### WI-0.2: Measure the jsdom microtask-checkpoint fidelity (Q1)
- **Goal:** Decide empirically whether jsdom runs a microtask checkpoint between two capture
  listeners on one node.
- **Acceptance:** A throwaway probe test documents PASS/FAIL in the plan's Q1 row; if FAIL, the
  trace tier is pinned to the browser engine and this is recorded in the harness README.
- **Tests (first):** `src/components/Terminal/microtaskCheckpoint.probe.test.ts` (deleted after).
- **Touched areas:** test only.
- **Dependencies:** none.
- **Risks:** none (probe).
- **Rollback:** delete probe.
- **Estimate:** S.

### WI-0.3: Record the load-bearing IME traces (human)
- **Goal:** Capture the 10 traces enumerated in the audit's "unknowable" list, especially WeChat
  Shift-punctuation keydown order (Q2) and macOS Pinyin non-Shift punctuation beyond 「。」.
- **Acceptance:** Committed fixture files under `src/components/Terminal/__fixtures__/traces/`,
  one JSON per (platform, IME, key-class); Q1/Q2 rows in this plan filled with the measured order.
- **Tests (first):** n/a (data capture) — consumed by WI-0.1's harness.
- **Touched areas:** fixtures only.
- **Dependencies:** WI-0.1 recorder.
- **Risks:** requires physical hardware/IMEs → **real-world wait, not agent-time**.
- **Rollback:** n/a.
- **Estimate:** M agent + **days of human clock-time** (see Real-world waits).

### WI-1.1: Public `term.textarea` getter + fail-loud (R6)
- **Goal:** Replace the internal-class textarea lookup with the public getter; throw in dev /
  warn in prod on miss.
- **Acceptance:** `setupImeComposition.ts` no longer references `.xterm-helper-textarea`; a
  deliberate null-textarea test throws in dev mode; existing 591 tests green.
- **Tests (first):** `setupImeComposition.test.ts` — add "throws when term.textarea is absent".
- **Touched areas:** `setupImeComposition.ts:93, 270-272` (accept `term` or the textarea from
  the caller); `createTerminalInstance.ts:203` passes `term.textarea`.
- **Dependencies:** none. Independently shippable.
- **Risks:** signature change to `setupImeComposition` → update the sole caller + tests.
- **Rollback:** revert the two files.
- **Estimate:** S (30 min).

### WI-1.2: Container-anchor invariant + listener lint (from P2)
- **Goal:** Make the (currently false) ordering comment a checked fact.
- **Acceptance:** `createTerminalInstance.ts` asserts `container.contains(term.textarea)` at wiring
  time (throws in dev); a lint/grep rule fails if `addEventListener` is called on `term.textarea`
  inside `src/components/Terminal/`; the false comment at `setupImeComposition.ts:267-268` is
  deleted/corrected.
- **Tests (first):** `createTerminalInstance.test.ts` — "throws if textarea is not inside
  container"; a repo lint check (grep-based, wired into `check:all` or the DoD script).
- **Touched areas:** `createTerminalInstance.ts`, `setupImeComposition.ts` (comment),
  `scripts/check-terminal-input-phase.sh`.
- **Dependencies:** WI-1.1 (needs `term.textarea`).
- **Risks:** none.
- **Rollback:** revert.
- **Estimate:** S.

### WI-1.3: PTY destroy-guard + dispose-before-kill ordering
- **Goal:** Make the #793 dispose-time flush actually reach a live PTY, and make post-kill
  `write()` a safe no-op.
- **Acceptance:** `VMarkPty.write()` (`pty.ts:206`) early-returns when `_destroyed`, matching
  `kill`/`resize`/`close`; `terminalSessionRegistry.ts:26-34` and `:100-107` call `dispose()`
  **before** killing the PTY.
- **Tests (first):** `pty.test.ts` — "write after destroy is a no-op with a warning";
  `terminalSessionRegistry.test.ts` — "dispose-time flush reaches a live PTY".
- **Touched areas:** `pty.ts:206-212`, `terminalSessionRegistry.ts:26-34, 100-107`.
- **Dependencies:** none. Independently shippable.
- **Risks:** dispose/kill reordering could change teardown timing → covered by the two tests.
- **Rollback:** revert.
- **Estimate:** M (45 min).

### WI-1.4: Toggle-Terminal — consume, never abstain (R7)
- **Goal:** During composition/grace the key handler `stopPropagation()`s instead of returning
  `true`, so a keyCode-229 Toggle-Terminal chord can't bubble to the window handler.
- **Acceptance:** Fixture — Ctrl+` during grace toggles the panel exactly once and flushes no
  text into a hidden shell.
- **Tests (first):** `terminalKeyHandler.test.ts` — "Ctrl+backtick during IME grace does not
  bubble to the window handler"; `useViewShortcuts.test.ts` — cross-check the guard order.
- **Touched areas:** `terminalKeyHandler.ts:112-121`.
- **Dependencies:** none. Independently shippable.
- **Risks:** must not swallow the toggle entirely (still needs to toggle once) → assert exactly-once.
- **Rollback:** revert.
- **Estimate:** M (1 h).

### WI-2.1: `inputGate` flag plumbing
- **Goal:** Add `terminal.inputGate: "gate" | "legacy"` (default `legacy`) end-to-end.
- **Acceptance:** Present in `TerminalSettings`, `defaults.ts`, `clamp.ts`; `createTerminalInstance`
  branches on it; `legacy` path is byte-identical to today (trace fixtures prove it).
- **Tests (first):** `settingsStore.test.ts` — default + clamp; `createTerminalInstance.test.ts`
  — "legacy path unchanged".
- **Touched areas:** `settingsTypes/system.ts:30`, `defaults.ts:119`, `clamp.ts:33`,
  `createTerminalInstance.ts`.
- **Dependencies:** none.
- **Risks:** none (default-off).
- **Estimate:** S.

### WI-2.2: T1 — container-level `input` `stopPropagation` (gate path)
- **Goal:** In gate mode, a capture-phase `input` listener on `container` calls
  `stopPropagation()` so xterm's textarea `_inputEvent` never fires.
- **Acceptance:** Trace fixtures for 。 ， ？ ！ ～ （ each assert **exactly one** `pty.write`;
  plain and Shift variants of the same char produce **identical** bytes; `xtermOriginatedBytes
  .length === 0` (R5). macOS Pinyin no-composition 「。」 and Shift 「？」 both pass.
- **Tests (first):** `traceReplay.test.ts` — the six punctuation fixtures + the two ground-truth
  sequences, gate mode.
- **Touched areas:** `setupImeComposition.ts` (listen on `container`, stopPropagation),
  `createTerminalInstance.ts` (gate branch).
- **Dependencies:** WI-0.1, WI-1.1, WI-1.2, WI-2.1.
- **Risks:** `document`-level `compositionend` listeners must survive (R1 exclusion) → assert
  `imeToast` still fires.
- **Rollback:** flip flag to `legacy`.
- **Estimate:** L (2–3 h).

### WI-2.3: T2 — IME keydown returns `false` (gate path)
- **Goal:** In gate mode, `terminalKeyHandler` returns `false` for IME (keyCode-229) keydowns so
  xterm's `_handleAnyTextareaChanges` (the DEL hazard) never runs.
- **Acceptance:** Fixture — type `ABC`, then a fullwidth period, then Enter → **zero `\x7f`**
  ever written. Known deltas (`scrollOnUserInput` scroll-to-bottom, `_showCursor`) restored
  explicitly if a fixture notices them.
- **Tests (first):** `traceReplay.test.ts` — "no spurious DEL after mixed ASCII + IME".
- **Touched areas:** `terminalKeyHandler.ts:125` (gate branch).
- **Dependencies:** WI-2.2. **Must land before WI-2.4** (Q2 / audit last-row ordering).
- **Risks:** skipping xterm side effects → the known-delta list above; assert scroll/cursor.
- **Rollback:** flip flag.
- **Estimate:** M (1 h).

### WI-2.4: T3 — synchronous textarea clear on `compositionend` (gate path)
- **Goal:** In gate mode, clear `textarea.value` synchronously in `compositionend` so xterm's
  `setTimeout(0)` finalizer reads `""`.
- **Acceptance:** Multi-syllable Pinyin, WeChat, fcitx5+rime fixtures each assert one write;
  **plus a new fixture that fails today**: a DA1 reply `\x1b[?6c` arriving one task after a
  commit is **forwarded** (proves the 80 ms blackout is gone).
- **Tests (first):** `traceReplay.test.ts` — the three IME fixtures + the DA1-reply forwarding case.
- **Touched areas:** `setupImeComposition.ts` (gate branch of `onCompositionEnd`).
- **Dependencies:** WI-2.3 (T3 only safe after T2 — the audit's last-row defect).
- **Risks:** disables reconversion/henkan (non-goal; document). Requires WeChat trace (Q2).
- **Rollback:** flip flag.
- **Estimate:** L (part of the 3–4 h T3 block).

### WI-3.1: Single writer per keystroke (gate path)
- **REVISED from the original plan — supersedes R2/D1's `term.input` prescription (2026-07-22).**
  The original design routed all VMark bytes through `term.input(text, true)` → `onData`. The
  shipped design instead writes IME commits **straight to the PTY** via `onCompositionCommit`,
  while ASCII stays on xterm's `onData` (keydown path). They never write the same keystroke → one
  writer per key. `term.input` is NOT used.
- **Why direct-to-PTY, stated precisely (correcting an earlier imprecise note flagged by Codex):**
  the reason is NOT the `onData` composing-guard — gate mode sets `composing = false` in
  `onCompositionEnd` BEFORE committing, so that guard would not block a `term.input` commit.
  The real reasons: (a) `term.input` → `triggerDataEvent` → `onData` re-enters
  `terminalSessionInputWiring`'s **legacy dedup machinery** (Path A/B, the `lastCommittedText`
  windows, the echo token), which is dead weight in gate mode and a coupling to code Phase 4
  deletes; (b) a direct write is simpler and has no such re-entry.
- **Known deviation to verify with the human matrix:** `term.input` also fires xterm's documented
  `triggerDataEvent` side effects (scroll-to-bottom, show-cursor); a direct PTY write does not — the
  PTY's echo render is expected to cover it, but this is UNVERIFIED for IME commits and belongs in
  WI-0.3's human pass. If it regresses, call `term.scrollToBottom()` on commit.
- **Goal (as shipped):** In gate mode, exactly one writer produces the bytes for any keystroke.
- **Acceptance (as shipped):** The gate module has no legacy dedup machinery; webkit tests assert
  ASCII + direct non-ASCII each reach the PTY exactly once; jsdom tests assert the F1/F2 echo/orphan
  guards. Real IME composition cycles remain pending human verification (WI-0.3).
- **Tests:** `setupImeCompositionGate.webkit.test.ts` (real WebKit, single-writer),
  `setupImeCompositionGate.test.ts` (jsdom, commit decisions).
- **Touched areas:** `setupImeCompositionGate.ts` (commit → PTY directly).
- **Dependencies:** WI-2.2, WI-2.3, WI-2.4.
- **Risks:** our own byte re-entering the guard maze if this lands before T1–T3 → ordering enforced.
- **Rollback:** flip flag.
- **Estimate:** M (1–2 h).

### WI-3.2: Pure `resolveCommit(candidates)` (R4)
- **Goal:** Replace the five sequential early-returns in `onCompositionEnd` with one synchronous
  pure resolver with total case coverage.
- **Acceptance:** `resolveCommit` is a pure function (no DOM, no timers) with a table-driven test
  covering every measured commit shape; `onCompositionEnd` calls it once.
- **Tests (first):** `resolveCommit.test.ts` — table-driven over the fixtures from WI-0.3.
- **Touched areas:** new `src/components/Terminal/resolveCommit.ts`; `setupImeComposition.ts:143-232`.
- **Dependencies:** WI-3.1 (so the resolver's output has one consumer).
- **Risks:** must remain synchronous (reject P2's deferral).
- **Rollback:** revert.
- **Estimate:** M.

### Phase 4 — SPLIT into 4a (flip) and 4b (delete) — Codex review 2026-07-22, verdict MAJOR GAPS

**Why split (Codex D1.1/D5.1, Critical):** the original single WI-4.1 both *deleted the legacy
guards* and *retained `legacy` as a one-release rollback*. Those guards ARE the legacy behavior —
you cannot delete them and still have a working fallback. The one-release "kill switch" was
therefore illusory. Flip and delete MUST be different releases.

### WI-4a: Flip the default to `gate` — legacy kept fully intact
- **Goal:** Make `gate` the default while the COMPLETE, tested legacy implementation (all guards,
  `compositionGuard`-covered scenarios via production-bound tests) remains as a real, operable
  rollback.
- **Preconditions (ALL required, human-produced — Codex "minimum evidence"):**
  1. A checked-in, versioned IME matrix: macOS Pinyin/Zhuyin/Japanese/Korean, WeChat, Linux
     fcitx5+rime, Windows MS-IME — each with OS, IME version/layout, device, tester, date, app build.
  2. Ordered traces from the real debug app per case, capturing DOM events **plus** instrumented
     `term.onData`, the gate commit, the PTY write, and the raw PTY echo (see WI-0.1 addendum —
     the recorder must be extended to the output boundary; today it captures DOM only).
  3. Per case: exact PTY bytes + write count; **zero** xterm-originated IME bytes; textarea state;
     no spurious DEL; cursor/scroll behavior; device-query (DA1/CPR) reply forwarding.
  4. Coverage of: normal + multi-syllable commits, converted punctuation, direct insertion, Shift
     punctuation, candidate cancel/replace, **ASCII-result composition** (the D3.1 path), orphan/
     re-fired/accumulated `compositionend`, rapid repeated identical commits, paste/drop, session
     switch/dispose, shell exit, toggle-terminal during grace.
- **Migration (Codex D4.1, Critical):** `inputGate` is persisted and deep-merged over defaults, so
  existing users keep their stored `"legacy"` and would NOT get gate on flip. Since there is no UI
  toggle, a stored `"legacy"` is NOT an intentional opt-out — add a one-shot migration that clears
  a stored `inputGate` when it equals the OLD default so flipped users actually move to gate.
- **Rollout (Codex D5.2):** default-off + DevTools-only is not a real bake. Before flip, add a
  discoverable opt-in (Settings row) so gate gets representative usage; keep legacy as the operable
  rollback.
- **DoD:** grep is NOT sufficient (Codex D4.4). Require the checked-in matrix + trace artifacts +
  green production-bound tests + explicit human sign-off recorded in the plan.
- **Rollback:** set `inputGate: "legacy"` — legacy is FULLY present this phase.
- **Estimate:** gated by real-world bake time; human matrix is days of clock-time, not agent-time.

### WI-4b: Delete the legacy path + proxy guards — only AFTER a baked default-on release
- **Goal:** Once a full release has shipped default-on with clean evidence, remove the dead legacy
  code and its now-unused guards.
- **Acceptance:** Delete `setupImeComposition.ts` legacy dedup (`IME_COMPOSITION_GRACE_MS`, the
  grace machinery), `terminalSessionInputWiring.ts` `IME_DEDUP_WINDOW_MS` / Path A/B / echo token /
  `lastCommittedText`/`lastCommitTime`, and split the shared `ImeCompositionHandle` into gate-only
  vs legacy contracts BEFORE deleting fields (Codex D1.3/D4.2 — the GATE still uses its own
  `echoText`/`lastCommitted*`; the deletion list must not touch those). Delete `compositionGuard.test.ts`
  only after each legitimate scenario it covers has a production-bound replacement (Codex D2.4).
- **Dependencies:** a shipped, baked WI-4a release with clean evidence.
- **Rollback:** revert the deletion commit (legacy is in git history, but no longer a live fallback —
  which is why 4b waits for the bake).
- **Estimate:** M, mechanical — but strictly gated on 4a's release evidence.

**Residual gate-mode correctness still to prove before WI-4a (Codex D3.x, not yet closed):**
whether any supported IME still lets xterm originate a write during composition (composition-phase
`insertText` passes through today), and whether the gate `echoText` — a same-task macrotask proxy,
NOT proxy-free — mishandles a cross-task echo or a genuine same-task repeat. Both need real traces.

### WI-5.1: Repair the test estate (the reason the bug class shipped green)
- **Goal:** Replace tests that model the author's belief with tests that observe the contract.
- **Acceptance:**
  - `terminalSessionInputWiring.test.ts` fake instance replaced with a real `Terminal`
    (WI-0.1 harness), so `instance.composing` can actually be true.
  - `compositionGuard.test.ts` (726-line drifted reimplementation) **deleted**.
  - The two false-model tests (`setupImeComposition.test.ts:208-217, 219-228`) rewritten to use
    a real task boundary, not `await Promise.resolve()`.
  - The keyCode-229 chord test's impossible shape (Cmd+V as 229) corrected.
- **Tests (first):** the rewritten suites themselves.
- **Touched areas:** `terminalSessionInputWiring.test.ts`, `compositionGuard.test.ts` (delete),
  `setupImeComposition.test.ts`, `terminalKeyHandler.test.ts`.
- **Dependencies:** WI-0.1.
- **Risks:** line coverage **will drop** when `compositionGuard.test.ts` is deleted — argue it in
  the PR; mutation score becomes the replacement gate.
- **Rollback:** n/a (test-only).
- **Estimate:** M (1–2 h).

### WI-5.2: Mutation-test gate for the new pure modules
- **Goal:** Make `resolveCommit` and the keymap rows mutation-tested, since line coverage
  demonstrably measures nothing here (deleting a guard kept 591/591 green).
- **Acceptance:** `src/components/Terminal/**` added to `stryker.config.json`'s `mutate` array;
  `pnpm mutation:ts` reports a kill-rate threshold for the new modules; CI wires it.
- **Tests (first):** mutation run itself is the gate.
- **Touched areas:** `stryker.config.json`, CI wiring.
- **Dependencies:** WI-3.2.
- **Risks:** mutation runtime cost → scope to the two new files only.
- **Rollback:** revert config.
- **Estimate:** M (1–2 h).

---

## Gap → WI map

| Gap (from audit) | WI |
|---|---|
| Root cause: registration order / two writers on one node | WI-2.2, WI-3.1 |
| 80 ms blanket eats device-query replies | WI-2.4 (DA1 fixture) |
| Guard has zero coverage (fake instance) | WI-5.1 |
| `compositionGuard.test.ts` drifted / anti-coverage | WI-5.1 |
| Constants unpinned downward | WI-5.2 (mutation) |
| Toggle-Terminal abstains during grace | WI-1.4 |
| PTY killed before dispose-flush | WI-1.3 |
| Textarea located by internal class | WI-1.1 |
| DEL hazard (unproven trigger) | WI-2.3 + Q2 measurement |
| Empty-string `onData` reaches `pty_write` | WI-0.3 (trace) → WI-2.x |
| Linux/Windows readline-chord theft | OUT OF SCOPE (separate audit row) |

## Testing Procedures

- **Fast checks (per WI):** `npx vitest run src/components/Terminal/` and, once it exists,
  the `traceReplay` suite (browser tier if Q1/Q3 force it).
- **Full gate (per phase):** `pnpm check:all` + `bash scripts/check-terminal-input-phase.sh <N>`.
- **Mutation (Phase 5):** `pnpm mutation:ts` scoped to `src/components/Terminal/**`.
- **When to run:** fast checks after every WI; full gate before ticking Phase Status; the human
  IME matrix (WI-0.3) before WI-2.4 and WI-4.1.

## Plan → Verify Handoff

- **Evidence per WI:** the named test file(s) green; for gate-path WIs, the trace-replay byte
  assertions; for WI-4.1, a signed-off human IME matrix (which IME, which OS, who typed, date).
- **Fixtures required:** `src/components/Terminal/__fixtures__/traces/*.json` from WI-0.3.

## Real-world waits (NOT compressible, NOT agent-time)

WI-0.3 and WI-4.1 acceptance require a **human physically typing with each IME into a debug
build** — macOS Pinyin/Zhuyin/Japanese/Korean, WeChat, Linux fcitx5+rime, Windows MS-IME. This
is days of clock-time, not parallelisable, not simulatable. **Synthesising fixtures from reading
code would reproduce the exact defect this audit found.** Agent-time for the code is ~12–18 h;
the schedule is dominated by the human matrix, not the code.

## Rollout Plan

- **Feature flag:** `terminal.inputGate`, default `legacy` through Phase 3, `gate` from Phase 4.
- **Staging:** Phase 1 ships plain (no flag, pure fixes). Phases 2–3 ship with `gate` opt-in for
  dogfooding. Phase 4 flips the default after the human matrix signs off.
- **Kill switch:** flip `inputGate` to `legacy`. The legacy branch is retained for one full
  release after the default flip; a follow-up WI (not in this plan) removes it.

## Manual Test Checklist

- [ ] macOS Pinyin: `。 ， ？ ！ ～ （` each produce one character; cursor lands after it.
- [ ] macOS Pinyin multi-syllable (你好世界) commits once, no injected spaces.
- [ ] WeChat Shift full-width punctuation: one character each.
- [ ] Linux fcitx5+rime: orphan `compositionend` commits once.
- [ ] A CLI that queries the terminal (DA1/CPR) right after a CJK commit does not hang.
- [ ] Ctrl+` during IME grace toggles the panel once, no stray text in the shell.
- [ ] Shell exit mid-composition shows the exit message (no phantom respawn).
- [ ] `inputGate: "legacy"` reproduces today's behavior byte-for-byte.
