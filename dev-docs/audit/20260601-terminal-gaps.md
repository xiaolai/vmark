# Terminal Reinvestigation — Remaining Gaps (post "industrial-best")

**Date:** 2026-06-01
**Status:** Active
**Scope:** the integrated terminal after the `terminal-industrial-best` merge —
`src/components/Terminal/**`, `src-tauri/src/pty.rs`, `src-tauri/src/shell_integration.rs`,
`src-tauri/resources/shell-integration/vmark.zsh`, `TerminalSettings.tsx`.
**Method:** four parallel read-only deep-dives (PTY backend, frontend lifecycle,
shell/OSC/links, rendering/UX), then a second deeper pass (multi-window isolation,
Channel flow-control, test coverage) — **every high-impact finding re-verified in
source** to filter agent over-claims. Predecessors:
[`20260531-terminal-integration.md`](20260531-terminal-integration.md) (original
audit, finding IDs T/L/C/M/S) and
[`../plans/20260531-terminal-industrial-best.md`](../plans/20260531-terminal-industrial-best.md)
(the 7-phase plan — "all phases complete" with documented deferrals).

> **Headline:** the overhaul landed well. Two of my first-pass suspicions
> (multi-window isolation, flow-control backpressure) turned out **fine** on
> verification. But there is **one real, user-facing regression** (custom
> `$ZDOTDIR` breakage), a paste-safety gap, an accessibility gap, and a
> **security-code-with-no-test** gap — plus the known deferred product scope.

---

## 1. The real regression — fix first

### G1 — Shell integration silently breaks custom `$ZDOTDIR` setups  ★ High

`vmark.zsh:10` restores the user's real rc with `ZDOTDIR="${USER_ZDOTDIR:-$HOME}"`,
but `shell_integration.rs:70` only sets `ZDOTDIR=<vmark dir>` and **never sets
`USER_ZDOTDIR`** — nor does it capture the user's original `ZDOTDIR` anywhere.

Consequence: for any user whose zsh config lives in a custom `$ZDOTDIR` (e.g.
`~/.config/zsh/` — a common "keep `$HOME` clean" setup, popular with exactly the
power users a dev terminal targets), enabling **terminal.shellIntegration** makes
the terminal source `$HOME/.zshrc` instead of their real rc → aliases, theme,
functions, and env silently don't load. Users with the default (unset `ZDOTDIR`)
are unaffected, which is why it slipped through.

**Fix (non-trivial — note the depth):** the Tauri GUI process has a minimal
environment (macOS launch-from-Dock), so `std::env::var("ZDOTDIR")` is usually
empty here — you cannot just read it. The user's effective `ZDOTDIR` must be
resolved from a **login shell**, mirroring `ai_provider::login_shell_path()`
(`lib.rs:338` → cached login-shell PATH query). Resolve it once, pass it to the
child as `USER_ZDOTDIR`; when genuinely unset, `vmark.zsh`'s `:-$HOME` fallback is
already correct. RED test: `prepare_shell_integration` returns an env map that,
given a user `ZDOTDIR`, includes `USER_ZDOTDIR` equal to it.

---

## 2. Confirmed new gaps (verified in source)

| ID | Gap | Location | Sev | Why it matters |
|---|---|---|---|---|
| G2 | **Paste bypasses bracketed-paste mode** — Cmd+V reads the clipboard and writes it **raw** to the PTY, not via `term.paste()` | `terminalKeyHandler.ts:141-143` | Med | When the shell/app has bracketed paste on, raw write skips the `\e[200~`/`\e[201~` guards → multiline paste **auto-executes**. No large-paste warning either. Route paste through `term.paste(text)` (xterm wraps it correctly) and/or add a multiline-size confirm. |
| G3 | **No screen-reader support** — `screenReaderMode` never set | `createTerminalInstance.ts:145-160` | Med | xterm's accessible live-region is off; terminal output is invisible to assistive tech. The repo enforces focus-indicator a11y (rule 33) but the terminal has no a11y path. Expose a setting (default off for perf, on under VoiceOver). |
| G4 | **OSC 0/1/2 window-title dropped** — only OSC 7 & 133 handlers registered | `setupOsc.ts:50,93` | Med | Programs that set the title (`\e]2;…\a`) are ignored → no per-session tab title (e.g. running command / ssh host). VS Code/iTerm2/WezTerm all surface it. (Plan deferred this under M4; bell shipped, title didn't.) |
| G5 | **Security-critical link code has no test** — `setupWebLinks.ts` (scheme allowlist, control-char rejection, OSC 8) and `setupFileLinks.ts` (editor-jump wiring) have **0 test files** | `setupWebLinks.ts`, `setupFileLinks.ts` | Med | The *code* is correct (verified: `http/https/mailto` allowlist, `javascript:`/`file:`/`data:` blocked, control chars stripped) — but in a TDD-enforced repo a security boundary with no regression test is a latent footgun. A future refactor could silently open the scheme allowlist. Add `setupWebLinks.test.ts` asserting each dangerous scheme is rejected. |
| G6 | **Font *family* not live-synced** (only fontSize/lineHeight/cursor are) | `terminalSessionStoreSync.ts:14`; family fixed once at `createTerminalInstance.ts:147` | Low-Med | Theme/CSS-var font changes don't reach running terminals; requires reopen. Add `fontFamily` to the live-sync. |
| G7 | **Scrollback hard-coded `5000`, not configurable** | `createTerminalInstance.ts:160` | Low | Long logs (CI/build output) silently truncate; no setting to raise. Peers allow 10k–∞. |
| G8 | **Reader I/O errors swallowed; exit code masked** — `Err(_) => break` and `child.wait()…unwrap_or(1)` | `pty.rs:295,298` | Low | A read error looks identical to "shell exited 1" — the terminal "just closes" with no diagnostic. Log the error; consider distinct exit signalling. |
| G9 | **`Drop` kills children without `wait()`** | `pty.rs:106-120` | Low | Killed children can linger as zombies until the process exits. Mostly moot at app exit (OS reaps), matters under per-session churn. Add a `wait()` after `kill()`. |
| G10 | **Thin settings coverage** — no bell mode (audible/visual/off), scrollback size, paste-warning, or contrast toggle | `TerminalSettings.tsx`, `createTerminalInstance.ts:158` (`minimumContrastRatio: 4.5` fixed) | Low | Power users expect these; peers expose 20–100+ knobs. |

---

## 3. Test-coverage gaps (TDD-enforced repo — these are real debt)

| Area | State | Highest-value missing cases |
|---|---|---|
| `setupWebLinks.ts` | **no test** | scheme allowlist (block `javascript:`/`file:`/`data:`/`vbscript:`), control-char smuggling, OSC 8 dangerous-scheme rejection — **security; top priority** |
| `setupFileLinks.ts` | **no test** | editor-jump dispatch, `:line:col` → nav payload |
| `fileLinkProvider.ts` | partial | `:0:0`, non-numeric/`:abc:`, trailing-colon, huge line numbers (regex silently no-matches) |
| `setupOsc.ts` (OSC 133) | partial | out-of-order (`D` before `A`), multiple `C` without `D`, malformed/non-numeric exit code, double-`D` |
| `setupOsc.ts` (OSC 7) | partial | non-ASCII hostname, trailing slash, invalid percent-encoding |
| `shell_integration.rs` | partial | concurrent `prepare_shell_integration` atomic-write race; **`USER_ZDOTDIR` (G1) once fixed** |

---

## 4. Verified SAFE — corrections to first-pass suspicions (do NOT chase)

- **Multi-window isolation is correct.** The binary `Channel` is point-to-point
  (`pty.rs:282-290`, per-session in `lib/pty.ts`), exit events are per-PID
  (`pty:exit:{pid}`), each window's `useTerminalSessions` owns its own
  `sessionsRef` (`useTerminalSessions.ts:93`), and `PtyState::drop` kills all
  children on app exit. No collision/broadcast. (Resolves original T2.)
- **Flow-control / backpressure is active and bounded.** `PauseControl`
  (`pty.rs:47-76`) blocks the reader thread before each read; the JS watermark
  logic (`spawnPty.ts:96-153`, HIGH=5/LOW=2) drives pause/resume; no unbounded
  buffer in the PTY→Channel→xterm chain; the 100 KB constant is a deliberate
  parser-lag detector, **not** dead code. (Resolves original S2/T3.)
- **`vmark.zsh`'s `$HOST`** is the zsh builtin (hostname) — correctly set; the OSC 7
  parser ignores host and uses the path, so local cwd works. Not a bug.

## 5. False positives from the automated sweep (recorded so they're not re-chased)

- **"PTY commands missing from `capabilities/`"** — normal Tauri v2: custom
  `#[tauri::command]`s registered via `generate_handler!` don't need per-command
  capability entries (capabilities gate core/plugin permissions).
- **Most `pty.rs` "compromised-webview" injection findings** (env/PATH/cwd/TOCTOU)
  — defense-in-depth only; the webview runs trusted local content, so these aren't
  exploitable without a separate XSS hole. Low-priority hardening at most.
- **file-link "symlink traversal reveals `/etc/passwd`"** — not a vuln: clicking a
  link opens a file the user can already read, in the editor. No escalation.
- **"256-color palette incomplete"** — xterm.js synthesizes 256/truecolor natively;
  the theme only needs the 16 ANSI + fg/bg.
- **PauseControl poisoned-mutex / CSI-u "WezTerm dishonesty"** — theoretical or a misread.

## 6. Known-deferred product scope (from the plan — still open, schedule don't rush)

bash/fish shell integration (zsh-only) · OSC 133 **B** (prompt-end) · session/
scrollback **persistence across restart** (C3 / WI-5.1) · 5-session cap, no splits
(M5) · `PtySize` pixel dims = 0 → coarse mouse tracking (M6) · search **regex/
case/whole-word/result-count** (S5) · `EDITOR=vmark` PATH hint (S3) ·
`terminal.shellIntegration` i18n **untranslated in all locales** · manual visual QA
of decorations/bell.

---

## 7. Prioritized backlog

| Priority | Item | Effort | Risk |
|---|---|---|---|
| **P0** | G1 — custom `$ZDOTDIR` fix (login-shell-resolved `USER_ZDOTDIR`) + test | M | Low (additive env) |
| **P1** | G2 — route paste through `term.paste()` + multiline guard | S | Low |
| **P1** | G5 — `setupWebLinks.test.ts` (security allowlist) + `setupFileLinks.test.ts` | S | None (tests only) |
| **P2** | G3 — `screenReaderMode` setting (a11y) | S-M | Low |
| **P2** | G4 — OSC 0/1/2 title → tab title | M | Low |
| **P3** | G6 font-family sync · G7 scrollback setting · G8 reader logging · G9 `wait()` · G10 settings | S each | Low |
| **P3** | Coverage backfill (§3): `:line:col` edges, OSC 133 out-of-order, atomic-write race | M | None |
| **Sched.** | §6 deferred scope (persistence, bash/fish, splits, search options, i18n) | L | product decisions |

**Recommended first PR:** G1 + its test (the only real regression), then the G5
security tests (cheap, high-value), then G2 (paste safety).
