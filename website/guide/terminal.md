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
| Rename session | Double-click a tab, type a name, press `Enter` (`Escape` cancels) |
| Swap panel side | Click the swap icon (↕ / ↔) to flip the terminal to the opposite side of its current axis. In **Auto** mode this keeps the smart aspect-based switching (landscape → side, portrait → bottom/top) — it just chooses the other end. |
| Maximize the panel | Double-click the resize handle; double-click again to restore |

When you close the last session the panel hides but the session stays alive — reopen with `` Ctrl + ` `` and you are back where you left off. When the shell exits cleanly (`exit` or `Ctrl + D`), its tab closes automatically — and the panel hides if it was the last one. If the shell exits with an error, the tab stays open showing the exit code; press any key to restart it.

**Notifications:** when a terminal rings the bell (e.g. Claude Code finishing a turn) while that VMark window isn't focused, VMark posts an OS notification naming the window's document — so you can run Claude Code across several windows and get pinged for whichever needs you, without watching each one. Toggle it with **Settings → Terminal → Notify when unfocused** (on by default; asks for notification permission on first use). The same unfocused-bell signal also flags the window in the [Window Status panel](/guide/workspace-management#window-status-panel), so you can see which window needs you and jump straight to it.

Each tab reflects the running program's title (set by tools that emit a terminal title, such as `vim` or `ssh`) unless you have manually renamed the session — a manual rename always wins. To rename, **double-click the tab**: `Enter` commits, `Escape` discards, and clicking away keeps what you typed. An empty name is ignored.

**Maximizing:** the panel's size stops at 80 % of the available space so the editor stays reachable, and a **double-click on the resize handle** snaps it to that cap. A second double-click returns it to your saved size. This is a view toggle — it never changes the size you configured.

**Open Terminal Here:** right-click any folder in the file explorer and choose **Open Terminal Here** to start a session in that directory. The new session opens there regardless of where your other sessions happen to be. At five sessions the item is greyed out.

## Keyboard Shortcuts

These shortcuts work when the terminal panel is focused:

| Action | Shortcut |
|--------|----------|
| Copy | `Mod + C` (with selection) |
| Paste | `Mod + V` |
| Clear | `Mod + K` |
| Search | `Mod + F` |
| Line start / end | `Cmd + ←` / `Cmd + →` (macOS) |
| Delete line | `Cmd + ⌫` (macOS) |
| Zoom terminal font | `Mod + =` / `Mod + -` / `Mod + 0` |
| Toggle Terminal | `` Ctrl + ` `` |
| Previous command prompt | `Mod + ↑` |
| Next command prompt | `Mod + ↓` |

When the terminal is focused, `Mod + =` / `-` / `0` zoom the **terminal** font (set separately in Terminal settings), not the editor font, and `Mod + F` opens the **terminal** search rather than the editor's find bar.

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

The bar reports what it found next to the input:

- **`3 / 17`** — you are on the third of seventeen matches.
- **`5000 matches`** — too many matches for the terminal to track which one is
  active, so it reports the total without a position.
- **No results** — the query matched nothing; the input text turns red as well.

Three toggles sit between the input and the arrows:

| Toggle | Effect |
|--------|--------|
| **Aa** | Match case |
| **ab** | Match whole words only |
| **.\*** | Treat the query as a regular expression |

While regex mode is on, a half-typed pattern (`[` on the way to `[a-z]`) simply
reports no results instead of erroring — keep typing. The toggles reset each
time you close the bar or switch sessions.

## Context Menu

Right-click inside the terminal to access:

- **Copy** — copy selected text (disabled when nothing is selected)
- **Copy Unwrapped** — copy the selection with display-width line breaks removed. Some command-line programs (codex and other TUI apps) hard-wrap their output to the terminal width by inserting real newlines; a normal copy preserves those breaks. "Copy Unwrapped" joins wrapped lines back into continuous paragraphs (blank lines are kept as paragraph breaks). It is CJK-aware — Chinese/Japanese text joins without inserting spaces. Select the block you know is one logical flow, since VMark can't tell a wrap newline from an intentional one.
- **Paste** — paste from clipboard into the shell
- **Select All** — select the entire terminal buffer
- **Clear** — clear visible output
- **Reset Display** — re-paint the terminal and reset its rendering cache. Use this if characters start to overlap, mix cases, or render garbled after a long session — most often seen when running heavily styled CLIs (e.g. Claude Code) for hours.
- **Copy Command Output** — copy everything one command printed, without its prompt line and without the next command's output. Appears only when you right-click inside a command's output and [shell integration](#shell-integration) is on, since that is what tells VMark where each command began and ended.

The menu is fully keyboard-navigable: it opens with the first available action focused, arrow keys move between items (skipping disabled ones), Home/End jump to the first/last, Enter or Space activates, and Escape or Tab closes it.

## Running a code block

Hover any `bash`, `sh`, `zsh`, `shell`, or `console` fence in your document and
a **▶ Run in Terminal** button appears beside the copy button. It pastes the
block into the terminal — revealing the panel and starting a session if needed —
and stops there.

::: warning It pastes; it does not run
The command is placed on the shell's input line and **never executed for you**:
no newline is appended, so nothing happens until *you* press Enter. Read what
landed there first — a document can come from anywhere, and a code fence is
just text somebody wrote.
:::

For a `console` fence — a pasted transcript — leading `$ `, `% `, and `# `
prompts are stripped so you get the command rather than the prompt. In a `bash`
fence they are left alone, since there they are source code.

## Clickable Links

The terminal detects three kinds of links in command output:

- **Web URLs** — click to open in your default browser
- **OSC 8 hyperlinks** — explicit terminal hyperlinks emitted by tools like `ls --hyperlink=auto`, `gh`, and modern compilers. The visible text and the underlying URL can differ; clicking opens the URL.
- **File paths** — click to open the file in the editor (supports `:line:col` suffixes and relative paths resolved against the workspace root)

## Shell Environment

VMark sets these environment variables in every terminal session:

| Variable | Value |
|----------|-------|
| `TERM` | `xterm-256color` |
| `TERM_PROGRAM` | `WezTerm` |
| `VMARK_WORKSPACE` | Workspace root path (when a folder is open) |
| `PATH` | Full login shell PATH (same as your system terminal) |
| `LC_CTYPE` | `UTF-8` |

`TERM_PROGRAM` reports `WezTerm`, not `vmark`, and that is deliberate. Several
CLI tools — Claude Code's `/terminal-setup` among them — enable
[CSI u](https://invisible-island.net/xterm/modified-keys.html) key encoding only
for terminals on a hard-coded allowlist, and fall back to a degraded
"unknown terminal" path for everything else. VMark speaks that protocol, so it
identifies as the allowlisted terminal whose behavior it matches most closely.
Changing this value to `vmark` would silently break Shift+Enter and other
modified-key sequences in those tools. See
[ADR-006](https://github.com/xiaolai/vmark/blob/main/dev-docs/decisions/ADR-006-terminal-program-identity.md).

VMark deliberately does **not** set `EDITOR`. Your own `$EDITOR` — whatever your
shell config exports — is what `git commit`, `crontab -e`, and friends will
launch. (VMark used to force `EDITOR=vmark`, but the `vmark` command-line shim
is optional and returns immediately rather than waiting for you to close the
tab, so `git commit` failed either with "command not found" or with an empty
commit message. Making it work needs a blocking `vmark --wait` protocol, which
is not built yet.)

The integrated terminal inherits your login shell's `PATH`, so CLI tools like `node`, `claude`, and other user-installed binaries are discoverable — just as they would be in a regular terminal window.

The shell is read from `$SHELL` (falls back to `/bin/sh`). The working directory starts at the workspace root, or the active file's parent directory, or `$HOME`.

Standard shell shortcuts like `Ctrl+R` (reverse history search in zsh/bash) work when the terminal is focused — they are not intercepted by the editor.

When you open a workspace or file after the terminal is already running, all sessions automatically `cd` to the new workspace root.

## Not yet implemented

These are tracked but do **not** ship today. They are listed here because
earlier versions of this page described some of them as if they did:

- **Pause / Resume a session.** VMark can suspend a shell process internally —
  it does so automatically as flow control when output arrives faster than the
  terminal can render it — but there is no user-facing control for it, and no
  session tab context menu to hang one on.
- **A blocking `vmark --wait`** so `$EDITOR` can point at VMark (see
  [Shell Environment](#shell-environment) above).
- **Scrollback persistence across restarts** (see [Persistence](#persistence)).
- **fish shell integration** (see [Shell integration](#shell-integration)).

## Settings

Open **Settings → Terminal** to configure:

| Setting | Range | Default | Platforms |
|---------|-------|---------|-----------|
| Panel Size | 10 % – 80 % of the available space, in 5 % steps | 40 % | All |
| Font Size | 10 – 24 px | 13 px | All |
| Line Height | 1.0 – 2.0 | 1.2 | All |
| Copy on Select | On / Off | Off | All |
| Mac Option as Meta | On / Off | On | macOS |
| Shell Integration | On / Off | On | macOS / Linux (zsh, bash) |
| Remote Clipboard (OSC 52) | On / Off | On | All |
| Scrollback | 1,000 / 5,000 / 10,000 / 50,000 lines | 5,000 | All |
| Screen Reader Mode | On / Off | Off | All |

### Accessibility

| Setting | Options | Default |
|---------|---------|---------|
| Terminal bell | Off / Visual / Audible | Visual |
| Minimum contrast | Off / WCAG AA (4.5:1) / WCAG AAA (7:1) / Maximum | WCAG AA (4.5:1) |

Changes apply immediately to all open sessions. **Panel Size** goes up to 80 % of the available space. The editor keeps a minimum size in pixels, so it never disappears entirely no matter how large the terminal gets. Double-click the resize handle to jump straight to the maximum and back again without changing the stored size. **Mac Option as Meta** routes the macOS Option key as Meta in the integrated terminal so emacs, tmux, and similar tools see Alt-prefixed shortcuts (macOS only); it is on by default, so Option+Arrow does word movement rather than inserting accented characters. **Shell Integration** is available on macOS and Linux (hidden on Windows). **Remote Clipboard** is described below. **Scrollback** controls how many lines of output each session retains in its scroll history — higher values use more memory. **Screen Reader Mode** exposes terminal output to assistive technology such as VoiceOver; it is off by default for performance. **Terminal bell** chooses how a bell (BEL) is signalled — a visual background-activity mark on the session tab, a soft audible beep (which also flags a background session's tab so you can find it), or nothing. **Minimum contrast** lifts faint terminal text to a readable contrast ratio against its background; raise it for accessibility or set it to Off to disable the lift.

::: tip Font size and zoom
`Mod + =` / `Mod + -` zoom in steps of 2 px, so the terminal font can land on a
value the dropdown doesn't list (13 → 15 → 17 …). The dropdown shows whatever
size is actually in effect, adding the zoomed value to the list rather than
snapping you back to a preset.
:::

## Remote clipboard (OSC 52)

Copy inside an `ssh` session, inside `tmux`, or in a remote editor, and the text
lands on **your** clipboard — not the remote machine's. Programs request this by
printing an OSC 52 escape sequence; VMark routes it to the system clipboard.

```bash
# From anywhere the terminal can print — including over ssh:
printf '\e]52;c;%s\a' "$(printf 'hello' | base64)"
```

::: warning Writes only — reads are always refused
OSC 52 also defines a way to *read* the clipboard, and VMark **never** answers
it, even with this setting on. Any process that can print bytes to your
terminal could ask — including `cat` on a file you did not write — and the
answer would arrive as if you had typed it. iTerm2 and VS Code refuse for the
same reason. The setting controls writes; reads are refused unconditionally.
:::

Turn **Settings → Terminal → Remote Clipboard** off to close the channel
entirely. The change applies to newly spawned sessions.

## Shell integration

When **Shell Integration** is on, VMark injects lightweight command markers into
the shell so the terminal understands where each command starts and ends. It
unlocks:

- **Prompt navigation** — `Cmd + ↑` / `Cmd + ↓` jumps to the previous / next
  command prompt in the scrollback.
- **Exit-status decorations** — a thin gutter bar marks each command line green
  (success) or red (failure).
- **Live working-directory tracking** — relative file paths in output resolve
  against the shell's current directory, and new terminals open there.

**zsh** and **bash** are supported, on macOS and Linux. In both cases the
injection is non-destructive — your real config is sourced first, and VMark's
hooks are appended rather than substituted, so your prompt, theme, and aliases
are untouched.

| Shell | How VMark hooks in | What it preserves |
|---|---|---|
| zsh | `ZDOTDIR` points at a generated `.zshrc` that sources yours, then registers hooks with `add-zsh-hook` | A custom `$ZDOTDIR` is honored: VMark resolves your real one from a login shell and sources `.zshenv` and `.zshrc` from there, not just `$HOME` |
| bash | `bash --rcfile <generated>`, which sources `~/.bashrc` first | An existing `PROMPT_COMMAND` and an existing `DEBUG` trap are both **composed with**, not replaced — so `bash-preexec`, `direnv`, and `atuin` keep working |

Because the terminal runs an interactive non-login shell, login-only files
(`.zprofile`, `.bash_profile`, `.profile`) are out of scope for both shells,
matching how a normal terminal tab behaves.

fish is not yet integrated; it runs normally without these features. Turn the
setting off to disable injection entirely. Changes apply to newly spawned
sessions (restart the terminal to apply).

## Persistence

Terminal panel visibility and size are saved and restored across hot-exit restarts. Shell processes themselves cannot be preserved — a fresh shell is spawned for each session on restart. Scrollback is not preserved either: restoring it would mean writing whatever passed through your terminal (API keys included) to disk, so it is deliberately left for a design that addresses that first.
