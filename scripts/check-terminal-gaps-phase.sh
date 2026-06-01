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
  2|3|4)
    echo "  (phase $PHASE assertions added when that phase lands)"
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
