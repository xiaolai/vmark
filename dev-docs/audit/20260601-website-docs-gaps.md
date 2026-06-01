# Website Docs Gaps — catching up to the > 0.8.0 changes

**Date:** 2026-06-01
**Status:** Mostly addressed (2026-06-01) — only the blog post (#1) remains.

> **Resolution.** Gaps #2–#5 are closed:
> - **#3** (settings.md Shell Integration / Option as Meta) and **#4** (terminal.md
>   bell / background-activity) were closed by the settings-dialog gap remediation,
>   which documented both while adding the terminal Accessibility section.
> - **#2** (shortcuts.md terminal Prompt Navigation `Mod + ↑` / `Mod + ↓`) — added,
>   with a shell-integration caveat.
> - **#5** (terminal.md OSC 8 hyperlinks + in-page prompt-nav row) — added.
>
> **#1 (the 0.8 terminal blog post) is still open** — it needs authoring and a
> shipped-vs-unreleased framing decision, so it's left for an explicit go-ahead.
**Scope:** `website/guide/**` + `website/blog/**` vs everything shipped since `v0.8.0`.
**Method:** `git log v0.8.0..HEAD` → user-facing surface → cross-checked against the
rule `21-website-docs.md` file mapping and the live doc contents.

## 1. What changed since v0.8.0 (the surface to document)

Two terminal efforts dominate; everything else is bug-fixes or internal:

- **Terminal "industrial-best"** — *shipped in 0.8.1, already released:* binary
  `Channel` PTY transport, OSC 7 cwd tracking, OSC 133 shell integration (zsh:
  prompt navigation, exit-status decorations, command boundaries), file-link
  `:line:col` jump, OSC 8 hyperlinks, bell/background-activity indicator, removed
  the dead `SerializeAddon`.
- **Terminal gap-remediation** — *on `main`, unreleased:* custom `$ZDOTDIR`
  preservation (G1), paste via `term.paste` so multiline paste can't auto-execute
  (G2), screen-reader mode (G3), program-title tabs (G4), live font-family sync
  (G6), configurable scrollback (G7), reader-error logging (G8), plus audit
  hardening (OSC 7 percent-encoding, title sanitize, scrollback clamp).
- **Bug fixes (no docs needed):** `#981` multi-caret Escape, `#974`/`#980` PTY FD
  leak. **Internal (no docs):** dead-code removal, `knip` config.

So the docs work is **almost entirely terminal** + one missing release note.

## 2. Gaps (prioritized)

| # | Pri | Doc | Gap | Action |
|---|---|---|---|---|
| 1 | 🔴 High | `website/blog/` | **No release/launch note for the 0.8 terminal overhaul.** Only `2026-05-multi-format-launch.md` exists. A major feature shipped (and more is on `main`) with zero announcement. | New `website/blog/2026-06-terminal-launch.md` (or similar) + entry in `website/blog/index.md` (rule 21). Covers the released 0.8.1 set; can frame the unreleased pieces as "coming in 0.8.x". |
| 2 | 🔴 High | `website/guide/shortcuts.md` | Terminal section (≈L311) lists Toggle/Copy/Paste/Clear/Search but **not Prompt Navigation `Cmd + ↑` / `Cmd + ↓`** (OSC 133 jump to prev/next prompt). `terminal.md` documents it; the canonical shortcuts reference doesn't — a rule-41 sync gap. | Add the two rows to the Terminal table. |
| 3 | 🟠 Med | `website/guide/settings.md` | Terminal table (≈L321) has Scrollback + Screen Reader Mode but is **missing the existing Shell Integration and Mac Option as Meta toggles** (both are in-app and in `terminal.md`). | Add the two rows. |
| 4 | 🟠 Med | `website/guide/terminal.md` | The **bell / background-activity indicator** (a non-focused session flags activity on its tab via `onBell` → `hasActivity`) is undocumented. | Add a short note (e.g. under Sessions). |
| 5 | 🟢 Low | `website/guide/terminal.md` | "Clickable Links" only says "Web URLs"; doesn't mention **OSC 8 explicit hyperlinks** (`ls --hyperlink`, `gh`, gcc). In-page Keyboard Shortcuts table also omits prompt nav (consistency with #2). | Mention OSC 8; add prompt-nav row. |

## 3. Already covered (verified — no action)

`terminal.md` already documents: custom `$ZDOTDIR` handling, program-title tabs,
Pause/Resume, shell integration (prompt nav + exit-status decorations + live cwd),
file-link `:line:col`, Persistence, and the Scrollback / Screen-Reader settings.
`settings.md` has Scrollback + Screen Reader Mode. These landed during the terminal
work itself (rule 21 in-flight updates).

## 4. Notes

- **Release boundary:** #2–#5 features (shell integration, links, decorations,
  scrollback, a11y) are in the *released* 0.8.1; the gap-remediation items
  (screen-reader mode, program-title tabs, paste safety, `$ZDOTDIR`) are
  *unreleased on `main`*. A single "0.8 terminal" blog post can cover both,
  distinguishing shipped vs. next.
- **Not doc-worthy:** paste-via-`term.paste` (internal correctness — "it just works
  now"), binary transport / 64 KB buffer / flow control (internal perf).
- **Suggested order:** #2 → #3 → #4 → #5 (quick factual fixes), then #1 (the blog
  post, which needs authoring).
