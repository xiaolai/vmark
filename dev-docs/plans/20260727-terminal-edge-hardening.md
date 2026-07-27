# Terminal — Edge Hardening, Truth, and Gaps (Implementation Plan)

> Created: 2026-07-27
> Status: **IMPLEMENTED — Phases 0–4 complete** (2026-07-27). All 20 WIs landed
> and linked (`bash scripts/check-wi-linkage.sh dev-docs/plans/20260727-terminal-edge-hardening.md`
> → 20/20); `bash scripts/check-terminal-edge-phase.sh 1..4` all exit 0;
> `pnpm check:all` and `cargo test` (1495 tests) green; `cargo fmt --check` and
> `cargo clippy --all-targets -- -D warnings` clean.
> **Open Questions resolved by their stated defaults** (Q1 drop `EDITOR`; Q2
> delete the Pause/Resume docs; Q3 no fish; Q4 add `@xterm/addon-serialize`
> unwired; Q5 search toggles reset). If xiaolai wants a different answer on any
> of them, each is a small, isolated revert — see the Decision Log.
> **Cross-model review (rule 60 §6): done, as a post-implementation audit** —
> 3 rounds of `/cc-suite:audit-fix` against the change set (Codex
> `gpt-5.6-sol`, high effort). 30 findings in round 1 → 25 FIXED / 4 PARTIAL /
> 1 NOT FIXED on first verification → all 5 remainders reworked and verified
> FIXED, 0 REGRESSED. See "Audit history" below.
> **Not run:** the live Manual Test Checklist below (needs `pnpm tauri:dev`).
> Source: fresh investigation of the terminal stack on 2026-07-27 (findings **T1–T14**,
> features **F1–F6** below; every claim grep-verified against the tree at `12cf1515`).
> Predecessors — read these first, they define what is already *done*:
> - [`20260531-terminal-industrial-best.md`](20260531-terminal-industrial-best.md) (7-phase overhaul)
> - [`20260601-terminal-gap-remediation.md`](20260601-terminal-gap-remediation.md) (G1–G10; its
>   "Phase 4 not started" header is **stale** — WI-4.1/4.2/4.3/4.4/4.6 all shipped; its
>   Phase 5 "deferred product scope" is the direct ancestor of T11/T12/T13/T14 here)
> - [`20260722-terminal-input-channel-ownership.md`](20260722-terminal-input-channel-ownership.md)
>   (COMPLETE — the IME path is settled; **this plan must not touch it**)
> Phase-DoD checker: `scripts/check-terminal-edge-phase.sh <N>` — created in WI-0.1,
> templated from `scripts/check-terminal-gaps-phase.sh` (rule 60 §3).
> Branch strategy: per-phase feature branch off `main`; one commit per WI.
> Governance: rules `10-tdd`, `21-website-docs`, `22-comment-maintenance`,
> `31-design-tokens`, `41-keyboard-shortcuts`, `60-ai-governance`.
> New runtime dependencies: **2** (`@xterm/addon-clipboard`, `@xterm/addon-serialize`) —
> both pre-verified below (§Constraints), `check-new-deps.sh` expected green.

---

## Why this plan exists

The terminal's *core* is in good shape: binary `Channel` transport, two-phase spawn
with no data-loss race, condvar flow control, zombie-free reaping on the normal **and**
panic paths, Channel-Ownership IME, OSC 7/8/133, scheme-allowlisted links with a
traversal guard. 565 tests across 35 files, all green.

The **edge** is not. Three shipped features are broken or unreachable, the website
documents a feature that has no implementation at all, six settings strings are English
in all nine non-English locales, and shell integration stops at zsh.

This plan fixes the edge. It is explicitly **not** another core overhaul.

## Outcomes

- **Desired behavior:**
  - No terminal setting is a no-op, and no control silently discards the user's choice (T2, T3).
  - `EDITOR` is never set to something that cannot work (T1).
  - The website describes the terminal that actually ships (T7, T8, T9).
  - Terminal settings read in the user's language (T10).
  - Search answers "how many, which one, any at all" (T12).
  - bash users get the same prompt-nav / exit-status / cwd tracking zsh users get (T11).
  - `ssh`/`tmux` sessions can copy to the host clipboard — and **cannot read it** (T13).
- **Constraints:** macOS-primary (AGENTS.md); TDD (rule 10) — each WI names its RED test
  first; files < ~300 lines; user-facing strings via `t()`/`t!()`; user-visible changes
  update `website/guide/terminal.md` (rule 21); every phase ends `pnpm check:all` **and**
  `cargo test` green and is independently shippable.
- **Non-goals (this plan):** splits / >5 sessions; sticky scroll; `@xterm/addon-image`;
  `@xterm/addon-ligatures`; OSC 9;4 progress; OSC 133 `B`; `PtySize` pixel dims; a
  blocking `vmark --wait` editor protocol (tracked, see D1); terminal profiles (F5);
  **any change to `setupImeCompositionGate.ts` or the input path**.

## Constraints & Dependencies

- **Runtime/toolchain:** Tauri v2, React 19, `@xterm/xterm` 6.0.0, portable-pty (Rust),
  Vitest v4, `cargo test`.
- **New npm dependencies — pre-verified (rule 60 §4):**

  | Package | Version | Published | Verdict |
  |---|---|---|---|
  | `@xterm/addon-clipboard` | `0.2.0` | 2025-12-22T13:50:21Z | Same release batch as `@xterm/xterm@6.0.0` (13:50:12Z) and every addon already pinned (`fit@0.11.0` 13:50:25Z, `search@0.16.0` 13:50:39Z). Stable `latest`, xterm-6 line. |
  | `@xterm/addon-serialize` | `0.14.0` | 2025-12-22T13:50:43Z | Same batch. Stable `latest`, xterm-6 line. |

  The low version numbers are historical (these addons never rev'd in lockstep), **not**
  a staleness signal — verified by publish timestamp, not by version arithmetic. Neither
  requires the `beta` channel. Both are xtermjs-org first-party.
- **Verified upstream APIs** (fetched from `xtermjs/xterm.js@master` typings, 2026-07-27):
  - `SearchAddon`: `findNext(term, opts?)`, `findPrevious(term, opts?)`,
    `ISearchOptions { regex?, wholeWord?, caseSensitive?, incremental?, decorations? }`,
    `onDidChangeResults: IEvent<{ resultIndex: number; resultCount: number }>`
    (`resultIndex` is `-1` when the match threshold is exceeded — **must** be handled).
  - `ClipboardAddon`: `constructor(base64?: IBase64, provider?: IClipboardProvider)`;
    `IClipboardProvider { readText(selection): string|Promise<string>;
    writeText(selection, text): void|Promise<void> }`; handles **OSC 52**. The default
    `BrowserClipboardProvider` routes to `navigator.clipboard` — VMark must supply its
    own provider (see D5).
- **OS/platform:** macOS primary. bash work (T11) is Unix-only. Windows must not regress:
  it currently gets `get_default_shell → %COMSPEC%` and no integration; that stays true.
- **Env/secrets:** none new.
- **Feature flags:** T11 rides the existing `settings.terminal.shellIntegration` toggle.
  T13 gets its own `settings.terminal.osc52Clipboard` (default **on**, write-only — see D5).

## Current Behavior Inventory

- **Entry points:** `TerminalPanel.tsx` → `useTerminalSessions.ts` →
  `useTerminalShellLifecycle.ts` → `spawnPty.ts` → `lib/pty.ts` → Rust `pty.rs` /
  `pty/session.rs` / `shell_integration.rs` / `shell_env.rs`.
- **Spawn contract today:** `spawn(shell, [], { cols, rows, cwd, env })` — **args is
  always empty**; `buildShellEnv()` returns env only. bash integration needs `--rcfile`,
  i.e. an arg. This is the contract change in §API below.
- **Settings:** `settingsStore.terminal` (17 keys), clamped in `clamp.ts`
  (`terminal.fontSize: [8, 32]`), surfaced by `TerminalSettings.tsx` +
  `terminalSettingsHelpers.ts`.
- **Known invariants (must not regress):** point-to-point per-session `Channel`;
  per-PID exit events; per-window `sessionsRef`; explicit `kill_all` on the quit path;
  watermark flow control; **Channel-Ownership IME (one writer per keystroke)**.

## Findings

### Bugs

| ID | Finding | Evidence | Sev |
|---|---|---|---|
| **T1** | `EDITOR=vmark` is set unconditionally and cannot work in either state | `spawnPty.ts:206` sets it always, on every OS. The shim is opt-in, macOS-only, admin-gated (`cli_install/mod.rs:16` `CLI_PATH=/usr/local/bin/vmark`). Default = not installed → `git commit` fails `vmark: command not found`. Windows/Linux → shim cannot exist. **Even installed it fails**: `SCRIPT_CONTENT` (`cli_install/mod.rs:23`) is `open -b app.vmark "$@"` with no `-W`, so `open` returns immediately and git aborts "empty commit message". `cli_install_status()` is **not** a registered Tauri command (only `dialog::run_install_toggle` from `menu_events_dispatch.rs:220`), so the frontend cannot even ask. | P0 |
| **T2** | Panel Size dropdown's top 3 options are dead | `terminalSettingsHelpers.ts:19-21` offers 60/70/80%; `ratioToPixels` (`useTerminalPosition.ts:86`) applies `TERMINAL_MAX_RATIO = 0.5` (`uiStore.ts:59`). 80% renders identically to 50%, while `snapToOption` (`TerminalSettings.tsx:128`) keeps displaying "80%". `pixelsToRatio` (`useTerminalPosition.ts:96`) also clamps to 0.5, so a drag silently rewrites the stored value. | P1 |
| **T3** | Font zoom desyncs the Settings dropdown and can silently reset the size | `TERMINAL_FONT_SIZE_STEP = 2` from default 13 (`terminalKeyHandler.ts:55-56`) → first `Mod +` lands on **15**, absent from `fontSizeOptions` (10,11,12,13,14,16,18,20,24). `Select` is a native `<select>` (`inputs.tsx:60`) so an unlisted `value` displays the **first** option ("10px"); touching the control then writes 10. Store clamp is `[8,32]`, dropdown tops at 24. | P2 |
| **T4** | A new `AudioContext` per bell | `terminalBell.ts:56` constructs `new Ctx()` on every BEL and closes it in `onended`. WebKit caps concurrent contexts; a burst exhausts the pool, the constructor throws, and the `catch` at :77 silently swallows it — audible bell goes dead with no signal. | P2 |
| **T5** | Session rename is implemented but unreachable | `terminalSlice.ts:125` `terminalRenameSession` sets `isUserRenamed`; `TerminalTabBar.tsx:93` honours "user name beats program title" (decision D4 of the 2026-06-01 plan). **No caller exists** outside tests — verified by grep. The precedence branch is dead in production. | P2 |
| **T6** | Relative file links never resolve when cwd is `/` | `fileLinkProvider.ts:69` containment check is `resolved.startsWith(base + '/')`; with `base === "/"` that requires a leading `//` and always fails. | P3 |

### Documentation that contradicts the code

| ID | `website/guide/terminal.md` | Reality | Sev |
|---|---|---|---|
| **T7** | line 87: `TERM_PROGRAM` = `vmark` | `spawnPty.ts:205` sets `WezTerm` (deliberate, ADR-006) | P1 |
| **T8** | lines 100–116: an entire **Pause / Resume** section — "right-click the session tab → Pause", dimmed tab indicator, `SIGSTOP`, "hidden on Windows builds" | **No implementation.** No tab context menu exists (`onContextMenu` appears once, on the terminal body, `TerminalPanel.tsx:196`). No `SIGSTOP` anywhere in `src/` or `src-tauri/src/`. `pty_pause`/`pty_resume` are called **only** by the internal watermark flow control (`lib/pty.ts:251,259`). | P1 |
| **T9** | line 127: Mac Option as Meta default **Off** | `defaults.ts:127` — `macOptionIsMeta: true` | P2 |

### i18n

| ID | Finding | Sev |
|---|---|---|
| **T10** | 6 terminal settings strings are verbatim English in **all 9** non-English locales: `terminal.shellIntegration.label`/`.description`, `terminal.scrollback.label`/`.description`, `terminal.screenReaderMode.label`/`.description`. Plus `terminal.contrast.aa`/`.aaa` (9 locales) and `terminal.maxSessions` (fr). Verified by comparing every `terminal.*` key across `src/locales/*/{settings,statusbar}.json`. These are exactly the strings the 2026-06-01 plan's Phase 5 deferred. | P1 |

### Gaps

| ID | Finding | Sev |
|---|---|---|
| **T11** | Shell integration is zsh-only — `shell_integration.rs:44` returns `None` for anything else. bash/fish users get no prompt nav, no exit decorations, no live cwd, and no explanation. | P2 |
| **T12** | Search is bare: `findNext(query)` with no `ISearchOptions` (`TerminalSearchBar.tsx:55,61`). No match count, no case/word/regex toggles, and **no "no matches" feedback at all**. | P2 |
| **T13** | No OSC 52 — `@xterm/addon-clipboard` not installed. Copy from `ssh`/`tmux`/remote editors doesn't reach the host clipboard. | P3 |
| **T14** | No scrollback/session persistence — `@xterm/addon-serialize` not installed; hot-exit stores only `terminal_visible` + `terminal_height` (`hot_exit/session.rs:178-180`). **Deferred**, see D7. | P3 |

### Features considered

| ID | Feature | Disposition |
|---|---|---|
| **F1** | Run a fenced shell code block in the terminal | **Phase 4.** Highest leverage: VMark is a markdown editor full of `bash` fences; nothing like it exists (grep for `runInTerminal` → 0 hits). |
| **F2** | "Open Terminal Here" in the file-explorer context menu | **Phase 4.** |
| **F3** | Tab rename UI (double-click) | **Phase 4** — this is what closes T5. |
| **F4** | Command context menu on OSC 133 marks (re-run / copy command / copy output) | **Phase 4**, smallest viable slice only (see D8). |
| **F5** | Terminal profiles | **Deferred** — own plan. Needs a settings-schema migration. |
| **F6** | Maximize-panel toggle | **Phase 4** — the honest answer to "I wanted 80%" once T2 trims the dropdown (D2). |

## Decision Log

- **D1 — What to do about `EDITOR` (T1).**
  - Options: (a) stop setting `EDITOR` at all; (b) set it only when
    `cli_install_status().installed`; (c) build a real blocking `vmark --wait` protocol.
  - **Decision: (a) now; (c) tracked as its own future plan.**
  - Rationale: (b) is **not a fix** — it only converts "command not found" into "editor
    exits instantly, empty commit message", because `open` without `-W` does not block.
    Naively adding `-W` is also wrong: `open -W` waits for the *application* to terminate,
    so `git commit` would hang until VMark itself quits. Correct `--wait` semantics need
    an IPC handshake (CLI → running instance → signal on tab close), which is VS Code's
    `code --wait` design and is a plan-sized piece of work. Meanwhile T1 is a live P0
    breaking `git commit` for every user who never installed the shim — which is the
    default. The smallest correct change is to stop lying.
  - Rejected: (b) trades one broken behavior for a subtler broken behavior;
    (c) correct but out of scope for a bug fix. **See Q1** — this removes an advertised
    capability, so xiaolai decides.
- **D2 — Panel-size cap (T2).**
  - Options: (a) trim the dropdown to ≤50%; (b) raise `TERMINAL_MAX_RATIO` to 0.8;
    (c) make the cap dynamic on the editor's minimum width.
  - **Decision: (a), plus F6 (maximize toggle) in Phase 4.**
  - Rationale: the 50% cap is deliberate — it guarantees the editor is never squeezed
    out, and it is enforced in three independent places (`ratioToPixels`, `pixelsToRatio`,
    `useTerminalResize.ts:100`). The *dropdown* is what drifted. Raising the cap to 0.8
    would leave the editor 20% of a horizontal split, below any sane minimum. The real
    need behind "I want 80%" is temporary, not persistent — that is a maximize toggle,
    not a persisted ratio.
  - Rejected: (b) breaks the editor-minimum invariant; (c) complexity without a
    demonstrated need.
- **D3 — Font-size dropdown vs. free zoom (T3).**
  - Options: (a) inject the current value as an extra option when it is not in the list;
    (b) snap `Mod +/-` to the option list; (c) replace the dropdown with a number input.
  - **Decision: (a).**
  - Rationale: this exact pattern already exists **in the same component** — `shellOptions`
    (`TerminalSettings.tsx:72-79`) appends the persisted-but-undetected shell as a
    synthetic option. Following the local precedent keeps free zooming (which is the
    point of `Mod +/-`) and loses nothing.
  - Rejected: (b) makes zoom lumpy and surprising; (c) a fourth input primitive is
    explicitly gated by `components.tsx`'s "ASK before adding".
- **D4 — Bell audio (T4).** One module-scoped, lazily-created `AudioContext`, reused and
  never closed; `resume()` when `state === "suspended"` (autoplay policy). Rationale:
  contexts are a capped process resource; one is enough for a 160 ms beep.
- **D5 — OSC 52 policy (T13). Write-only.**
  - The `IClipboardProvider` VMark supplies routes `writeText` through
    `@tauri-apps/plugin-clipboard-manager` (the plugin every other VMark clipboard path
    already uses — **not** `navigator.clipboard`, which the default
    `BrowserClipboardProvider` assumes), and `readText` returns `""` unconditionally.
  - Rationale: OSC 52 **read** is a clipboard-exfiltration channel available to anything
    that can print bytes to the terminal — including `cat`-ing a hostile file. iTerm2 and
    VS Code both deny read by default. Denying it is a security decision and gets its own
    test, not a comment.
- **D6 — bash integration mechanism (T11).**
  - Options: (a) `bash --rcfile <vmark-rc>`; (b) inject `BASH_ENV`; (c) `PROMPT_COMMAND`
    env injection only.
  - **Decision: (a) `--rcfile`, with the generated rc sourcing the user's real
    `~/.bashrc` first** — mirroring `vmark.zsh`'s non-destructive contract.
  - Rationale: `BASH_ENV` applies to non-interactive shells only — wrong hook.
    `PROMPT_COMMAND` alone cannot mark `preexec` (no bash equivalent), so exit-status
    decorations would be unreliable. `--rcfile` is what VS Code uses.
  - Consequence: **`prepare_shell_integration` must be able to return spawn *args*, not
    just env.** That is the API change in §API. Fish is **not** in this plan (Q3).
- **D7 — Scrollback persistence (T14) is deferred.** `@xterm/addon-serialize` is added in
  Phase 3 **only** as the enabler for a future plan and is **not wired to hot-exit here**.
  Rationale: persisting scrollback touches the `hot_exit` session schema (a versioned,
  migration-bearing contract), needs a size cap policy, and raises a real
  secrets-at-rest question (an API key echoed into a terminal would land on disk). That
  deserves its own plan, not a WI at the tail of this one. **See Q4** — if the answer is
  "don't add the dep yet", WI-3.5 drops with no other change.
- **D8 — F4 scope.** Ship **"Copy Command Output"** only (the OSC 133 `A`→next-`A` range
  is already reconstructible from existing marks). "Re-run" needs the command *text*,
  which requires OSC 133 `B` (prompt-end) to delimit — out of scope per §Non-goals.
- **D9 — Phasing.** Strictly correctness → truth → gaps → features. Phases 1 and 2 are
  small, low-risk, and independently shippable; a reader should be able to stop after
  Phase 2 and still have a strictly better terminal.

## Open Questions

- **Q1 — Drop `EDITOR=vmark` entirely (D1)?** Why it matters: it is documented at
  `website/guide/terminal.md:88` as a feature, and removing it is user-visible.
  Who decides: **xiaolai**. Default if unresolved: **drop it** (a broken advertised
  feature is worse than an absent one), and file the `vmark --wait` plan.
- **Q2 — Delete or build Pause/Resume (T8)?** The Rust commands already exist; the
  missing piece is a tab context menu plus a `paused` session flag. Who decides:
  **xiaolai**. Default if unresolved: **delete the docs section in Phase 2**, and add
  "Pause/Resume UI" to the deferred list — docs must not describe vapor, but building it
  is a feature decision, not a bug fix.
- **Q3 — fish integration in scope (D6)?** Default if unresolved: **no** — bash only in
  Phase 3; fish tracked as a follow-up WI. (fish needs `XDG_DATA_DIRS` +
  `vendor_conf.d`, a different mechanism from bash's `--rcfile`, so it is not a cheap rider.)
- **Q4 — Add `@xterm/addon-serialize` now (D7)?** Default if unresolved: **yes, add but
  do not wire** — it is 1 dep, first-party, and having it in the tree lets the
  persistence plan start with a spike instead of a dependency debate. If xiaolai prefers
  zero unused deps, WI-3.5 is deleted and nothing else changes.
- **Q5 — Search-options persistence (T12)?** Should case/word/regex toggles persist
  across sessions, or reset each time the bar opens? Default if unresolved: **reset**
  (matches the editor's FindBar; avoids a settings-schema change).

## API / Contract Changes

1. **`prepare_shell_integration` return shape (D6, WI-3.3).** Today:
   `Result<Option<BTreeMap<String,String>>, String>` (env only). After:
   `Result<Option<ShellIntegration>, String>` where
   `ShellIntegration { env: BTreeMap<String,String>, args: Vec<String> }`.
   zsh returns `args: []` — **byte-identical behavior**. Frontend `buildShellEnv` becomes
   `buildShellSpawnConfig(baseEnv, shell, enabled) -> { env, args }`, and `spawnPty`
   passes `args` to `spawn(shell, args, …)` instead of the hardcoded `[]`. Additive
   for zsh; no persisted state involved; no migration.
2. **New Tauri command `cli_install_status`** — *only if Q1 resolves to "keep EDITOR"*.
   The function exists (`cli_install/mod.rs:77`) but is not in `command_registry.rs`.
   Under the D1 default it is **not** added.
3. **New setting `terminal.osc52Clipboard: boolean`** (default `true`), with its
   `clamp.ts`/`persistGuards.ts` entry and locale keys. Additive; absent = default.

## Observability

- T1: when `EDITOR` is *not* set, log once per session via `terminalLog` with the reason,
  so "why doesn't git open VMark" is answerable from a dev-mode log.
- T4: a bell that cannot play logs once (not per-bell) via `terminalLog`.
- T11: bash integration failure degrades to a plain spawn and logs at `log::warn!` in
  `shell_integration.rs`, mirroring the zsh path.
- T13: an OSC 52 **read** attempt logs via `terminalLog` before returning `""` — a denied
  exfiltration attempt should be visible, not silent.

---

## Work Items

### Phase 0 — Gate scaffolding

#### WI-0.1: Phase-DoD checker script
- **Goal:** `scripts/check-terminal-edge-phase.sh <N>` exists, templated from
  `check-terminal-gaps-phase.sh` (same `assert_grep`/`ok`/`fail` harness, same exit
  codes), with per-phase assertions for Phases 1–4.
- **Acceptance:** `bash scripts/check-terminal-edge-phase.sh 1` exits non-zero before
  Phase 1 lands and 0 after; `… 5` exits 64 (usage).
- **Tests (first):** the script is self-verifying via grep assertions.
- **Touched:** `scripts/check-terminal-edge-phase.sh` (new). **Est:** S.

---

### Phase 1 — Correctness (T1, T2, T3, T4, T6)

#### WI-1.1: Stop setting a broken `EDITOR` (T1, D1)
- **Goal:** `spawnPty.ts` no longer sets `EDITOR` unconditionally. Under the D1 default
  it sets nothing and logs the reason once.
- **Acceptance:** unit test — the env map built by `spawnPty` contains **no** `EDITOR`
  key; `TERM`, `TERM_PROGRAM`, `LC_CTYPE`, `PATH`, `VMARK_WORKSPACE` are unchanged
  (regression guard: the WezTerm impersonation of ADR-006 must survive).
- **Tests (first):** `spawnPty.test.ts` — `does not set EDITOR`, `preserves the WezTerm
  impersonation`.
- **Touched:** `spawnPty.ts` (env map + header "Key decisions" bullet — rule 22),
  `website/guide/terminal.md` (env table).
- **Dependencies:** Q1. **Risks:** removes an advertised capability (mitigated: it never
  worked). **Rollback:** re-add the line. **Est:** S.

#### WI-1.2: Trim the Panel Size options to the enforced cap (T2, D2)
- **Goal:** `panelSizeOptions` stops at 50%; no offered value is silently clamped.
- **Acceptance:** unit test — every `panelSizeOptions` value `v` satisfies
  `ratioToPixels(v, A, min) === Math.round(A * v)` for a representative `A` (i.e. no
  option is capped); a persisted out-of-range ratio (e.g. 0.8 from an older build) still
  renders and `snapToOption` maps it to 50% rather than displaying "80%".
- **Tests (first):** `terminalSettingsHelpers.test.ts` (new) — `no option is silently
  clamped`, `snapToOption maps a legacy over-cap ratio to the cap`.
- **Touched:** `terminalSettingsHelpers.ts`, `website/guide/terminal.md` (settings table).
- **Risks:** a user with a persisted 0.8 sees the dropdown change to 50% — but the panel
  was already 50%, so this is the display catching up to reality. **Est:** S.

#### WI-1.3: Make the font-size dropdown tolerate zoomed values (T3, D3)
- **Goal:** when `terminal.fontSize` is not in `fontSizeOptions`, inject it as a synthetic
  option (mirroring `shellOptions`), so `Select` never displays a value the store doesn't hold.
- **Acceptance:** unit test — with `fontSize: 15`, the rendered `<select>` value is `"15"`
  and an option labelled `15px` exists; with `fontSize: 13` the option list is unchanged
  (no duplicate). Boundary: 8 and 32 (the clamp edges) both render.
- **Tests (first):** `TerminalSettings.test.tsx` — `shows a zoomed font size not in the
  preset list`, `does not duplicate a preset value`.
- **Touched:** `terminalSettingsHelpers.ts` (pure `fontSizeOptionsFor(current)` helper),
  `TerminalSettings.tsx`. **Est:** S.

#### WI-1.4: One shared `AudioContext` for the bell (T4, D4)
- **Goal:** `playTerminalBell` uses a module-scoped lazily-created context, reused across
  bells, `resume()`d when suspended, never closed.
- **Acceptance:** unit test — N rapid `playTerminalBell()` calls construct the
  `AudioContext` **once**; a suspended context is resumed; a throwing constructor is
  swallowed **and logged once**, not per call.
- **Tests (first):** `terminalBell.test.ts` — `reuses a single AudioContext across bells`,
  `resumes a suspended context`, `logs once when audio is unavailable`.
- **Touched:** `terminalBell.ts`. **Est:** S.

#### WI-1.5: Resolve relative links at the filesystem root (T6)
- **Goal:** `resolvePath` containment check handles `base === "/"` (and a trailing-slash
  base generally) without regressing the `..`-traversal guard.
- **Acceptance:** table-driven test — `base="/"` + `src/a.ts` → `/src/a.ts`;
  `base="/"` + `../etc/passwd` → `null` (still blocked); `base="/w"` unchanged;
  `base="/w/"` behaves as `/w`.
- **Tests (first):** `fileLinkProvider.test.ts` — extend the existing resolve table.
- **Touched:** `fileLinkProvider.ts`. **Risks:** the traversal guard is security-relevant
  — the RED test must include the escape cases **before** the fix. **Est:** S.

**Phase 1 DoD:** `check-terminal-edge-phase.sh 1` = 0; `pnpm check:all` green;
`cargo test` green; terminal suite still 35 files green; manual: `git commit` in the
VMark terminal opens the user's real editor.

---

### Phase 2 — Truth: docs + i18n (T7, T8, T9, T10)

#### WI-2.1: Correct the three false doc claims (T7, T9 + T8 per Q2)
- **Goal:** `TERM_PROGRAM` documented as `WezTerm` **with the ADR-006 reason** (so nobody
  "fixes" it back); Option-as-Meta default corrected to **On**; the Pause/Resume section
  removed (Q2 default) and the capability moved to a "Not yet implemented" note.
- **Acceptance:** `check-terminal-edge-phase.sh 2` asserts the doc no longer contains
  `` | `TERM_PROGRAM` | `vmark` | `` nor `SIGSTOP`, and does contain `WezTerm`.
- **Tests (first):** the phase-checker assertions (docs — rule 10 exempts docs from unit tests).
- **Touched:** `website/guide/terminal.md`. **Est:** S.

#### WI-2.2: Add a doc↔default drift guard
- **Goal:** a unit test that fails when a default documented in the settings table
  diverges from `defaults.ts` — so T9 cannot recur.
- **Acceptance:** the test reads `defaults.ts` values for the documented keys
  (`macOptionIsMeta`, `copyOnSelect`, `shellIntegration`, `scrollback`,
  `screenReaderMode`, `bellMode`, `minimumContrastRatio`, `fontSize`, `lineHeight`) and
  asserts each against a table co-located with the test; changing a default without the
  doc row fails.
- **Tests (first):** `src/pages/settings/__tests__/terminalDocDefaults.test.ts` (new).
- **Rationale:** T9 is a *class* (a default drifted from its doc), not an incident.
  Fixing the instance without the guard means doing this again.
- **Touched:** new test file. **Risks:** parsing `website/*.md` in a unit test is brittle
  — assert against the **defaults module**, with the doc table transcribed into the test
  and a comment pointing at the doc. **Est:** M.

#### WI-2.3: Translate the 8 stranded terminal strings ×9 locales (T10)
- **Goal:** `terminal.shellIntegration.label`/`.description`,
  `terminal.scrollback.label`/`.description`, `terminal.screenReaderMode.label`/
  `.description`, `terminal.contrast.aa`/`.aaa` translated in de/es/fr/it/ja/ko/pt-BR/
  zh-CN/zh-TW; plus `terminal.maxSessions` in fr.
- **Acceptance:** a gate test asserting **no** `terminal.*` key in a non-English
  `settings.json`/`statusbar.json` is byte-identical to English, with an explicit
  allow-list for genuine non-translatables (`terminal.group.terminal` where the word is
  "Terminal" in that language, `terminal.cursorStyle.bar/block/underline` — glyph labels,
  `terminal.ariaLabel`). The allow-list is the contract; anything else is drift.
- **Tests (first):** `src/locales/__tests__/terminalI18nCoverage.test.ts` (new) — RED
  against today's tree (it must fail listing the 8 keys).
- **Touched:** 9 × `settings.json`, 1 × `statusbar.json` (fr), new test.
- **Approach:** use the `translate-docs` skill (it already knows the 9-locale layout and
  the flat dot-key convention). **Est:** M.

**Phase 2 DoD:** `check-terminal-edge-phase.sh 2` = 0; `pnpm check:all` green; the i18n
coverage test green; manual: Settings → Terminal reads natively in zh-CN and ja.

---

### Phase 3 — Gaps (T12, T13, T11)

#### WI-3.1: Search match count + no-match feedback (T12)
- **Goal:** wire `searchAddon.onDidChangeResults` to render "`n` / `N`" in the bar, and
  style the input as no-match when `resultCount === 0` with a non-empty query.
- **Acceptance:** unit tests — `resultCount: 0` + non-empty query → no-match state and
  `0/0`-equivalent display; `{resultIndex: 2, resultCount: 17}` → "3 / 17" (1-based);
  **`resultIndex: -1` (threshold exceeded) renders a count without a position, not
  "0 / N"**; empty query → neither state; the listener is disposed on unmount and on
  session switch (the bar is already keyed by `activeSessionId`, `TerminalPanel.tsx:201`).
- **Tests (first):** `TerminalSearchBar.test.tsx` — the five cases above.
- **Touched:** `TerminalSearchBar.tsx`, `TerminalSearchBar.css` (no-match uses
  `--error-color`, rule 31 — no hardcoded red), `statusbar.json` ×10 (result label),
  `website/guide/terminal.md`.
- **Risks:** `resultIndex: -1` is the easy miss — it is in the acceptance list for that
  reason. **Est:** M.

#### WI-3.2: Case / whole-word / regex toggles (T12, Q5)
- **Goal:** three toggle buttons feeding `ISearchOptions` into both `findNext` and
  `findPrevious`; state resets when the bar closes (Q5 default).
- **Acceptance:** unit tests — each toggle reaches `findNext` in the options object;
  an invalid regex (`"["`) with regex on does **not** throw and shows the no-match state;
  toggles reset on close/reopen; toggles are keyboard-reachable with visible focus
  (rule 33) and carry `aria-pressed`.
- **Tests (first):** `TerminalSearchBar.test.tsx`.
- **Touched:** `TerminalSearchBar.tsx` (watch the 300-line gate — extract
  `searchOptions.ts` if needed), CSS, locales ×10, docs. **Est:** M.

#### WI-3.3: `prepare_shell_integration` returns env **and** args (T11, D6)
- **Goal:** the contract change in §API-1. zsh behavior byte-identical.
- **Acceptance:** Rust test — zsh returns `args == []` and the same env map as today
  (assert against the existing `build_zsh_env` tests); an unsupported shell still returns
  `None`. Frontend test — `buildShellSpawnConfig` returns `{env, args}`; integration
  disabled → `args: []` and env is a copy of the base; `spawnPty` forwards `args` to
  `spawn`, and the **fallback** spawn path recomputes both (the existing
  "don't poison the fallback shell" invariant, `spawnPty.ts:253`).
- **Tests (first):** `shell_integration.rs` `#[cfg(test)]`; `terminalSpawnEnv.test.ts`;
  `spawnPty.test.ts` (`forwards integration args`, `fallback recomputes args`).
- **Touched:** `shell_integration.rs`, `terminalSpawnEnv.ts`, `spawnPty.ts`.
- **Risks:** this is the one WI that touches the spawn path — it lands **alone**, ahead
  of WI-3.4, with zsh regression tests as the gate. **Est:** M.

#### WI-3.4: bash shell integration (T11, D6)
- **Goal:** `vmark.bash` embedded via `include_str!`, materialized alongside the zsh rc,
  returned as `args: ["--rcfile", <path>]`. Non-destructive: sources `~/.bashrc` (and
  `~/.bash_profile` semantics documented as out of scope, matching the zsh rc's
  `.zprofile` exclusion) **before** installing hooks. Emits OSC 133 `A`/`C`/`D` and OSC 7
  via `PROMPT_COMMAND` + a `DEBUG`-trap preexec, guarded so it composes with an existing
  `PROMPT_COMMAND`/`DEBUG` trap rather than replacing it.
- **Acceptance:** Rust tests mirroring the zsh set — the embedded script contains
  `133;A`/`133;C`/`133;D`, sources `.bashrc`, and does not clobber a pre-existing
  `PROMPT_COMMAND`; `prepare_shell_integration("/bin/bash")` returns the `--rcfile` arg
  pointing at the written file; the atomic-write concurrency test extends to the bash rc.
- **Tests (first):** `shell_integration.rs` `#[cfg(test)]` —
  `bash_script_has_the_osc_marks`, `bash_env_returns_rcfile_arg`,
  `bash_script_preserves_existing_prompt_command`.
- **Touched:** `src-tauri/resources/shell-integration/vmark.bash` (new),
  `shell_integration.rs`, `website/guide/terminal.md`, `settings.json` ×10
  (the shellIntegration description says "(zsh)" — must become "(zsh, bash)").
- **Dependencies:** WI-3.3. **Risks:** bash's lack of a native `preexec` makes the
  `DEBUG` trap the weak point; a Phase-0-style manual check with `bash-preexec` installed
  is in the Manual Checklist. **Est:** L.

#### WI-3.5: OSC 52 clipboard, write-only (T13, D5)
- **Goal:** add `@xterm/addon-clipboard`, load it in `createTerminalInstance` behind
  `settings.terminal.osc52Clipboard`, with a VMark `IClipboardProvider`:
  `writeText` → `@tauri-apps/plugin-clipboard-manager`; `readText` → log + return `""`.
- **Acceptance:** unit tests — a write-selection call reaches the Tauri plugin;
  **a read call resolves to `""` and never touches the plugin** (the security assertion);
  the addon is absent when the setting is off; a plugin rejection is caught via
  `clipboardWarn` and does not propagate into the terminal data path.
- **Tests (first):** `setupOsc52.test.ts` (new) — the four cases, read-denial first.
- **Touched:** `package.json`, new `setupOsc52.ts`, `createTerminalInstance.ts`,
  `settingsStore/defaults.ts` + `clamp.ts`/`persistGuards.ts`, `TerminalSettings.tsx`,
  locales ×10, `website/guide/terminal.md`.
- **Risks:** new dependency (pre-verified, §Constraints); a security-shaped default.
  **Est:** M.

#### WI-3.6: Add `@xterm/addon-serialize` unwired (T14, D7, Q4)
- **Goal:** dependency added, **not** loaded — the enabler for the future persistence plan.
- **Acceptance:** `check-new-deps.sh` green; `knip` does not flag it (add to the ignore
  list with a comment naming the follow-up plan, or **drop this WI** if Q4 says no).
- **Risks:** an unused dependency is a liability (AGENTS.md). This WI is the most likely
  Codex-review casualty and is written to be deletable in one commit. **Est:** S.

**Phase 3 DoD:** `check-terminal-edge-phase.sh 3` = 0; `pnpm check:all` + `cargo test`
green; manual: search shows "3 / 17" and reddens on no-match; a bash session gets prompt
nav + exit decorations; `printf '\e]52;c;%s\a' "$(printf hi | base64)"` puts `hi` on the
clipboard and a read request returns nothing.

---

### Phase 4 — Features (F3/T5, F2, F1, F4, F6)

#### WI-4.1: Tab rename UI (F3 — closes T5)
- **Goal:** double-click a session tab → inline rename; Enter commits via
  `terminalRenameSession`, Escape cancels. Empty/whitespace-only input cancels.
- **Acceptance:** tests — double-click enters edit mode; Enter calls
  `terminalRenameSession` and the tab stops following the program title (the D4
  precedence, finally exercised end-to-end); Escape restores; empty input is rejected;
  the input is IME-safe (`isImeKeyEvent` guard — a CJK commit must not submit).
- **Touched:** `TerminalTabBar.tsx` (+ CSS), locales ×10, docs. **Est:** M.

#### WI-4.2: "Open Terminal Here" (F2)
- **Goal:** file-explorer context-menu item on a directory → create a session cd'd there.
- **Acceptance:** tests — the item appears for directories and not for files;
  activating it creates a session whose spawn cwd is that directory; at
  `MAX_TERMINAL_SESSIONS` it is disabled with the existing `terminal.maxSessions` tooltip;
  it makes the panel visible if hidden.
- **Risks:** `startShell`'s sibling-cwd inheritance (`useTerminalShellLifecycle.ts:107-116`)
  would **override** the requested cwd — an explicit cwd must win over inheritance.
  That is an acceptance case, not a footnote. **Est:** M.

#### WI-4.3: Run a fenced code block in the terminal (F1)
- **Goal:** shell-language fences (`bash`/`sh`/`zsh`/`shell`/`console`) get a run action
  that writes the block to the active session (creating one if none) and reveals the panel.
- **Acceptance:** tests — the action appears only for shell-ish `info` strings;
  the written payload goes through `term.paste()` so bracketed paste applies (**it must
  not auto-execute** — the G2 invariant of the 2026-06-01 plan); a `console` block strips
  leading `$ ` prompts; a multi-line block is written as one paste, not N writes;
  no session → one is created first.
- **Risks:** this is the one feature that lets document content reach a shell. It writes
  into the input line and **never** appends a newline — the user presses Enter. That is
  the security boundary and gets an explicit test. **Est:** L.

#### WI-4.4: "Copy Command Output" on OSC 133 marks (F4, D8)
- **Goal:** right-click inside the terminal → when the click lands within a command's
  range, offer "Copy Command Output" (the buffer between this mark and the next).
- **Acceptance:** tests — the item is hidden without shell integration (no marks);
  the copied range excludes the prompt line and stops at the next mark; the last (open)
  command copies to the end of the buffer.
- **Touched:** `setupOsc.ts` (range helper — pure, unit-testable), `TerminalContextMenu.tsx`.
  **Est:** M.

#### WI-4.5: Maximize-panel toggle (F6, D2)
- **Goal:** double-click the resize handle toggles the panel between its stored ratio and
  the cap; a second double-click restores. Not persisted.
- **Acceptance:** tests — toggle sets the dimension to the cap and back to the stored
  ratio; the stored `panelRatio` is **not** rewritten by the toggle; it refits the
  terminal and resizes the PTY (via `fitAndResizePty`).
- **Est:** M.

**Phase 4 DoD:** `check-terminal-edge-phase.sh 4` = 0; `pnpm check:all` + `cargo test`
green; live Tauri-MCP pass on the Manual Checklist items for Phase 4.

---

### Phase 5 — Deferred (tracked, NOT scheduled)

> `@xterm/addon-serialize` is already in the tree, pinned and unwired (WI-3.6).
> Its knip exemption and the reason for it are pinned by
> `src/components/Terminal/__tests__/serializeAddonDependency.test.ts`, which
> fails the moment anything imports the addon — at which point that file and
> the knip entry should both be deleted.


Scrollback/session persistence (T14 — own plan, needs a hot-exit schema migration and a
secrets-at-rest policy) · `vmark --wait` editor protocol (D1/Q1) · Pause/Resume UI
(T8/Q2) · fish integration (Q3) · terminal profiles (F5) · OSC 133 `B` + "Re-run
command" (D8) · splits / >5 sessions · sticky scroll · `@xterm/addon-image` ·
`@xterm/addon-ligatures` · OSC 9;4 progress.

## Audit history (post-implementation, 3 rounds)

Two of the round-1 findings were **user-visible defects in shipped-looking
code**, both confirmed empirically before being fixed:

| # | Where | Defect | Why the original tests missed it |
|---|---|---|---|
| 19 | `vmark.bash` | With a user `PROMPT_COMMAND`, their prompt hook tripped the `DEBUG` trap first and consumed the single `133;C`, so the user's **actual command got no pre-exec mark** — every exit-status decoration attached to the wrong line. | The Rust tests sourced the script non-interactively and never ran a real prompt cycle. Now two `-i` tests do. |
| 3 | `runInTerminal.ts` | The "never auto-executes" claim was **conditional on bracketed-paste mode**: `term.paste()` rewrites `\n`→`\r`, and with the mode off a multi-line block runs itself on arrival. | The tests asserted the payload's shape, not the terminal state it would land in. |

Round 2 was self-review of the round-1 fixes, and found that **fixing #3 broke
the common path**: a session created a moment ago has bracketed paste off
because its shell is still starting, so the new refusal rejected every
multi-line block sent to a fresh terminal. Delivery now waits within the retry
budget and only then refuses. Round 2 also found that the rewritten
`vmark.bash` broke outright under `set -u` in a user's rc (`unbound variable`
at every prompt) — reproduced on bash 5.3 and macOS's bash 3.2, fixed, and
covered by two more interactive tests.

Round 3 closed the 4 PARTIAL + 1 NOT FIXED verdicts: the unreachable
`no-session` branch became unrepresentable (`reuseOrCreateTerminalSession()`
returns a non-nullable `string`; only the genuinely-cap-limited
`createTerminalSessionAt()` is nullable), the context-menu action id is a typed
union end to end, decoration cleanup covers legacy addons, C1 controls are
rejected in session names, and maximize no longer double-schedules `fit()`.

### Round 4 — the six pre-existing findings

Initially deferred as out of scope (pre-existing, not introduced by this plan),
then fixed on request. Each is a root-cause fix, not a patch:

| Finding | Root cause | Fix |
|---|---|---|
| `createTerminalInstance` not exception-safe | Resources acquired one at a time with no unwind, so a throw leaked the container **and** the xterm instance — and the success-path `dispose()` was a second, hand-maintained list free to drift from the acquisitions | `resourceStack.ts`: each release is registered beside its acquisition, and `dispose` **is** the rollback, so the two paths cannot diverge |
| Workspace rail missing from available width | Two independent derivations of "chrome left of the editor"; the terminal's forgot the 30 px rail, so a rail-enabled window sized the panel and its 50 % cap against 30 px it did not have | `shell/shellChrome.ts`: one `shellSideWidth()` used by both `App.tsx` and the terminal; `getAvailableDimension` takes the combined number instead of re-adding its own |
| Restart during an in-flight spawn was a no-op | No PTY existed to kill yet, and `startShell` returned immediately on the `shellSpawning` re-entrance guard — the restart was swallowed | `restartActiveSession` bumps `spawnGen` and clears the flag; the in-flight attempt checks its generation on arrival and kills its own orphan PTY |
| `getTabDisplay` parsed `Terminal N` | Display identity derived from a localized string — translating the label collapsed every tab to the same glyph | `TerminalSession.ordinal` carries the identity; the glyph is that ordinal, or the first **grapheme** (`Intl.Segmenter`, so flags and combining clusters survive) of a renamed or program-set title |
| Blocking work on an async worker | `prepare_shell_integration` did synchronous FS work plus a multi-second login-shell probe directly in an async command | Body moved into `spawn_blocking` |
| `FileExplorer`'s 100 ms edit timer | A fixed timer *guessed* when the created node would exist — too short on a slow watcher, and able to fire after unmount or a workspace switch | A `pendingEditPath` plus an effect that starts the rename when the node actually appears; cleared on root change |

Every fix carries tests, and for the three behavioral ones (rollback, restart,
tab glyph) the tests were **checked to fail against the old behavior** rather
than merely passing against the new.

## Finding → WI map

| Finding | WI(s) |
|---|---|
| T1 (EDITOR, P0) | WI-1.1 |
| T2 (panel size, P1) | WI-1.2 |
| T3 (font zoom, P2) | WI-1.3 |
| T4 (AudioContext, P2) | WI-1.4 |
| T5 (rename dead code, P2) | WI-4.1 |
| T6 (root-cwd links, P3) | WI-1.5 |
| T7/T9 (doc drift, P1/P2) | WI-2.1, WI-2.2 |
| T8 (Pause/Resume vapor, P1) | WI-2.1 (per Q2) |
| T10 (i18n, P1) | WI-2.3 |
| T11 (bash integration, P2) | WI-3.3, WI-3.4 |
| T12 (search, P2) | WI-3.1, WI-3.2 |
| T13 (OSC 52, P3) | WI-3.5 |
| T14 (persistence, P3) | WI-3.6 (dep only) → Phase 5 |
| F1/F2/F3/F4/F6 | WI-4.3 / 4.2 / 4.1 / 4.4 / 4.5 |
| F5 | Phase 5 |

## Testing Procedures

- **Fast (per WI):** `pnpm test src/components/Terminal` (or the single file);
  `cargo test --manifest-path src-tauri/Cargo.toml shell_integration pty shell_env`.
- **Full gate (per phase):** `pnpm check:all` **and**
  `cargo test --manifest-path src-tauri/Cargo.toml`.
- **Phase DoD:** `bash scripts/check-terminal-edge-phase.sh <N>` exits 0.
- **Live (Tauri MCP per AGENTS.md — never Chrome DevTools; needs `pnpm tauri:dev`):**
  the Manual Checklist below. Non-AI terminal UI → `mcp__tauri__*`.
- **When:** fast on every change; full gate before each phase commit; live before marking
  a phase complete.

## Rollout Plan

- **Feature flags:** T11 rides `terminal.shellIntegration` (existing kill switch);
  T13 gets `terminal.osc52Clipboard` (new, default on). Phases 1/2 have no flag — they
  are corrections, and reverting them would restore a broken state.
- **Staging:** Phases 1 and 2 are small and independently shippable; ship them first and
  early. Phase 3 lands WI-3.3 alone (spawn-path contract change) before WI-3.4.
- **Revert:** per-WI rollback noted above; `git revert` the phase commit.

## Plan → Verify Handoff

- **Evidence per WI:** the named RED test(s) green; `check:all` / `cargo test` output;
  for T11/T12/T13 a Tauri-MCP screenshot or log; for T10 a screenshot of Settings →
  Terminal in zh-CN.
- **Fixtures:** WI-3.4 needs a bash rc fixture with a pre-existing `PROMPT_COMMAND` and a
  pre-existing `DEBUG` trap. WI-3.5 needs an OSC 52 byte fixture (`\e]52;c;<b64>\a`) and a
  read-request fixture (`\e]52;c;?\a`). WI-4.4 needs an OSC 133 `A`/`C`/`D` sequence
  spanning three commands.

## Manual Test Checklist

- [ ] `git commit` (no `-m`) in the VMark terminal opens the user's real editor (T1).
- [ ] Settings → Terminal → Panel Size lists nothing above 50%, and every listed value
      visibly changes the panel (T2).
- [ ] `Mod +` twice, then open Settings → the font-size dropdown shows the zoomed value,
      not "10px"; closing Settings does not change the size (T3).
- [ ] Bell mode "Audible" + a script printing 20 BELs in a burst → still audible at the
      end (T4).
- [ ] `cd /` then `ls` → a relative path in output is a working link (T6).
- [ ] Settings → Terminal in zh-CN and ja: no English strings (T10).
- [ ] Search "e" in a long buffer → "3 / 17" updates on Enter; a nonsense query reddens
      the input (T12).
- [ ] With `$SHELL=/bin/bash` and integration on: `Cmd + ↑` jumps prompts; a failing
      command shows a red gutter bar; `cd` updates relative link resolution (T11).
- [ ] From an `ssh` session: `printf '\e]52;c;%s\a' "$(printf hi | base64)"` → clipboard
      is `hi`; a read request (`\e]52;c;?\a`) returns nothing (T13).
- [ ] Custom `$ZDOTDIR` zsh user: integration still loads their config (Phase-1
      regression guard for the 2026-06-01 G1 fix).
- [ ] Rapid open/close of 5 sessions → `ps` shows no `<defunct>` children (regression
      guard for WI-4.4 of the prior plan).
