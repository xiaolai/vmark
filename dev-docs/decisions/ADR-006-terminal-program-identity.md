# ADR-006: Terminal TERM_PROGRAM Identity

> Status: **Accepted** | Date: 2026-04-14

## Context

VMark's built-in terminal (xterm.js + portable-pty) originally set
`TERM_PROGRAM=vmark`. This caused problems with CLI tools that detect the host
terminal via environment variables and maintain an allowlist of known terminals.

The immediate trigger: Claude Code's `/terminal-setup` command checks
`TERM_PROGRAM` to determine whether the terminal natively supports the CSI u
keyboard protocol (used for Shift+Enter multi-line input). Unrecognized
terminals fall through to a generic "you're in tmux/screen" error message,
which is misleading.

Claude Code recognizes four terminals as having native CSI u support:

| TERM_PROGRAM | Terminal |
|---|---|
| `ghostty` | Ghostty |
| `kitty` | Kitty |
| `iTerm.app` | iTerm2 |
| `WezTerm` | WezTerm |

## Decision

Set `TERM_PROGRAM=WezTerm` instead of `TERM_PROGRAM=vmark`.

## Rationale

**Why impersonate rather than use the real identity:**

- CLI tools with terminal allowlists will never enumerate every xterm.js-based
  app. VMark would need upstream patches in each tool that does terminal
  detection — an endless game of whack-a-mole.
- xterm.js is capability-equivalent to these terminals for the features that
  matter (256-color, Unicode, CSI u key encoding once configured).

**Why WezTerm over the other three:**

| Candidate | Detection method | Side-effect risk |
|---|---|---|
| `ghostty` | `TERM=xterm-ghostty` (not `TERM_PROGRAM`) | Changes `TERM`, affects terminfo lookups and ncurses apps |
| `kitty` | `TERM_PROGRAM=kitty` | Some tools probe Kitty-specific image protocol, graphics commands |
| `iTerm.app` | `TERM_PROGRAM=iTerm.app` | Many tools have iTerm-specific code paths (imgcat, shell integration, badges, marks) — highest false-feature risk |
| `WezTerm` | `TERM_PROGRAM=WezTerm` | Fewest tools probe for WezTerm-specific features — lowest side-effect risk |

WezTerm is the least "famous" of the four, so the fewest CLI tools have
WezTerm-specific code paths that would fire unexpectedly.

## Trade-offs

**Pros:**
- Claude Code (and similar tools) recognize the terminal immediately
- No upstream patches needed in third-party CLI tools
- Single env var change, zero behavioral side effects observed

**Cons:**
- Tools that emit WezTerm-specific escape sequences may produce unexpected
  output (none known at time of writing)
- `TERM_PROGRAM` no longer truthfully identifies the host — debugging terminal
  issues requires knowing this mapping exists
- If WezTerm gains popularity and tools add WezTerm-specific probes, we inherit
  those code paths

## Note on CSI u / Shift+Enter

This ADR only covers the `TERM_PROGRAM` identity. xterm.js does not send CSI u
escape sequences by default — Shift+Enter currently produces a plain newline,
not `\x1b[13;2u`. If a future requirement needs actual Shift+Enter support in
Claude Code (or similar tools), a separate xterm.js key handler must be added.
That is a distinct change and should be tracked separately.

## Affected Files

- `src/components/Terminal/spawnPty.ts` — PTY environment variables
