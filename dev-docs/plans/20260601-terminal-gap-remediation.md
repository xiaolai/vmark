# Terminal — Gap Remediation (Implementation Plan)

> Created: 2026-06-01
> Status: **Draft — not started.**
> Source audit: [`dev-docs/audit/20260601-terminal-gaps.md`](../audit/20260601-terminal-gaps.md)
> (gap IDs **G1–G10** + §3 coverage + §6 deferred referenced below).
> Predecessor: [`20260531-terminal-industrial-best.md`](20260531-terminal-industrial-best.md)
> (the prior 7-phase overhaul this follows up).
> Phase-DoD checker: `scripts/check-terminal-gaps-phase.sh <N>` — created in WI-1.0,
> templated from `scripts/check-terminal-phase.sh` (rule 60 §3).
> Branch strategy: per-phase feature branch off `main`; one commit per WI.
> Governance: rules `10-tdd`, `21-website-docs`, `41-keyboard-shortcuts`,
> `60-ai-governance`. **4 phases (>3) → Codex cross-model review
> (`/cc-suite:review-plan`) mandatory before Phase 1 commits** (rule 60 §6).
> No new runtime dependencies anticipated (`check-new-deps.sh` stays green).

---

## Outcomes

- **Desired behavior:**
  - Enabling shell integration **never** breaks a user's shell config, including
    custom `$ZDOTDIR` setups (G1).
  - Pasting multiline content **cannot silently auto-execute** (G2).
  - Security-critical link handling has regression tests (G5).
  - The terminal is usable with a screen reader (G3) and surfaces the program's
    title on its tab (G4).
  - Smaller correctness/UX/observability gaps closed (G6–G10) and the new OSC /
    shell-integration / link code reaches the repo's coverage bar (§3).
- **Constraints:** macOS-primary (AGENTS.md); TDD (rule 10) — each WI names a RED
  test written first; files < ~300 lines; user-facing strings via `t()`/`t!()`;
  user-visible changes update `website/guide/terminal.md` (rule 21); every phase
  ends `pnpm check:all` **and** `cargo test` green and is independently shippable.
- **Non-goals (this plan):** bash/fish integration, OSC 133 B, session persistence,
  splits / >5 sessions, `PtySize` pixel dims, search regex/count, `EDITOR` PATH
  hint, translating the existing English `terminal.shellIntegration` strings. These
  are §6 deferred scope — tracked in Phase 5, not scheduled here.

## Constraints & Dependencies

- **Runtime/toolchain:** Tauri v2, React 19, xterm.js (current pinned), portable-pty
  (Rust), Vitest v4, `cargo test`.
- **OS/platform:** macOS primary; zsh is the only integrated shell today. Windows/
  Linux best-effort — no regressions.
- **External services:** none.
- **Env/secrets:** none new. G1 reads the user's login-shell environment.
- **Feature flags:** `settings.terminal.shellIntegration` (existing, default state
  per `settingsStore`) gates G1's code path — a built-in kill switch.

## Current Behavior Inventory

- **Entry points:** `TerminalPanel.tsx` → `useTerminalSessions.ts` → `spawnPty.ts`
  (`invoke("pty_spawn"/"pty_start")`, `invoke("prepare_shell_integration")`,
  `invoke("get_login_shell_path")`) → Rust `pty.rs`, `shell_integration.rs`,
  `ai_provider::login_shell_path()`.
- **Data flow:** PTY bytes → binary `Channel` → `term.write` (xterm). OSC handlers
  in `setupOsc.ts` (7, 133 only). Links via `fileLinkProvider.ts`/`setupFileLinks.ts`
  /`setupWebLinks.ts`. Settings sync live via `terminalSessionStoreSync.ts`.
- **Persistence:** none for sessions. Shell-integration rc materialized to
  `<appLocalData>/shell-integration/zsh/.zshrc` (`shell_integration.rs`).
- **Known invariants (must not regress — verified safe in the audit §4):**
  point-to-point per-session `Channel`; per-PID exit events; per-window
  `sessionsRef`; `PtyState::drop` app-exit cleanup; active flow-control
  (`PauseControl` + watermarks).

## Target Rules

1. **Shell-integration ZDOTDIR (G1).** Trigger: `shellIntegration` on, shell is zsh.
   The child shell must source the user's **real** rc. Resolve the user's effective
   `ZDOTDIR` from a login shell; expose it to the child as `USER_ZDOTDIR`. Scope:
   zsh only. Exclusion: unset `ZDOTDIR` → omit `USER_ZDOTDIR` (vmark.zsh's
   `:-$HOME` is correct). Failure mode: login-shell query fails → omit
   `USER_ZDOTDIR` (degrades to `$HOME`, today's behavior) and log; never block spawn.
2. **Paste safety (G2).** Trigger: Cmd+V in terminal. Behavior: route through
   `term.paste(text)` so xterm wraps it per the app's bracketed-paste mode. Scope:
   all clipboard paste paths. Exclusion: empty clipboard → no-op. Failure: clipboard
   read error → existing warn log, no write.
3. **Link security tests (G5).** Behavior: `setupWebLinks` opens only `http/https/
   mailto`; rejects `javascript:`/`file:`/`data:`/`vbscript:` and control chars
   (case-insensitively), including via OSC 8. `setupFileLinks` dispatches editor nav
   with parsed `line`/`col`. Tests assert each.
4. **Accessibility (G3).** Trigger: setting on. Behavior: xterm `screenReaderMode`
   enabled; live-synced. Default: off (perf). Exclusion: WebGL renderer unaffected.
5. **Title (G4).** Trigger: OSC 0/1/2. Behavior: store program title per session;
   tab shows it **unless** the user manually renamed the session (user name wins).
   Exclusion: empty title → keep prior. Failure: malformed → ignore.
6. **Polish (G6–G10).** fontFamily live-syncs; scrollback configurable; reader I/O
   errors logged (distinct from exit-1); `Drop`/per-session kill `wait()`s the child;
   bell-mode/contrast/paste settings exposed.

## Decision Log

- **D1 — How to obtain the user's `ZDOTDIR` (G1).**
  - Options: (a) read `std::env::var("ZDOTDIR")` in the GUI process; (b) a new
    cached `login_shell_zdotdir()` mirroring `login_shell_path()`; (c) extend
    `login_shell_path()` into a combined `login_shell_env()` returning PATH+ZDOTDIR.
  - **Decision: (b).** A separate `OnceLock`-cached resolver that spawns
    `$SHELL -lic 'printf %s "$ZDOTDIR"'` with sentinels, draining stdout like
    `login_shell_path()` does.
  - Rationale: (a) fails — macOS GUI apps have a minimal env, `$ZDOTDIR` is usually
    absent (this is the root cause). (c) is invasive — `login_shell_path()` is
    consumed in many places (`pandoc`, `ai_provider`); changing its signature risks
    unrelated breakage. (b) is isolated, cached (one extra one-time shell spawn),
    and testable.
  - Rejected: (a) incorrect; (c) too broad a blast radius.
- **D2 — Paste safety mechanism (G2).**
  - Options: (a) route through `term.paste()`; (b) keep raw write but add a
    bracketed-paste wrapper manually; (c) add a multiline-paste confirm dialog.
  - **Decision: (a).** `term.paste()` already honors the app's bracketed-paste mode.
  - Rationale: smallest correct change; xterm owns the wrapping logic. A confirm
    dialog (c) is an optional later UX nicety (Open Question Q1), not the safety
    mechanism.
  - Rejected: (b) re-implements xterm; (c) heavier UX, not required for safety.
- **D3 — `screenReaderMode` default (G3).** Default **off**, opt-in setting.
  Rationale: screen-reader mode adds a live DOM region with a perf cost; most users
  don't need it. Rejected always-on (perf regression for the majority).
- **D4 — Title precedence (G4).** Program title (OSC 0/1/2) is shown unless the user
  manually named the session. Rationale: explicit user intent beats program output.
- **D5 — Phasing.** Order strictly by audit priority P0→P3; each phase shippable.
  Rationale: G1 is a live regression — ship first, alone.

## Open Questions

- **Q1 — Multiline-paste confirm dialog?** Why it matters: even with bracketed
  paste, some users want a "paste N lines?" prompt. Who decides: xiaolai. Default if
  unresolved: **no dialog** — rely on bracketed paste (D2); revisit if requested.
- **Q2 — Scrollback default & max (G7/WI-4.2).** Keep default 5000? Allow ∞?
  Default if unresolved: default **5000**, configurable 1000–100000 (no ∞ — memory).
- **Q3 — Does enabling `screenReaderMode` need to auto-detect VoiceOver?** Default:
  **no auto-detect** — manual setting only (auto-detection is unreliable in webviews).

## API / Contract Changes

- New Tauri command/helper: `login_shell_zdotdir()` (internal; or surfaced as a
  command if the resolver lives frontend-adjacent — **prefer internal**, called from
  `prepare_shell_integration`). No public-tool/schema change.
- `prepare_shell_integration` return value gains an optional `USER_ZDOTDIR` entry in
  its env map (additive; old behavior = entry absent).

## Observability

- G8: reader-loop I/O errors logged via `log::warn!` with errno/kind before the loop
  breaks; exit event distinguishes "reader error" from a real child exit code.
- G1: log when the login-shell ZDOTDIR query fails (degraded path taken).

---

## Work Items

### Phase 1 — G1: custom `$ZDOTDIR` regression (P0, ship alone)

#### WI-1.0: Phase-DoD checker script
- **Goal:** `scripts/check-terminal-gaps-phase.sh <N>` exists; phase 1 asserts the
  `USER_ZDOTDIR` wiring + tests are present.
- **Acceptance:** `bash scripts/check-terminal-gaps-phase.sh 1` exits 0 only after
  WI-1.1/1.2 land; non-zero before.
- **Tests (first):** the script *is* the check (self-verifying via grep assertions).
- **Touched areas:** `scripts/check-terminal-gaps-phase.sh` (new).
- **Dependencies:** none. **Risks:** none. **Rollback:** delete script. **Est:** S.

#### WI-1.1: Resolve the user's login-shell `ZDOTDIR` (Rust)
- **Goal:** add cached `login_shell_zdotdir() -> Option<String>` mirroring
  `login_shell_path()` (sentinel echo via `$SHELL -lic`, stdout drained in a thread,
  `OnceLock` cache, timeout, graceful failure → `None`).
- **Acceptance (measurable):** unit test: given a fake `$SHELL` script that prints a
  known `ZDOTDIR`, the resolver returns it; given an unset `ZDOTDIR`, returns `None`;
  given a failing/timing-out shell, returns `None` (no panic, no hang).
- **Tests (first):** `src-tauri/src/ai_provider/detection.rs` `#[cfg(test)]` —
  `login_shell_zdotdir_*` (parse sentinels; empty → None; spawn failure → None).
- **Touched areas:** `src-tauri/src/ai_provider/detection.rs`
  (`login_shell_zdotdir`, sentinel parse helper shared with `login_shell_path`).
- **Dependencies:** none. **Risks:** extra one-time shell spawn (mitigate: cache +
  short timeout, reuse the drain-thread pattern to avoid pipe deadlock).
- **Rollback:** remove the fn; WI-1.2 falls back to omitting `USER_ZDOTDIR`. **Est:** M.

#### WI-1.2: Pass `USER_ZDOTDIR` from `prepare_shell_integration`
- **Goal:** include `USER_ZDOTDIR` in the returned env map when the resolver yields a
  value; omit when `None`.
- **Acceptance:** unit test on `prepare_shell_integration` (or a pure helper it calls):
  resolver→`Some("/x/zsh")` ⇒ map has `USER_ZDOTDIR=/x/zsh` **and** `ZDOTDIR=<vmark>`;
  resolver→`None` ⇒ map has only `ZDOTDIR`. Existing `embedded_script_has_the_osc_marks`
  test still green.
- **Tests (first):** `src-tauri/src/shell_integration.rs` `#[cfg(test)]` —
  `env_includes_user_zdotdir_when_resolved`, `env_omits_user_zdotdir_when_unset`.
  (Extract the env-map build into a pure fn taking the resolved value, so it's
  testable without spawning a shell.)
- **Touched areas:** `shell_integration.rs` (env-map builder + call to WI-1.1),
  `lib.rs` (no new command unless surfaced). `vmark.zsh` unchanged (already reads
  `USER_ZDOTDIR`).
- **Dependencies:** WI-1.1. **Risks:** none beyond WI-1.1. **Rollback:** drop the
  `USER_ZDOTDIR` insert (reverts to today). **Est:** S.

#### WI-1.3: Docs
- **Goal:** `website/guide/terminal.md` notes shell integration preserves custom
  `$ZDOTDIR` (rule 21).
- **Acceptance:** `cd website && pnpm build` green; section present.
- **Tests:** n/a (docs). **Touched:** `website/guide/terminal.md`. **Dep:** WI-1.2.
- **Est:** S.

**Phase 1 DoD:** `check-terminal-gaps-phase.sh 1` = 0; `cargo test` green incl. new
tests; manual: a custom-`$ZDOTDIR` zsh user's aliases/theme load in the VMark
terminal with integration on (Manual Checklist).

---

### Phase 2 — G2 paste safety + G5 security tests (P1)

#### WI-2.1: Route paste through `term.paste()`
- **Goal:** Cmd+V calls `term.paste(text)` instead of `ptyRef.write(text)`.
- **Acceptance:** unit test: with bracketed-paste mode active, a multiline paste is
  delivered wrapped (via a `term.paste` spy / fake that records the call); raw
  `ptyRef.write` is **not** used for paste. Double-paste guard preserved.
- **Tests (first):** `src/components/Terminal/terminalKeyHandler.test.ts` —
  `paste routes through term.paste, not raw pty write`.
- **Touched areas:** `terminalKeyHandler.ts` (the `case "v"` block, ~line 137-149).
- **Dependencies:** none. **Risks:** `term.paste` semantics differ from raw write
  for non-bracketed shells (mitigate: `term.paste` degrades to a plain write when the
  app hasn't enabled bracketed mode — same bytes as today). **Rollback:** restore raw
  write. **Est:** S.

#### WI-2.2: `setupWebLinks.test.ts` (security)
- **Goal:** regression tests for the scheme allowlist + control-char rejection + OSC 8.
- **Acceptance:** asserts `http/https/mailto` open; `javascript:`, `file:`, `data:`,
  `vbscript:` (and uppercase variants) do **not**; control-char-laced URLs rejected;
  an OSC 8 link with a dangerous scheme is not opened.
- **Tests (first):** `src/components/Terminal/setupWebLinks.test.ts` (new).
- **Touched areas:** test only (code already correct — audit §2 G5).
- **Dependencies:** none. **Risks:** none. **Rollback:** n/a. **Est:** S.

#### WI-2.3: `setupFileLinks.test.ts`
- **Goal:** tests for editor-jump dispatch + `:line:col` nav payload.
- **Acceptance:** activating a link with `:10:5` dispatches nav with line=10 (col
  carried per current contract); plain path → open without nav.
- **Tests (first):** `src/components/Terminal/setupFileLinks.test.ts` (new).
- **Touched areas:** test only. **Dep:** none. **Risks:** none. **Est:** S.

**Phase 2 DoD:** `check-terminal-gaps-phase.sh 2` = 0; `pnpm test` green; the two new
test files exist and cover the dangerous schemes; paste no longer auto-executes
multiline content under a bracketed-paste-aware shell (Manual Checklist).

---

### Phase 3 — G3 a11y + G4 title (P2)

#### WI-3.1: `screenReaderMode` setting
- **Goal:** new `settings.terminal.screenReaderMode` (default off); applied to xterm
  options at create + live-synced; UI control in `TerminalSettings.tsx`; i18n key.
- **Acceptance:** unit test: toggling the setting flips `term.options.screenReaderMode`
  on a live session (via the store-sync); settings store has the field with default
  `false`; new i18n key present in `src/locales/en/*` (and copied to other locales
  per existing pattern).
- **Tests (first):** `terminalSessionStoreSync.test.ts` —
  `screenReaderMode change applies to live sessions`; store test for the default.
- **Touched areas:** `settingsStore.ts`, `createTerminalInstance.ts` (option),
  `terminalSessionStoreSync.ts` (live-sync), `TerminalSettings.tsx`,
  `src/locales/*/settings.json`. Docs: `website/guide/terminal.md` + `settings.md`.
- **Dependencies:** none. **Risks:** perf if default-on (mitigate: default off, D3).
- **Rollback:** remove setting + option. **Est:** M.

#### WI-3.2: OSC 0/1/2 → per-session tab title
- **Goal:** register OSC 0/1/2 handlers in `setupOsc.ts`; store program title per
  session; `TerminalTabBar` shows it unless user-renamed (D4).
- **Acceptance:** unit test: feeding `\e]2;mytitle\a` sets the session's program
  title; tab renders `mytitle`; a user-renamed session ignores the program title.
- **Tests (first):** `setupOsc.test.ts` — `OSC 2 sets program title`,
  `OSC 0/1 set title`, `malformed/empty title ignored`; `TerminalTabBar.test.tsx` —
  `tab shows program title unless renamed`.
- **Touched areas:** `setupOsc.ts` (handlers + callback), session state (store),
  `useTerminalSessions.ts` (wire callback), `TerminalTabBar.tsx` (render).
- **Dependencies:** none. **Risks:** title precedence ambiguity (resolved by D4).
- **Rollback:** unregister handlers; tab falls back to default name. **Est:** M.

**Phase 3 DoD:** `check-terminal-gaps-phase.sh 3` = 0; `pnpm check:all` green; manual:
VoiceOver announces terminal output with the setting on; `printf '\e]2;hi\a'` retitles
the tab (Manual Checklist).

---

### Phase 4 — G6–G10 polish + §3 coverage backfill (P3)

#### WI-4.1: Live-sync `fontFamily`
- **Goal:** font-family changes propagate to running sessions (like fontSize today).
- **Acceptance:** unit test: changing the mono-font setting updates
  `term.options.fontFamily` on live sessions.
- **Tests (first):** `terminalSessionStoreSync.test.ts` — `fontFamily live-sync`.
- **Touched:** `terminalSessionStoreSync.ts`. **Dep:** none. **Est:** S.

#### WI-4.2: Configurable scrollback
- **Goal:** `settings.terminal.scrollback` (default 5000, range per Q2); applied at
  create + live-synced.
- **Acceptance:** store default test; setting flows to `term.options.scrollback`;
  UI control + i18n; docs.
- **Tests (first):** store test + `terminalSessionStoreSync.test.ts`.
- **Touched:** `settingsStore.ts`, `createTerminalInstance.ts`,
  `terminalSessionStoreSync.ts`, `TerminalSettings.tsx`, locales, docs. **Est:** M.

#### WI-4.3: Reader I/O error logging + distinct exit (Rust)
- **Goal:** log read errors (kind/errno) before the loop breaks; signal reader-error
  vs child-exit distinctly instead of `unwrap_or(1)`.
- **Acceptance:** Rust test that a simulated read error path logs/returns the
  distinct signal (use a seam: extract the exit-code derivation into a testable fn).
- **Tests (first):** `pty.rs` `#[cfg(test)]` — `reader_error_distinguished_from_exit`.
- **Touched:** `pty.rs:292-298`. **Dep:** none. **Risks:** exit-event contract change
  (mitigate: additive field). **Est:** M.

#### WI-4.4: `wait()` killed children (Rust)
- **Goal:** `Drop` and per-session kill `wait()` the child after `kill()` to reap zombies.
- **Acceptance:** Rust test (where feasible) or documented manual `ps` check; no
  zombie after rapid session open/close.
- **Tests (first):** `pty.rs` `#[cfg(test)]` where the child is mockable; else Manual
  Checklist `ps` step.
- **Touched:** `pty.rs:106-120` + kill path. **Dep:** none. **Est:** S.

#### WI-4.5: Settings coverage — bell mode / contrast / (paste warn if Q1=yes)
- **Goal:** expose bell mode (audible/visual/off) + `minimumContrastRatio` choice.
- **Acceptance:** settings + live-sync + i18n + docs; tests for store defaults +
  sync.
- **Tests (first):** store + sync tests. **Touched:** as WI-4.2 set. **Est:** M.

#### WI-4.6: Coverage backfill (§3)
- **Goal:** tests for `:line:col` edges (`:0:0`, non-numeric, trailing colon),
  OSC 133 out-of-order (`D` before `A`, double `D`, non-numeric code), and the
  `shell_integration` atomic-write race.
- **Acceptance:** new cases in `fileLinkProvider.test.ts`, `setupOsc.test.ts`, and a
  Rust concurrent-`prepare_shell_integration` test; coverage on these files rises.
- **Tests (first):** the cases themselves. **Touched:** test files only. **Est:** M.

**Phase 4 DoD:** `check-terminal-gaps-phase.sh 4` = 0; `pnpm check:all` + `cargo test`
green; coverage not regressed.

---

### Phase 5 — Deferred product scope (tracked, NOT scheduled)

Carried from audit §6 — each is its own future plan/WI when prioritized:
bash/fish integration · OSC 133 B · session/scrollback **persistence** (C3) ·
splits / >5 sessions (M5) · `PtySize` pixel dims (M6) · search regex/case/whole-word/
**count** (S5) · `EDITOR=vmark` PATH hint (S3) · **translate** the English
`terminal.shellIntegration` strings into all locales.

---

## Gap → WI map

| Gap | WI(s) |
|---|---|
| G1 (custom $ZDOTDIR, P0) | WI-1.1, WI-1.2, WI-1.3 |
| G2 (paste bracketed, P1) | WI-2.1 |
| G5 (security tests, P1) | WI-2.2, WI-2.3 |
| G3 (screenReaderMode, P2) | WI-3.1 |
| G4 (OSC 0/1/2 title, P2) | WI-3.2 |
| G6 (fontFamily sync) | WI-4.1 |
| G7 (scrollback setting) | WI-4.2 |
| G8 (reader error logging) | WI-4.3 |
| G9 (Drop wait) | WI-4.4 |
| G10 (settings coverage) | WI-4.5 |
| §3 coverage backfill | WI-4.6 |
| §6 deferred | Phase 5 (out of scope) |

## Testing Procedures

- **Fast (per WI):** frontend `pnpm test src/components/Terminal` (or the specific
  file); Rust `cargo test --manifest-path src-tauri/Cargo.toml pty shell_integration
  detection`.
- **Full gate (per phase):** `pnpm check:all` **and**
  `cargo test --manifest-path src-tauri/Cargo.toml`.
- **Phase DoD:** `bash scripts/check-terminal-gaps-phase.sh <N>` exits 0.
- **Live (Tauri MCP, per AGENTS.md — never Chrome DevTools):** OSC title retitle,
  paste-no-autoexec, VoiceOver readout, custom-`$ZDOTDIR` config load.
- **When:** fast on every change; full gate before each phase commit/merge; live
  before marking a phase "complete".

## Rollout Plan

- **Feature flag:** G1 rides the existing `settings.terminal.shellIntegration` toggle
  — the built-in kill switch (turn it off to revert to no-integration spawn).
  G3/G4/G7/G10 are new opt-in settings (default off/unchanged).
- **Staging:** ship Phase 1 alone (it fixes a live regression); subsequent phases are
  independently shippable.
- **Revert:** per-WI rollback noted above; `git revert` the phase commit; or disable
  the relevant setting.

## Plan → Verify Handoff

- **Evidence per WI:** named RED test(s) green; `check:all`/`cargo test` output; for
  G1/G3/G4 a Tauri-MCP live screenshot/log; for WI-4.4 a `ps` zombie check.
- **Fixtures:** WI-1.1 needs a fake `$SHELL` script emitting a known `ZDOTDIR` (and a
  failing/timeout variant). WI-3.2/4.6 need OSC byte fixtures (`\e]2;…\a`,
  `\e]133;D;…\a`).

## Manual Test Checklist

- [ ] Custom `$ZDOTDIR` user (e.g. `~/.config/zsh/.zshrc`): with shell integration
      **on**, their aliases/theme/env load in the VMark terminal (G1).
- [ ] Default user (unset `ZDOTDIR`): integration still works, `$HOME/.zshrc` loads (G1).
- [ ] Paste a multiline snippet into an interactive shell with bracketed paste on →
      it is **not** auto-executed (G2).
- [ ] VoiceOver on + `screenReaderMode` setting on → terminal output is announced (G3).
- [ ] `printf '\e]2;hello\a'` → tab title shows "hello"; a renamed tab ignores it (G4).
- [ ] Change mono font in settings → running terminal updates font live (G6).
- [ ] Rapidly open/close terminals → `ps` shows no `<defunct>` zombie children (G9).
