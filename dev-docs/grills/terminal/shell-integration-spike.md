# WI-0.3 — Spike: zsh shell-integration injection (OSC 133 + OSC 7)

> Plan: `dev-docs/plans/20260531-terminal-industrial-best.md` (ADR-T3)
> Status: **PENDING — requires a running app + a real zsh. Gates Phase 3.**
> Verdict: _not yet run_ (must contain literal `PASS` for the Phase-0 checker).
> Date created: 2026-05-31

## Hypothesis to validate

We can inject `precmd`/`preexec` hooks into a **zsh** session that emit
`OSC 133;A|B|C|D` (command boundaries) and `OSC 7` (cwd) on every prompt,
**without breaking a non-trivial user `~/.zshrc`** (oh-my-zsh, powerlevel10k,
custom `precmd_functions`, etc.), and degrade to a no-op if injection fails.

zsh is validated first because it is the macOS default (the primary platform).
bash/fish follow in WI-3.1 using their own mechanisms.

## Mechanism under test (non-destructive `ZDOTDIR` wrapper)

1. Write a temp dir `$TMP/vmark-zdotdir/` containing a `.zshrc` that:
   - records the user's real `ZDOTDIR` (or `$HOME`),
   - `source`s the user's real `.zshrc` first (so their config wins),
   - then appends VMark's integration hooks,
   - restores `ZDOTDIR` so child shells aren't affected.
2. Spawn the shell with `ZDOTDIR=$TMP/vmark-zdotdir` in the env (`spawnPty.ts`).

Sketch of the appended hooks:

```zsh
# VMark shell integration — appended after the user's rc.
__vmark_osc() { printf '\033]%s\007' "$1"; }
__vmark_precmd()  { __vmark_osc "133;D;$?"; __vmark_osc "133;A"; __vmark_osc "7;file://$HOST${PWD}"; }
__vmark_preexec() { __vmark_osc "133;C"; }
autoload -Uz add-zsh-hook 2>/dev/null && {
  add-zsh-hook precmd  __vmark_precmd
  add-zsh-hook preexec __vmark_preexec
}
PROMPT="%{$(__vmark_osc '133;B')%}$PROMPT"   # mark end of prompt / start of input
```

(Reference design: VS Code's `shellIntegration-rc.zsh`.)

## PASS / FAIL criteria

- **PASS** when, against a realistic `.zshrc`:
  1. the user's prompt/theme/aliases still work unchanged;
  2. a terminal capture shows `OSC 133 A/B/C/D` around a command and `OSC 7`
     with the correct cwd after a `cd`;
  3. an intentionally broken inject (e.g. missing file) leaves the shell
     **fully functional** (graceful degrade).
- **FAIL** when injection corrupts the prompt, breaks p10k/omz, or a failed
  inject breaks shell startup.

## How to capture the escape sequences

In the dev build's terminal, run a command and dump raw output, or attach via
`script`/`cat -v`, e.g.:

```bash
cd /tmp && printf 'probe\n' && ls    # then inspect captured bytes for \033]133 and \033]7
```

## Verdict

Machine-readable verdict line (the Phase-0 checker greps `^VERDICT: PASS`).
Change `PENDING` → `PASS`/`FAIL` after running against a real zsh with a
non-trivial rc, and paste the captured OSC sequences below it.

VERDICT: PENDING

## Risks flagged for Phase 3

- `ZDOTDIR` is zsh-specific; bash uses `--rcfile`, fish uses `conf.d`/`XDG`.
- Some prompt frameworks (p10k instant prompt) are sensitive to `precmd` order.
- Login vs interactive vs non-interactive shells load different rc files —
  confirm the chosen mechanism fires for the interactive case the terminal uses.
