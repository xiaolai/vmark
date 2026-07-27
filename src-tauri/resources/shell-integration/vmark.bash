# VMark shell integration (bash) — WI-3.4.
#
# Materialized to <appLocalData>/shell-integration/bash/vmark.bash and passed as
# `bash --rcfile <path>`. Non-destructive: it sources the user's real rc first
# (so their config/theme/aliases win), then appends OSC 133 command-boundary
# marks + OSC 7 cwd so VMark can offer prompt navigation, exit-status
# decorations, and live cwd tracking.
#
# Why --rcfile and not BASH_ENV or a bare PROMPT_COMMAND injection:
#   - BASH_ENV applies to NON-interactive shells only — the wrong hook entirely.
#   - PROMPT_COMMAND alone cannot mark pre-exec (bash has no `preexec`), so
#     exit-status decorations would be attributed to the wrong command.
#   - --rcfile is what VS Code uses for the same job.

# NOTE: everything below is written to survive `set -u` in the user's rc — any
# variable we did not define ourselves is read with a `:-` default. Without
# that, a `set -u` user sees "unbound variable" errors at every prompt.

# `--rcfile` REPLACES ~/.bashrc for interactive non-login shells, so source it
# ourselves first — otherwise turning shell integration on would silently
# delete the user's entire bash configuration.
# (~/.bash_profile, ~/.bash_login and ~/.profile are LOGIN-shell files; the
# terminal runs interactive non-login, so they are intentionally out of scope,
# mirroring vmark.zsh's .zprofile exclusion.)
if [ -f "$HOME/.bashrc" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.bashrc"
fi

# OSC emitter. 133;A=prompt-start, 133;C=command pre-exec, 133;D;<code>=done.
__vmark_osc() { printf '\033]%s\007' "$1"; }

# --- prompt-phase state ----------------------------------------------------
# `__vmark_in_prompt` is 1 for the WHOLE duration of the prompt hook, including
# the user's own PROMPT_COMMAND entries. Without that, those entries would trip
# the DEBUG trap, consume the one pre-exec mark, and the user's actual command
# would get none — which is exactly what happened when this script merely
# PREPENDED itself to PROMPT_COMMAND instead of wrapping it.
__vmark_in_prompt=0
__vmark_preexec_ran=0

# Fires once per command line, immediately before the command runs.
__vmark_preexec() {
  # Programmable completion also triggers DEBUG; that is not a user command.
  [ -n "${COMP_LINE:-}" ] && return
  # Still inside the prompt hook — not a user command either.
  [ "$__vmark_in_prompt" = 1 ] && return
  # The DEBUG trap fires for every simple command in a pipeline/compound —
  # emit only the first, and let the prompt hook re-arm for the next line.
  [ "$__vmark_preexec_ran" = 1 ] && return
  __vmark_preexec_ran=1
  __vmark_osc "133;C"
}

# Report the finished command's exit code, open the next command block, and
# publish the cwd. Called at the START of the prompt hook so it observes the
# real `$?`.
__vmark_emit_prompt_marks() {
  __vmark_osc "133;D;$1"
  __vmark_osc "133;A"
  # Percent-encode the URL-syntactic chars so the consumer isn't truncated at
  # # (fragment) / ? (query) and doesn't choke on a literal %. Encode % first
  # to avoid double-encoding; space/UTF-8 are handled downstream.
  local p=${PWD//'%'/%25}; p=${p//'#'/%23}; p=${p//'?'/%3F}
  __vmark_osc "7;file://${HOSTNAME:-}${p}"
}

# --- DEBUG trap: compose, never replace ------------------------------------
# Capture any trap the user's rc already installed and call it first, so
# frameworks that rely on DEBUG (bash-preexec, direnv, atuin) keep working.
__vmark_existing_debug=$(trap -p DEBUG)
# `trap -p DEBUG` prints: trap -- '<command>' DEBUG
__vmark_existing_debug=${__vmark_existing_debug#trap -- \'}
__vmark_existing_debug=${__vmark_existing_debug%\' DEBUG}

if [ -n "$__vmark_existing_debug" ] && \
   [ "$__vmark_existing_debug" != "__vmark_debug_trap" ]; then
  __vmark_prior_debug() { eval "$__vmark_existing_debug"; }
else
  __vmark_prior_debug() { :; }
fi

# Restoring `$?` makes this trap transparent: without it, the trap's own last
# command would become the status the NEXT command sees, and every exit-status
# decoration would read 0. The user's prior trap is invoked with that status
# restored too, so a hook reading `$?` sees what a bare trap would have.
__vmark_debug_trap() {
  local __vmark_ret=$?
  # The prompt hook's own invocation is not a user command.
  [ "${BASH_COMMAND:-}" = "__vmark_prompt" ] && return $__vmark_ret
  ( exit $__vmark_ret )
  __vmark_prior_debug
  __vmark_preexec
  return $__vmark_ret
}
trap '__vmark_debug_trap' DEBUG

# --- PROMPT_COMMAND: WRAP, never merely prepend ----------------------------
# The user's entries are captured and invoked from inside our hook, so the
# prompt phase has a definite start AND end. Prepending (`__vmark_precmd;$PC`)
# cannot express the end, which is how the pre-exec mark ended up attached to
# the user's prompt hook instead of their command.
if [ "${PROMPT_COMMAND:-}" != "__vmark_prompt" ]; then
  __vmark_saved_prompt=()
  case $(declare -p PROMPT_COMMAND 2>/dev/null) in
    "declare -a"*|"declare -A"*|"typeset -a"*)
      # bash 5.1+ array form — keep every entry.
      __vmark_saved_prompt=("${PROMPT_COMMAND[@]}")
      ;;
    *)
      [ -n "${PROMPT_COMMAND:-}" ] && __vmark_saved_prompt=("${PROMPT_COMMAND:-}")
      ;;
  esac

  __vmark_prompt() {
    local __vmark_ret=$?
    __vmark_in_prompt=1
    __vmark_emit_prompt_marks "$__vmark_ret"
    # `"${arr[@]}"` on an EMPTY array is an unbound-variable error under
    # `set -u` (bash < 4.4), so the count is checked first.
    if [ ${#__vmark_saved_prompt[@]} -gt 0 ]; then
      local __vmark_entry
      for __vmark_entry in "${__vmark_saved_prompt[@]}"; do
        # Restore the status the user's hook would have seen without us.
        ( exit "$__vmark_ret" )
        eval "$__vmark_entry"
      done
    fi
    # Re-arm only now that the whole prompt phase is over.
    __vmark_preexec_ran=0
    __vmark_in_prompt=0
    return "$__vmark_ret"
  }

  # Plain string assignment: honored by every bash version, including the 3.2
  # that macOS still ships as /bin/bash.
  PROMPT_COMMAND="__vmark_prompt"
fi
