# Integrated Terminal

VMark includes a built-in terminal panel so you can run commands without leaving the editor.

Press `` Ctrl + ` `` to toggle the terminal panel.

## Sessions

The terminal supports up to 5 concurrent sessions, each with its own shell process. A vertical tab bar on the right side shows numbered session tabs.

| Action | How |
|--------|-----|
| New session | Click the **+** button |
| Switch session | Click a tab number |
| Close session | Click the trash icon |
| Restart shell | Click the restart icon |
| Swap panel side | Click the swap icon (↕ / ↔) to flip the terminal to the opposite side of its current axis. In **Auto** mode this keeps the smart aspect-based switching (landscape → side, portrait → bottom/top) — it just chooses the other end. |

When you close the last session the panel hides but the session stays alive — reopen with `` Ctrl + ` `` and you are back where you left off. If a shell process exits, press any key to restart it.

**Notifications:** when a terminal rings the bell (e.g. Claude Code finishing a turn) while that VMark window isn't focused, VMark posts an OS notification naming the window's document — so you can run Claude Code across several windows and get pinged for whichever needs you, without watching each one. Toggle it with **Settings → Terminal → Notify when unfocused** (on by default; asks for notification permission on first use). The same unfocused-bell signal also flags the window in the [Window Status panel](/guide/workspace-management#window-status-panel), so you can see which window needs you and jump straight to it.

Each tab reflects the running program's title (set by tools that emit a terminal title, such as `vim` or `ssh`) unless you have manually renamed the session — a manual rename always wins.

## Keyboard Shortcuts

These shortcuts work when the terminal panel is focused:

| Action | Shortcut |
|--------|----------|
| Copy | `Mod + C` (with selection) |
| Paste | `Mod + V` |
| Clear | `Mod + K` |
| Search | `Mod + F` |
| Toggle Terminal | `` Ctrl + ` `` |
| Previous command prompt | `Mod + ↑` |
| Next command prompt | `Mod + ↓` |

Prompt navigation (`Mod + ↑` / `Mod + ↓`) requires shell integration — see [Shell integration](#shell-integration) below.

::: tip
`Mod + C` without a text selection sends SIGINT to the running process — the same as pressing Ctrl+C in a regular terminal.
:::

## Search

Press `Mod + F` to open the search bar. Type to search incrementally through the terminal buffer.

| Action | Shortcut |
|--------|----------|
| Next match | `Enter` |
| Previous match | `Shift + Enter` |
| Close search | `Escape` |

## Context Menu

Right-click inside the terminal to access:

- **Copy** — copy selected text (disabled when nothing is selected)
- **Copy Unwrapped** — copy the selection with display-width line breaks removed. Some command-line programs (codex and other TUI apps) hard-wrap their output to the terminal width by inserting real newlines; a normal copy preserves those breaks. "Copy Unwrapped" joins wrapped lines back into continuous paragraphs (blank lines are kept as paragraph breaks). It is CJK-aware — Chinese/Japanese text joins without inserting spaces. Select the block you know is one logical flow, since VMark can't tell a wrap newline from an intentional one.
- **Paste** — paste from clipboard into the shell
- **Select All** — select the entire terminal buffer
- **Clear** — clear visible output
- **Reset Display** — re-paint the terminal and reset its rendering cache. Use this if characters start to overlap, mix cases, or render garbled after a long session — most often seen when running heavily styled CLIs (e.g. Claude Code) for hours.

## Clickable Links

The terminal detects three kinds of links in command output:

- **Web URLs** — click to open in your default browser
- **OSC 8 hyperlinks** — explicit terminal hyperlinks emitted by tools like `ls --hyperlink=auto`, `gh`, and modern compilers. The visible text and the underlying URL can differ; clicking opens the URL.
- **File paths** — click to open the file in the editor (supports `:line:col` suffixes and relative paths resolved against the workspace root)

## Shell Environment

VMark sets these environment variables in every terminal session:

| Variable | Value |
|----------|-------|
| `TERM_PROGRAM` | `vmark` |
| `EDITOR` | `vmark` |
| `VMARK_WORKSPACE` | Workspace root path (when a folder is open) |
| `PATH` | Full login shell PATH (same as your system terminal) |

The integrated terminal inherits your login shell's `PATH`, so CLI tools like `node`, `claude`, and other user-installed binaries are discoverable — just as they would be in a regular terminal window.

The shell is read from `$SHELL` (falls back to `/bin/sh`). The working directory starts at the workspace root, or the active file's parent directory, or `$HOME`.

Standard shell shortcuts like `Ctrl+R` (reverse history search in zsh/bash) work when the terminal is focused — they are not intercepted by the editor.

When you open a workspace or file after the terminal is already running, all sessions automatically `cd` to the new workspace root.

## Pause / Resume

For long-running processes producing verbose output, you can suspend the underlying shell process from VMark to free CPU without killing the session. Resuming continues the process from where it left off.

| Action | How |
|---|---|
| Pause the active session | Right-click the session tab → **Pause** |
| Resume the paused session | Right-click the paused tab → **Resume** |

While paused:

- The session tab shows a dimmed indicator
- The shell receives `SIGSTOP` (POSIX); the OS suspends scheduling for the process
- Buffered output that was already written to the terminal is preserved on screen, but no new output appears until you resume
- The kill / clear / restart controls remain available

Pause/Resume is a macOS/Linux feature only — Windows process control doesn't expose an equivalent suspend signal, so the menu items are hidden on Windows builds.

## Settings

Open **Settings → Terminal** to configure:

| Setting | Range | Default | Platforms |
|---------|-------|---------|-----------|
| Font Size | 10 – 24 px | 13 px | All |
| Line Height | 1.0 – 2.0 | 1.2 | All |
| Copy on Select | On / Off | Off | All |
| Mac Option as Meta | On / Off | Off | macOS |
| Shell Integration | On / Off | On | macOS / Linux (zsh) |
| Scrollback | 1,000 / 5,000 / 10,000 / 50,000 lines | 5,000 | All |
| Screen Reader Mode | On / Off | Off | All |

### Accessibility

| Setting | Options | Default |
|---------|---------|---------|
| Terminal bell | Off / Visual / Audible | Visual |
| Minimum contrast | Off / WCAG AA (4.5:1) / WCAG AAA (7:1) / Maximum | WCAG AA (4.5:1) |

Changes apply immediately to all open sessions. **Mac Option as Meta** routes the macOS Option key as Meta in the integrated terminal so emacs, tmux, and similar tools see Alt-prefixed shortcuts (macOS only). **Shell Integration** is available on macOS and Linux (hidden on Windows). **Scrollback** controls how many lines of output each session retains in its scroll history — higher values use more memory. **Screen Reader Mode** exposes terminal output to assistive technology such as VoiceOver; it is off by default for performance. **Terminal bell** chooses how a bell (BEL) is signalled — a visual background-activity mark on the session tab, a soft audible beep (which also flags a background session's tab so you can find it), or nothing. **Minimum contrast** lifts faint terminal text to a readable contrast ratio against its background; raise it for accessibility or set it to Off to disable the lift.

## Shell integration

When **Shell Integration** is on (zsh, macOS), VMark injects lightweight command
markers into the shell so the terminal understands where each command starts and
ends. It is non-destructive — your real config is sourced first, then the
markers are appended via `add-zsh-hook`, so your prompt, theme, and aliases are
untouched. Custom `$ZDOTDIR` setups are honored: VMark resolves your real
`ZDOTDIR` from a login shell and sources your `.zshenv` and `.zshrc` from there
(not just `$HOME`). It unlocks:

- **Prompt navigation** — `Cmd + ↑` / `Cmd + ↓` jumps to the previous / next
  command prompt in the scrollback.
- **Exit-status decorations** — a thin gutter bar marks each command line green
  (success) or red (failure).
- **Live working-directory tracking** — relative file paths in output resolve
  against the shell's current directory, and new terminals open there.

bash and fish are not yet integrated; they run normally without these features.
Turn the setting off to disable injection entirely. Changes apply to newly
spawned sessions (restart the terminal to apply).

## Persistence

Terminal panel visibility and height are saved and restored across hot-exit restarts. Shell processes themselves cannot be preserved — a fresh shell is spawned for each session on restart, and any paused session loses its `SIGSTOP` state along with the process itself.
