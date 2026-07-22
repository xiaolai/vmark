# Terminal keyboard/IME input — root-cause architecture audit

**Date:** 2026-07-21
**Trigger:** ~18 duplication fixes in 6 months on `src/components/Terminal/` — the owner asked
for a root-cause audit rather than another patch.
**Method:** 58-agent workflow — 2 mappers (code-path map, assumption archaeology) → 6 audit
lenses (root cause, dedup matrix, test validity, xterm coupling, platform×IME matrix, timing/races)
→ per-finding adversarial refutation → 3 independent redesign proposals → adjudicated synthesis.
**Scale:** 7.25M subagent tokens, 1356 tool calls, 72 min wall clock, 0 agent errors.
**Raw findings:** 59. **Adversarially verified:** 46 (12 survived, 34 refuted). **Not verified: 13** (see caveat).
**Run ID:** `wf_7d4c7b3d-b6a` — per-agent returns in that run's `journal.jsonl`.

> Several findings below were confirmed **by execution** (the agent deleted a guard or shrank a
> constant and ran the suite). All such mutations were reverted; the working tree was verified
> clean afterwards.

---

# Terminal IME Input — Final Review

## Root cause

**VMark and xterm.js are two independent IME implementations reading the same DOM node, and VMark registered second on that node — so it can only ever arbitrate *after* xterm has already written.** `setupImeComposition.ts:265-269` attaches `compositionstart`/`compositionend`/`input` to the very textarea xterm binds all seven of its input listeners to (bundle `_bindKeys(){…L(this.textarea,'keydown',…,!0)…L(this.textarea,'input',e=>this._inputEvent(e),!0)}`), and `createTerminalInstance.ts:200` calls `term.open(container)` *before* `:203` calls `setupImeComposition` — on a shared target, listener order is registration order, so xterm always runs first. Compounding it, there are **two write paths to the PTY** (`terminalSessionInputWiring.ts:95` for commits, `:168` for `onData`) that carry byte-identical payloads with no provenance, so "which of these two 。 is the duplicate?" is only answerable by *proxies* — elapsed time (`setupImeComposition.ts:45` = 80 ms; `createTerminalInstance.ts:56` = 150 ms), string equality (`terminalSessionInputWiring.ts:118-146`), and scheduler position (`:162-167`). Every proxy is an empirical fit to one measured IME, so the next IME refutes it and the fix is another proxy. The comment at `setupImeComposition.ts:267-268` — "Capture phase: run before xterm's own input handler" — is factually wrong and is the clearest symptom that the team believes it has an ordering guarantee it does not have.

*Adjudication:* all three lenses converged on this. Where they diverged (how much of xterm to displace) I rule below.

## Why every previous fix was locally correct and globally useless

Each fix correctly measured one IME's timing and encoded it as a *duration* or a *string comparison*, i.e. as a new proxy — never as the ordering fact itself.

| Fix | What it encoded | Why it could not hold |
|---|---|---|
| `f8254469` (#619) "block ALL onData during grace" → `terminalSessionInputWiring.ts:115` | "xterm's echo lands within 80 ms" | The hazard it fences is `setTimeout(…, 0)` — verified in `_finalizeComposition` and `_handleAnyTextareaChanges`, both delay **0**. The relationship is *one macrotask*; the code says *80 milliseconds*. The other 79 ms is a blackout over 14 other `onData` producers. |
| `43413319` (#525) WeChat late-onData dedup | "the echo arrives **after** the commit" | Ground truth #1 measured the echo arriving **first**, in the same dispatch. The anchor at `:118-133` only matches the reverse order. |
| `07bb17b5` (#768) suffix-chunk dedup | "xterm re-emits committed text in segments" | Correct for that IME; the consumed-prefix pointer (`:129-133`) is a *string* proxy — it cannot tell a re-emission from the user typing the same character twice. |
| `068143c2` (#948) fcitx5 integer-multiple dedup | "duplicates are `committed.repeat(n)`" | Same class. It also silently changed the orphan-`compositionend` semantics at `setupImeComposition.ts:143-157`, which is why `compositionGuard.test.ts` now asserts behaviour production abandoned. |
| `cb954392` (today) microtask → macrotask token | "clear the token one task later" | Correct, but it is a *fourth* proxy for "same keystroke". It fixed 「。」 and left the 79 ms dead zone, the 150 ms window, and the string comparisons all in place, mutually masking. |
| `99fff289` (#793) flush pending commit on dispose | "a commit can be pending at teardown" | True — and unreachable, because `terminalSessionRegistry.ts:26-34` kills the PTY *before* `dispose()`, and `pty.ts:206` has no post-kill guard. The fix is locally right and globally dead. |
| `02f89f35` (#910) trust the textarea diff | "e.data lies about punctuation" | This one is **not** a proxy — it is a genuine data fact. It is the residue that survives any redesign. |

## Verified defects still live in the working tree

| Sev | file:line | Defect | How it surfaces | Status |
|---|---|---|---|---|
| **Critical** | `terminalSessionInputWiring.ts:115` | The #619 blanket drops **every** `onData` chunk for the full 80 ms window — genuine keystrokes, `term.paste()` (routed there by `terminalKeyHandler.ts:240-243`), mouse reports, and the parser's replies to DA1/DA2/DSR/CPR/focus queries. Nothing buffers or retries them. | A CLI app that queries the terminal right after a CJK commit hangs waiting for a reply that was swallowed. Fast typing after a commit silently loses characters. | **Confirmed**: guard is unconditional; both xterm hazards are `setTimeout(…,0)`. Device-reply list not individually re-verified by me. |
| **Critical** | `terminalSessionInputWiring.test.ts:17-38` | The fake `TerminalInstance` uses static fields where production uses live getters (`createTerminalInstance.ts:265-272`), so `instance.composing` can never be true in any test. | I deleted `terminalSessionInputWiring.ts:115` and ran the terminal suite: **31 files / 591 tests passed**. The single most consequential guard in the subsystem has zero coverage. | **Confirmed by execution** |
| **Critical** | `compositionGuard.test.ts:26-127, 494-514` | 726 lines testing a hand-written reimplementation, importing only two constants (`:17`). It has drifted: `:63` `if (!composing && !inGracePeriod) return;` encodes the #659 model; production `setupImeComposition.ts:143-157` replaced it in `068143c2`. `:444-458` and `:460-474` assert one commit where production commits two and three. | Green forever. It is anti-coverage on exactly the branch the next Linux/Windows IME will land in. | **Confirmed by code trace** (I did not execute production against those sequences) |
| **High** | `setupImeComposition.ts:45` + `createTerminalInstance.ts:56` | Window durations are pinned only upward. | I changed `IME_COMPOSITION_GRACE_MS` from 80 to **5** and ran the suite: **591/591 green**. Tuning the number is the cheapest response to the next bug report and the suite offers no resistance. | **Confirmed by execution** |
| **High** | `terminalKeyHandler.ts:112-126` + `useViewShortcuts.ts:57-58,126-128,239` | During the grace window the terminal handler **abstains** (returns `true`, no `preventDefault`, no `stopPropagation`). For a keyCode-229 Ctrl+\`, xterm's `_keyDown` returns `!1` via `_compositionHelper.keydown` **without** calling `cancel(e,!0)`, so the event bubbles to the window listener. `resolveViewAction` checks toggleTerminal *before* its textarea suppression (`useViewShortcuts.ts:126-128`, comment: "Terminal toggle fires even from textarea"). | Panel hides while `pendingCommitText` is armed; 80 ms later the flush writes into a now-hidden shell — verbatim the outcome the comment at `terminalKeyHandler.ts:110-111` claims to prevent. | **Confirmed by code trace across both layers + bundle** |
| **High** | `terminalSessionRegistry.ts:26-34`, `:100-107` + `pty.ts:206-212` | Teardown kills the PTY (`:28`) before `dispose()` (`:33`), and `write()` is the only `VMarkPty` method with no `_destroyed` guard (compare `:168`, `:196`, `:226`). | The #793 dispose-time flush always writes to a dead session; failure is swallowed by `ptyWarn` at `pty.ts:210`. | **Confirmed** |
| **Medium** | `setupImeComposition.ts:93`, `:270-272` | Helper textarea located by internal CSS class `.xterm-helper-textarea` (a styling hook, not public API) when the public getter `get textarea(){return this._core.textarea}` exists. On miss, the else-branch logs via `terminalLog`, which is `() => {}` in production (`src/utils/debug/log.ts:32-34`). | An xterm class rename silently disables the entire IME layer with no signal; the bug report will describe the original 2026-02 symptom. | **Confirmed** |
| **Medium** | `setupImeComposition.ts:251` | The textarea clear is shared mutable state. xterm's `_handleAnyTextareaChanges` snapshots `textarea.value` at a keyCode-229 keydown and, one macrotask later, emits `\x7f` if the buffer shrank. Uppercase A–Z genuinely accumulate: `_keyDown` returns `!0` for `charCodeAt(0)>=65&&<=90` **without** `cancel`, and `_keyPress`'s `cancel(e)` is a no-op (`cancelEvents:!1` default, never overridden in `createTerminalInstance.ts:163-190`). The emitted DEL passes every VMark guard and is written at `terminalSessionInputWiring.ts:168`. | A character deleted that nobody in `src/` ever wrote. | **Mechanism confirmed link-by-link; trigger unproven.** It requires keydown(229) to precede our clear with a non-empty buffer. Ground truth #1 measured the *opposite* order for 「。」, where the DEL does not fire. **This needs a WeChat/Shift-punctuation trace before anyone acts on it.** |

Not carried forward: nothing in the audit was refuted outright, but I am explicitly downgrading the DEL hazard from "live data loss" to "unproven trigger" and folding the "five writers to `textarea.value`" finding into the row above, since I verified only VMark's write and xterm's two `this.textarea.value=\`\`` clears in the bundle.

## The recommended design

**Primary: Proposal 3 — Channel Ownership.** xterm keeps the keyboard channel; VMark takes *exclusive* ownership of the text channel via three levers I verified in the shipped bundle:

- **T1** — kill `_inputEvent`: a capture-phase `input` listener on `container` (a strict ancestor — `open(e)` does `appendChild(this.element)`, and the textarea lives inside) calls `stopPropagation()`, so the event never reaches the textarea. xterm's only `input` listener is on the textarea, and I grepped `src/`: no other ancestor-level `input` listener exists (`imeToast.ts:126,158` listens on `document` for `compositionend` only, which we must not stop).
- **T2** — kill `_handleAnyTextareaChanges` and its DEL: `terminalKeyHandler.ts:125` returns `false` instead of `true`. `_keyDown` consults `_customKeyEventHandler` **before** `_compositionHelper.keydown(e)`, and `keydown` is the *only* caller of `_handleAnyTextareaChanges` (`return e.keyCode===229?(this._handleAnyTextareaChanges(),!1):!0`). This is documented public API.
- **T3** — neuter `_finalizeComposition(true)`: clear `textarea.value` synchronously during `compositionend`; its `setTimeout(0)` then reads `""`, and its guard is `t.length>0&&triggerDataEvent(t,!0)`. **T3 is only safe after T2 lands** — that ordering is precisely the defect in the last row of the table above.

**Why 3 over 1 and 2, against "macOS must not regress":** Proposal 1 assigns printable ASCII to a VMark-owned `beforeinput` channel. Lowercase ASCII today goes `_keyDown` → `triggerDataEvent` → `cancel(e,!0)` and has never appeared in any of the 18 bugs; rerouting the most-used path in the app onto a new platform dependency buys nothing against this bug class and puts everything in the blast radius. Proposal 2's effects-as-data state machine is the most elegant but adds ~550 lines and defers the commit to a bubble-successor task — reintroducing "wait for xterm" as a concept at the exact moment T3 deletes it. Proposal 3's levers are one line, one listener move, and one existing line made safe; each is independently revertible, which is the only property that matters when macOS regressions are unacceptable.

**Grafted in:**

- **From Proposal 1 — route every VMark-generated byte through the public `term.input(text, true)`** (verified: `input(e,t=!0){this.coreService.triggerDataEvent(e,t)}`) instead of `pty.write` directly. This collapses the *two* write paths into one, deletes `onCompositionCommit` as a PTY writer (`terminalSessionInputWiring.ts:86-108`), and makes `term.onData` the single funnel. It must land **after** T1–T3, or our own byte re-enters the guard maze. This is the highest-value graft: it removes the second writer at the *PTY* boundary as well as the *DOM* boundary.
- **From Proposal 1 — assert absence, not inequality.** Trace tests assert `xtermOriginatedBytes.length === 0`, never "not this string". That converts an unversioned coupling from silent to loud on an xterm bump.
- **From Proposal 2 — the container anchor as an executable invariant:** assert `container.contains(term.textarea)` at wiring time (throw in dev), plus a lint rule banning `addEventListener` on `term.textarea` inside `src/components/Terminal/`. This replaces the false comment at `setupImeComposition.ts:267-268` with a checked fact.
- **From Proposal 2 — a pure `resolveCommit(candidates)`** replacing the five sequential early-returns at `setupImeComposition.ts:143`, `:162`, `:186`, `:205`, `:220`. Each of those commits on partial evidence at a different point in the sequence, which is *why* a new IME always needs a new branch. Keep it **synchronous** — take Proposal 2's decision point, reject its deferral.
- **From both — recorded trace fixtures replayed against a real `Terminal`.**

## Migration plan

Each step is independently shippable and revertible. "Judgment" = irreducible design reasoning; "mechanical" = codemod-shaped.

| # | Step | Type | Acceptance check | Agent time |
|---|---|---|---|---|
| 0 | Trace recorder (`terminalInputTrace.ts`, dev-only ring buffer) + replay harness against a **real** `Terminal`. Record the two already-measured cases first. | Judgment (schema), then mechanical | Harness reproduces the pre-`cb954392` 「。」 doubling when that one line is reverted. If it can't, the harness isn't modelling the seam. | 4–6 h + **human IME time (see below)** |
| 1 | `setupImeComposition.ts:93` → public `term.textarea`; fail loud on miss (throw in dev, `terminalError` + status-bar warning in prod). Add the `container.contains` assertion. | Mechanical | Existing 591 tests green; a deliberate null-textarea test throws. | 30 min |
| 2 | `pty.ts:206` `_destroyed` guard; `terminalSessionRegistry.ts:26-34` and `:100-107` dispose **before** kill. | Mechanical | New test: dispose-time flush reaches a live PTY; post-kill `write` is a no-op with a warning. | 45 min |
| 3 | **T2** — `terminalKeyHandler.ts:125` `return true` → `return false`. | Judgment (known delta: `scrollOnUserInput` scroll-to-bottom and `_showCursor` are skipped for IME keys; restore explicitly if noticed) | Fixture: type `ABC`, then a fullwidth period, then Enter → **zero `\x7f`** ever written. | 1 h |
| 4 | **T1** — move listeners to `container` capture; `stopPropagation()` on `input`; delete the cross-path echo token (`terminalSessionInputWiring.ts:82`, `:91-94`, `:162-167`). | Judgment | Fixtures for 。 ， ？ ！ ～ （ each assert **exactly one** `pty.write`; plain and Shift variants of the same char produce **identical** bytes. | 2–3 h |
| 5 | **T3 + `resolveCommit`** — clear the textarea on `compositionend`, extract the five branches into a pure resolver. Delete `IME_COMPOSITION_GRACE_MS`, `IME_DEDUP_WINDOW_MS`, `terminalSessionInputWiring.ts:115`, Paths A/B (`:117-146`), `lastCommittedText`/`lastCommitTime`. **Ship behind `terminal.inputGate: "gate" \| "legacy"` for exactly one release.** | **Highest judgment** — five guards deleted at once | Multi-syllable Pinyin, WeChat, fcitx5+rime fixtures each assert one write; **plus a new fixture that fails today**: a DA1 reply `\x1b[?6c` arriving one task after a commit must be **forwarded**. | 3–4 h |
| 6 | Single write path — VMark text via `term.input()`; delete `onCompositionCommit` as a PTY writer. `terminalSessionInputWiring.ts` → ~40 lines. | Mechanical, once 3–5 are green | Byte-identical fixture replay; `terminalSessionInputWiring.ts` contains zero conditionals. | 1–2 h |
| 7 | Test estate: delete `compositionGuard.test.ts`; fix the two false-model tests at `setupImeComposition.test.ts:208-217` and `:219-228`; add `src/components/Terminal/**` to `stryker.config.json`'s `mutate` array (Stryker 9.6.1 and `pnpm mutation:ts` already exist — the scope list just never included this code). | Mechanical | Coverage **will drop**; argue it in the PR. Mutation score becomes the replacement gate. | 1–2 h |
| 8 | Toggle-Terminal: **consume, never abstain** — `terminalKeyHandler.ts:112-121` calls `stopPropagation()` during composition instead of returning `true`. | Judgment | Fixture: Ctrl+\` during grace toggles **once**, and no text is flushed into a hidden shell. | 1 h |

**Real-world waits (not compressible):** Step 0 and Step 5's gates require a human with each IME physically typing into a debug build. That is days of clock-time across macOS Pinyin/Zhuyin/Japanese/Korean/WeChat, Linux fcitx5+rime, and Windows MS-IME — not agent-time, not parallelisable, not simulatable. **Synthesising fixtures from reading code would reproduce the exact defect this audit found**: the fixture would encode the author's model of the IME and the suite would agree with it forever.

## Testing strategy that would actually catch this class

**Boundary: a real `Terminal` instance, real DOM events dispatched on its real helper textarea, a recording fake PTY.** Assert the exact byte string and the exact write count. Three assertions per fixture:

1. `ptyWrites.join("") === expected` — **"one physical keystroke → exactly one `pty.write`"**. This contract has never once been asserted in the repo: `setupImeComposition.test.ts` asserts only `onCommit` counts and two bookkeeping fields and never touches a PTY; `terminalSessionInputWiring.test.ts` asserts on `writeMock` but its stimulus is a hand-called function (`entry.instance.onCompositionCommit!("！")`), so "one keystroke" is not expressible in it.
2. `term.textarea.value === ""` at every dispatch boundary — the shared-state invariant.
3. `xtermOriginatedBytes.length === 0` — the *structural* assertion. Fails loudly on any xterm upgrade that reopens a producer.

**Why this catches the microtask/macrotask defect.** The test calls `dispatchEvent` **once**. The event dispatcher — not the test author — decides that xterm's listener and VMark's listener both run inside that single dispatch. "The next listener in this dispatch" and "a later independent keystroke" stop being the same expression: the first is *inside one `dispatchEvent`*, the second is *a second `dispatchEvent` in the fixture*. `await Promise.resolve()` never appears, so it cannot stand in for both. The two tests that shipped the bug are unrepresentable in this harness.

**Why this catches the no-composition fullwidth period.** The fixture is literally the measured sequence — `beforeinput(data:"。",insertText,isComposing:false)`, `input`, `keydown(keyCode:229)`, `keyup` — with **no composition events at all**, replayed into a real `Terminal` where `_inputEvent`'s guard `(!e.composed||!this._keyDownSeen)` is live. Today that fixture cannot be written: `setupImeComposition.test.ts:14-21` hand-builds a bare textarea with no xterm, and `createTerminalInstance.test.ts:42` does `vi.mock("@xterm/xterm")`. **No test in the repository instantiates both writers.** That is the engine that turns each fix into a recurring class: the counterparty is mocked away, so a test can only ever restate its author's model of xterm, and a wrong model passes the gate.

**Two honest caveats.** (a) `createTerminalInstance.test.ts` mocks xterm wholesale — plausibly because a real `Terminal` needs canvas/measurement that jsdom lacks. If so, the fixture tier must run in a real engine (`@vitest/browser` + Playwright WebKit, ~200 MB, new CI job) and cannot gate `check:all` from jsdom. That is the largest single cost of this plan and it is also the only part that addresses "a green suite shipped the bug." (b) **We do not know** whether jsdom faithfully reproduces the microtask checkpoint between listeners. If it does not, the ordering assertions are worthless in jsdom regardless of (a). Verify this in Step 0 before designing around it.

Add **mutation testing scoped to the new pure modules** (`resolveCommit`, the keymap rows). Coverage on these files is already 95.1% lines while five guards are deletable and one constant shrinkable 16× with everything green — line coverage demonstrably measures nothing here.

## What remains unknowable without more measurement

Someone must physically type. For each row, record: every input-family event with `type`, `eventPhase`, `data`, `inputType`, `isComposing`, `composed`, `cancelable`, `key`, `code`, `keyCode`, all four modifier flags; `textarea.value` **before and after each listener**; every `term.onData` chunk; every `pty.write` with a dispatch id; and the **raw PTY echo byte stream** (ground truth #5's lesson — the phantom second period was zsh-autosuggestions ghost text, and only the byte stream settled it).

1. **macOS Pinyin, non-Shift punctuation beyond 。** — ，；：、 . Assumed to behave like 。; unverified.
2. **macOS Pinyin, Shift punctuation** — ？！～《》（）—— . Ground truth #3 explains *why* 「？」 differed; nobody has recorded the full set.
3. **WeChat input method on macOS, Shift full-width punctuation.** This is the case `setupImeComposition.ts:234-262` exists for, and **the keydown-vs-input order for it is the single load-bearing unknown** — it decides whether the DEL hazard in the last table row is live or theoretical. Record whether that keydown carries `keyCode === 229` and whether it precedes or follows `input`.
4. **macOS Pinyin multi-syllable commit** (nihao → 你好), plus mid-composition Backspace and rapid back-to-back commits — the `#525`/`#768` chunking.
5. **Linux WebKitGTK + fcitx5/rime** — the orphan `compositionend` with and without a preceding `compositionstart`, which is the exact branch `#659` and `#948` disagree about (`setupImeComposition.ts:143-157`).
6. **Windows WebView2 + Microsoft Pinyin and MS-IME Japanese.**
7. **Japanese Kotoeri henkan and reconversion; Korean 2-Set jamo assembly.** Reconversion matters because clearing the textarea on `compositionend` (T3) disables it — the status quo already effectively does, so it is not a regression, but it is a real limitation nobody has measured.
8. **Non-IME `insertText` producers**: dictation, Voice Control, the emoji picker, press-and-hold accent popup, Option-dead-keys (Option+e then e). VMark's `onInput` will claim these once T1 lands; their current behaviour is untested in either design.
9. **Every one of the above with `screenReaderMode: true`.** xterm's `_inputEvent` guard ends in `&&!this.optionsService.rawOptions.screenReaderMode` and `_keyDown`'s final `cancel` is conditional on it; VMark exposes the setting live (`createTerminalInstance.ts:171`). This is a second, entirely untested matrix in both the current design and the proposed one.
10. **`beforeinput` fidelity on WebKitGTK** — whether it fires with a correct `inputType` and is cancelable. Ground truth #1 measured it in WKWebView only. Steps 3–5 do not depend on it; a future move toward Proposal 1's text channel would.

Everything on this list is currently answered by inference. None of it should be.

---

## Appendix A — audit caveat: 13 findings were never adversarially verified

The workflow capped verification at the first 8 findings per lens (`slice(0, 8)`), and three
lenses returned 12 each while one returned 9. **13 findings were therefore silently dropped
before the refutation stage** — they are neither confirmed nor refuted. They are listed in
Appendix C so they are not lost. This was an orchestration defect, not a deliberate scope bound;
re-running with the cap raised would close it.

## Appendix B — the 46 findings that were adversarially verified

12 survived (they are the table in "Verified defects still live in the working tree" above).
34 were refuted — a 74% refutation rate, which is the intended outcome: architecture audits
produce confident-sounding wrong conclusions unless each claim is attacked. Full verdicts and
reasoning are in the run journal.

Titles of all 46, in the order produced:

- `[critical]` Root cause: the variable that decides which writer owns a keystroke is private to xterm, and xterm's only arbitration hook does not cover the channel IME text travels on — so arbitration is not computable, only guessable
- `[critical]` Reconciliation is keyed on payload equality plus a clock, but the two channels can carry DIFFERENT payloads for one keystroke and IDENTICAL payloads for two keystrokes — both directions are proven by the codebase's own code
- `[critical]` No test in the repository instantiates both writers — each suite models exactly one, so the seam where every one of these bugs lives has zero coverage, and refuted beliefs are still asserted green
- `[high]` The comment justifying the newest duplication mitigation states a listener-order fact that is provably false; the mitigation is inert as protection and simultaneously arms the next bug (a spurious DEL byte)
- `[high]` The one place the code actually elects a writer decides by content-sniffing a shared mutable buffer, and the two elections are directly contradictory
- `[high]` Hypothesis adjudication: "no single choke point" (H1) is REFUTED as root cause — the choke point already exists and is exactly where the failed guards live; "state in three modules" (H5) is a real amplifier but downstream
- `[critical]` The IME layer has zero platform branches, but the writer election it arbitrates is decided by DOM event ORDER, which differs per engine — so the same code elects a different writer on each platform
- `[high]` The Linux #948 fix turned an unconditional drop into an 80 ms timing race on macOS, and reuses IME_COMPOSITION_GRACE_MS as a duplicate-detection window
- `[high]` The #1139 plain-insertText forward has no dedup against the commit anchor, and the fcitx5 orphan branch disarms the only guard that would stop it
- `[high]` On Linux and Windows the terminal steals core readline chords (Ctrl+A/K/F/V/0-5) — the macOS Ctrl-passthrough fix was gated to macOS and the other cells frozen as "pre-existing behavior"
- `[high]` No test in the repository ever runs VMark's IME listeners against real xterm — the two-writer arbitration, which is the entire bug class, is untestable by construction
- `[medium]` Key repeat is unmodelled, and every platform's default repeat interval is shorter than both dedup windows — so held keys are systematically misclassified as echoes
- `[medium]` Wall-clock guard constants tuned on macOS are applied unchanged to WebKitGTK, WebView2, and to every machine load — the guards degrade silently under CPU pressure
- `[medium]` Dead keys / Option-accents are an UNHANDLED matrix row on macOS, and the key handler documents the opposite
- `[critical]` The 80 ms grace window is a total input blackout, and 80 ms is ~80× longer than the ordering fact it actually encodes
- `[high]` Path A eats genuine keystrokes that happen to prefix the un-consumed remainder — for 150 ms after every commit, with no character-class filter
- `[high]` Path B has no consumption and no bound — it suppresses every integer-repeat of the committed string within 150 ms, unlimited times
- `[high]` The textarea clear at setupImeComposition.ts:251 makes xterm emit a destructive DEL that no guard can catch — the mitigation converts a caught duplicate into an uncaught data loss
- `[medium]` `Date.now()` is used as both a deadline and a commit identity — non-monotonic, and 1 ms granularity collides
- `[medium]` The commit path has no dedup against itself, and the cross-path echo token is a single content-keyed slot that excludes ASCII
- `[medium]` The dedup anchor is armed by *intent* to commit, not by an actual write
- `[medium]` The most destructive guard in the input stack has zero test coverage; the suite models the guards rather than the browser
- `[critical]` No test anywhere composes the two writers — the arbitration that IS the bug class has zero coverage
- `[critical]` The fake session instance uses static fields where production uses live getters, making `instance.composing` permanently false — the #619 blanket guard is provably untested
- `[critical]` compositionGuard.test.ts (726 lines, the largest IME test asset) tests a hand-written copy that has drifted, and now asserts behaviour production explicitly abandoned
- `[high]` Capture-phase registration — the ordering property the code comment calls load-bearing — is invisible to the suite; flipping it to bubble keeps 591/591 green
- `[high]` Not one test asserts the observable contract — 'one physical keystroke → exactly one pty.write'
- `[high]` createTerminalInstance.test.ts — advertised as the 'real wiring' test — mocks away the second writer entirely
- `[high]` The two halves of one keystroke are tested in two files that never meet, with incompatible event models — so ground truth #1's ordering is inexpressible
- `[medium]` Grace/dedup window durations are unpinned downward — shrinking the 80 ms grace by 16× keeps the suite green
- `[critical]` The variable that decides whether xterm writes (`_keyDownSeen`) is private and unobservable — every VMark guard is a content/time proxy for it
- `[critical]` Listener registration order is the load-bearing mechanism — and VMark already owns a DOM-guaranteed anchor it is not using
- `[high]` There is no public switch to disable xterm's IME/composition handling — `disableStdin` is an all-or-nothing kill that also breaks terminal protocol replies and makes the textarea readOnly
- `[high]` `term.textarea.value` is shared mutable state with five confirmed writers and two independent absolute-offset trackers — VMark's own mitigation writes into it
- `[high]` `term.input()` is public API, unused — VMark's PTY-bypass writes silently drop three documented `triggerDataEvent` side effects
- `[high]` `attachCustomKeyEventHandler` returning `false` also cancels xterm's composition bookkeeping — an undocumented side effect the IME layer now rides on
- `[high]` The test double omits xterm entirely — the suite is structurally incapable of observing the behavior under audit
- `[medium]` The helper textarea is looked up by internal CSS class instead of the public `term.textarea` getter — a rename disables the entire IME layer with no production signal
- `[high]` Toggle-Terminal during the 80 ms grace: the terminal handler abstains silently, so the window handler executes the exact action the guard exists to prevent
- `[high]` `composing` has exactly one reset path (an incoming `compositionend`) and no watchdog — a missing compositionend deafens the session forever
- `[high]` The macrotask echo token's real lifetime is "until a starved 0 ms timer runs", not "until this task ends" — it silently drops repeated characters under load
- `[high]` Teardown order kills the PTY before the dispose-time IME flush, and `VMarkPty.write()` has no post-kill guard — the #793 flush can never deliver
- `[high]` Both terminal windows are measured with `Date.now()` (wall clock); a backward clock step leaves the dedup window permanently open
- `[medium]` The 80 ms grace is a total blackout sized against a 0 ms hazard — it drops genuine input, pastes, and terminal query replies with no retry
- `[medium]` Empty-string onData reaches a real `pty_write` syscall unguarded, and its sole producer can also emit a stale slice of the textarea VMark itself invalidated
- `[medium]` A grace-timer flush after the shell exits triggers a respawn that wipes the exit message the user never saw

## Appendix C — the 13 findings dropped before verification (UNVERIFIED — treat as leads only)

- `[medium]` Every guard assumes the two writers are serialised; nothing below `pty.write` enforces ordering, and the xterm internals they depend on are pinned by a caret range
- `[medium]` setupImeComposition.test.ts:267's 'while a composition is active' test builds isComposing:false, so the guard it names is dead code to the suite
- `[medium]` terminalKeyHandler.test.ts's keyCode-229 test uses an impossible shape (Cmd+V reported as 229), while every chord test uses keyCode 0 — the 82e5cc8a regression class is untested at both ends
- `[medium]` Double-toggle (D4) falls between two green tests that each remove the other's handler
- `[medium]` The suite systematically tests against DOUBLING and never against LOSS, so the next failure in this family will be the silent one
- `[medium]` The 80 ms and 150 ms windows are wall-clock approximations of xterm's `setTimeout(...,0)` composition schedule — a proven-wrong model that survived the proof
- `[medium]` `screenReaderMode` is a live user setting that changes which writer exists — no VMark guard reads it
- `[low]` `cancelEvents:false` — the app depends on the ABSENCE of an upstream default, and on xterm's own `cancel()` calls being no-ops
- `[low]` CSS selectors bind to xterm's internal DOM structure (`.xterm-scrollable-element > .scrollbar > .slider`)
- `[medium]` No FIFO guarantee exists below `pty.write()` — the whole dedup architecture assumes ordering the transport does not provide
- `[medium]` The 726-line timing test suite is a drifted reimplementation — its `dispose()` does the opposite of production's `cleanup()`
- `[medium]` Keystrokes during the shell-spawn window are dropped even though `lib/pty.ts` already implements the queue that would hold them
- `[low]` The 150 ms prefix dedup swallows genuine repeated keystrokes after an ASCII IME commit
