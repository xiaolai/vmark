# VMark shell integration (zsh) — WI-3.1.
#
# Materialized to <appLocalData>/shell-integration/zsh/.zshrc and pointed at by
# ZDOTDIR when terminal.shellIntegration is on. Non-destructive: it sources the
# user's real rc first (so their config/theme wins), then appends OSC 133
# command-boundary marks + OSC 7 cwd so VMark can offer prompt navigation,
# exit-status decorations, and live cwd tracking.

# Restore the user's ZDOTDIR and source their real rc first.
ZDOTDIR="${USER_ZDOTDIR:-$HOME}"
[ -f "$ZDOTDIR/.zshrc" ] && source "$ZDOTDIR/.zshrc"

# OSC emitter. 133;A=prompt-start, 133;C=command pre-exec, 133;D;<code>=done.
__vmark_osc() { printf '\033]%s\007' "$1"; }
__vmark_precmd()  { __vmark_osc "133;D;$?"; __vmark_osc "133;A"; __vmark_osc "7;file://${HOST}${PWD}"; }
__vmark_preexec() { __vmark_osc "133;C"; }

# add-zsh-hook appends, so these run after any framework (oh-my-zsh, p10k) hooks
# and never replace them.
autoload -Uz add-zsh-hook 2>/dev/null && {
  add-zsh-hook precmd  __vmark_precmd
  add-zsh-hook preexec __vmark_preexec
}
