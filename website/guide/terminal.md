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

When you close the last session the panel hides but the session stays alive — reopen with `` Ctrl + ` `` and you are back where you left off. If a shell process exits, press any key to restart it.

## Keyboard Shortcuts

These shortcuts work when the terminal panel is focused:

| Action | Shortcut |
|--------|----------|
| Copy | `Mod + C` (with selection) |
| Paste | `Mod + V` |
| Clear | `Mod + K` |
| Search | `Mod + F` |
| Toggle Terminal | `` Ctrl + ` `` |

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
- **Paste** — paste from clipboard into the shell
- **Select All** — select the entire terminal buffer
- **Clear** — clear visible output
- **Reset Display** — re-paint the terminal and reset its rendering cache. Use this if characters start to overlap, mix cases, or render garbled after a long session — most often seen when running heavily styled CLIs (e.g. Claude Code) for hours.

## Clickable Links

The terminal detects two kinds of links in command output:

- **Web URLs** — click to open in your default browser
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

Changes apply immediately to all open sessions. **Mac Option as Meta** routes the macOS Option key as Meta in the integrated terminal so emacs, tmux, and similar tools see Alt-prefixed shortcuts.

## Persistence

Terminal panel visibility and height are saved and restored across hot-exit restarts. Shell processes themselves cannot be preserved — a fresh shell is spawned for each session on restart, and any paused session loses its `SIGSTOP` state along with the process itself.
