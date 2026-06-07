#!/usr/bin/env bash
#
# DoD checker for the Terminal Gap-Remediation plan.
# Plan:  dev-docs/plans/20260601-terminal-gap-remediation.md
# Audit: dev-docs/audit/20260601-terminal-gaps.md
#
# Usage: bash scripts/check-terminal-gaps-phase.sh <phase-number>
#
# Structural (file-presence + grep) assertions only. "Gates green"
# (pnpm check:all / cargo test) and live Tauri-MCP checks are verified
# separately by the runner. Exit 0 if all pass, 1 if any fail.

set -uo pipefail
cd "$(dirname "$0")/.."

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase-number>"
  echo "  1  G1   custom \$ZDOTDIR regression (login-shell USER_ZDOTDIR)"
  echo "  2  G2,G5 paste via term.paste + link security tests"
  echo "  3  G3,G4 screenReaderMode + program-title tab"
  echo "  4  G6-G10 polish + coverage backfill"
  exit 64
fi

PASS=0; FAIL=0; FAIL_DETAIL=()
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); FAIL_DETAIL+=("$1"); }

# assert_grep <fixed-pattern> <file-or-dir> <label>
assert_grep() {
  if grep -rqF -- "$1" "$2" 2>/dev/null; then ok "$3"; else fail "$3 (pattern '$1' not in $2)"; fi
}

DET="src-tauri/src/ai_provider/detection.rs"
SHL="src-tauri/src/shell_integration.rs"
ZSH="src-tauri/resources/shell-integration/vmark.zsh"

case "$PHASE" in
  1)
    # G1 — resolve the user's login-shell ZDOTDIR and carry it as USER_ZDOTDIR.
    assert_grep "fn parse_sentinel" "$DET" "WI-1.1 parse_sentinel helper present"
    assert_grep "fn run_login_shell_capture" "$DET" "WI-1.1 shared login-shell capture present"
    assert_grep "fn query_login_shell_zdotdir" "$DET" "WI-1.1 uncached ZDOTDIR query present"
    assert_grep "fn login_shell_zdotdir" "$DET" "WI-1.1 cached ZDOTDIR resolver present"
    assert_grep "parse_sentinel_extracts_trimmed_value" "$DET" "WI-1.1 parse tests present"
    assert_grep "zdotdir_none_for_nonexistent_shell" "$DET" "WI-1.1 resolver tests present"
    assert_grep "fn build_zsh_env" "$SHL" "WI-1.2 testable env builder present"
    assert_grep "USER_ZDOTDIR" "$SHL" "WI-1.2 USER_ZDOTDIR wired"
    assert_grep "build_zsh_env_includes_user_zdotdir_when_resolved" "$SHL" "WI-1.2 env-builder tests present"
    assert_grep "USER_ZDOTDIR" "$ZSH" "WI-1.2 vmark.zsh restores USER_ZDOTDIR"
    assert_grep ".zshenv" "$ZSH" "WI-1.2 vmark.zsh sources user .zshenv"
    assert_grep "ZDOTDIR" "website/guide/terminal.md" "WI-1.3 docs mention ZDOTDIR handling"
    ;;
  2)
    # G2 — paste routed through term.paste (both paths); G5 — link security tests.
    assert_grep "term.paste(text)" "src/components/Terminal/terminalKeyHandler.ts" "WI-2.1 Cmd+V uses term.paste"
    assert_grep "term.paste(text)" "src/components/Terminal/TerminalContextMenu.tsx" "WI-2.1 right-click paste uses term.paste"
    [[ -f src/components/Terminal/setupWebLinks.test.ts ]] && ok "WI-2.2 setupWebLinks.test.ts present" || fail "WI-2.2 setupWebLinks.test.ts missing"
    [[ -f src/components/Terminal/setupFileLinks.test.ts ]] && ok "WI-2.3 setupFileLinks.test.ts present" || fail "WI-2.3 setupFileLinks.test.ts missing"
    assert_grep "javascript:" "src/components/Terminal/setupWebLinks.test.ts" "WI-2.2 asserts dangerous-scheme rejection"
    ;;
  3)
    # G3 screenReaderMode + G4 program-title tab.
    assert_grep "screenReaderMode" "src/stores/settingsStore.ts" "WI-3.1 screenReaderMode default"
    assert_grep "screenReaderMode" "src/components/Terminal/createTerminalInstance.ts" "WI-3.1 applied to xterm"
    assert_grep "screenReaderMode" "src/components/Terminal/terminalSessionStoreSync.ts" "WI-3.1 live-synced"
    assert_grep "screenReaderMode" "src/pages/settings/TerminalSettings.tsx" "WI-3.1 settings UI"
    assert_grep "terminal.screenReaderMode.label" "src/locales/en/settings.json" "WI-3.1 i18n key"
    assert_grep "terminalSetProgramTitle" "src/stores/uiStore.ts" "WI-3.2 program-title action"
    assert_grep "isUserRenamed" "src/stores/uiStore.ts" "WI-3.2 rename-source flag"
    assert_grep "onTitleChange" "src/components/Terminal/useTerminalSessions.ts" "WI-3.2 onTitleChange wired"
    assert_grep "programTitle" "src/components/Terminal/TerminalTabBar.tsx" "WI-3.2 tab renders program title"
    ;;
  4)
    # G6 fontFamily sync, G7 scrollback, G8 reader logging, G9 reaping doc, WI-4.6 coverage.
    assert_grep "resolveMonoFontStack(" "src/components/Terminal/terminalSessionStoreSync.ts" "WI-4.1 fontFamily live-sync"
    assert_grep "scrollback" "src/stores/settingsStore.ts" "WI-4.2 scrollback default"
    assert_grep "settings.scrollback" "src/components/Terminal/createTerminalInstance.ts" "WI-4.2 scrollback not hardcoded"
    assert_grep "reader" "src-tauri/src/pty.rs" "WI-4.3 reader present"
    assert_grep "write_rc_atomic" "src-tauri/src/shell_integration.rs" "WI-4.6 atomic-write helper + test"
    ;;
  *)
    echo "Unknown phase: $PHASE"; exit 64 ;;
esac

echo ""
echo "Phase $PHASE: $PASS passed, $FAIL failed."
if (( FAIL > 0 )); then
  printf '  - %s\n' "${FAIL_DETAIL[@]}"
  exit 1
fi
exit 0
