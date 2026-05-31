#!/usr/bin/env bash
#
# DoD checker for the Terminal Industrial-Best plan.
# Plan: dev-docs/plans/20260531-terminal-industrial-best.md
#
# Usage: bash scripts/check-terminal-phase.sh <phase-number>
#
# Each phase block runs the machine-checkable assertions for that phase's
# Definition of Done. Exit 0 if all pass, 1 if any fail. Run before ticking
# the plan's Status header to the next phase.
#
# NOTE: "gates green" (pnpm check:all / cargo test) is verified separately by
# the human/agent runner — this script only checks the structural DoD that can
# be asserted by file presence and grep. The spike phases (0) and the in-app
# benchmarks cannot be auto-run here (PTY needs a live Tauri app); they are
# gated on the presence of PASS-marked grill docs the runner fills in.

set -uo pipefail

cd "$(dirname "$0")/.."

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase-number>"
  echo "  0  Spikes + baselines (de-risk gate)"
  echo "  1  Throughput architecture (T1,T2,T3,L2)"
  echo "  2  cwd tracking (M2,C2 / OSC 7)"
  echo "  3  Shell integration (M1 / OSC 133)"
  echo "  4  Links + display polish (C1,M3,M4)"
  echo "  5  Persistence (C3)"
  echo "  6  Process-group lifecycle (L1, conditional)"
  exit 64
fi

PASS=0
FAIL=0
FAIL_DETAIL=()

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); FAIL_DETAIL+=("$1"); }

assert_file() {
  local path="$1"; local label="${2:-$1}"
  if [[ -f "$path" ]]; then ok "$label exists"; else fail "$label missing: $path"; fi
}

assert_dir() {
  local path="$1"; local label="${2:-$1}"
  if [[ -d "$path" ]]; then ok "$label exists"; else fail "$label missing: $path"; fi
}

# assert_grep <pattern> <file-or-glob-dir> <label>  (fixed-string grep)
assert_grep() {
  local pattern="$1"; local target="$2"; local label="$3"
  if grep -rqF -- "$pattern" "$target" 2>/dev/null; then ok "$label"; else fail "$label (pattern '$pattern' not in $target)"; fi
}

# assert_grep_re <ere-pattern> <file-or-dir> <label>
assert_grep_re() {
  local pattern="$1"; local target="$2"; local label="$3"
  if grep -rqE -- "$pattern" "$target" 2>/dev/null; then ok "$label"; else fail "$label (regex '$pattern' not in $target)"; fi
}

# assert_absent_code <fixed-pattern> <file-or-dir> <label>
# Passes when the pattern appears ONLY in comments (or not at all); fails if it
# appears on a real code line.
#
# grep -rnH emits a uniform "path:lineno:content" prefix (the -r flag forces a
# filename prefix even for a single file), so we must strip that prefix BEFORE
# testing whether the remaining content is a comment. The previous version
# tested the raw grep line against a comment regex and so never stripped
# anything — the path prefix always defeated the anchor.
assert_absent_code() {
  local pattern="$1"; local target="$2"; local label="$3"
  local code_hits
  code_hits=$(grep -rnHF -- "$pattern" "$target" 2>/dev/null \
    | sed -E 's/^[^:]+:[0-9]+://' \
    | grep -vE '^[[:space:]]*(//|/\*|\*|#)' \
    | grep -cF -- "$pattern")
  if [[ "${code_hits:-0}" -gt 0 ]]; then
    fail "$label (pattern '$pattern' on $code_hits non-comment line(s) in $target)"
  else
    ok "$label"
  fi
}

GRILL=dev-docs/grills/terminal
TERMDIR=src/components/Terminal

echo "── Terminal plan — Phase $PHASE DoD ──"

case "$PHASE" in
  0)
    assert_file "scripts/check-terminal-phase.sh" "WI-0.0 phase checker"
    assert_file "src/bench/terminal.bench.ts" "WI-0.1 throughput bench"
    assert_file "$GRILL/throughput-baseline.md" "WI-0.1 baseline grill doc"
    assert_file "$GRILL/channel-spike.md" "WI-0.2 Channel spike doc"
    assert_file "$GRILL/shell-integration-spike.md" "WI-0.3 shell-integration spike doc"
    assert_file "$GRILL/orphan-process-check.md" "WI-0.4 orphan-process finding"
    # Key off an unambiguous machine line, NOT the prose "PASS" in criteria.
    assert_grep_re '^VERDICT: PASS' "$GRILL/channel-spike.md" "WI-0.2 spike VERDICT: PASS"
    assert_grep_re '^VERDICT: PASS' "$GRILL/shell-integration-spike.md" "WI-0.3 spike VERDICT: PASS"
    ;;
  1)
    assert_grep "Channel" "src-tauri/src/pty.rs" "WI-1.1 Channel transport in pty.rs"
    # Plan DoD scopes this to the whole src-tauri/src tree, not just pty.rs.
    assert_absent_code 'pty:data:' "src-tauri/src" "WI-1.1 no pty:data event emit remains (src-tauri/src)"
    assert_grep_re 'Vec<u8>|&\[u8\]' "src-tauri/src/pty.rs" "WI-1.3 pty_write accepts bytes"
    ;;
  2)
    # Discriminating: registerOscHandler is absent today, so a bare match means
    # WI-2.1 actually wired an OSC handler. id 7 is matched specifically.
    assert_grep_re 'registerOscHandler\(\s*7' "$TERMDIR" "WI-2.1 OSC 7 handler registered"
    assert_grep "cwd" "$TERMDIR/fileLinkProvider.ts" "WI-2.3 live-cwd in file links"
    ;;
  3)
    assert_dir "src-tauri/resources/shell-integration" "WI-3.1 integration scripts dir"
    assert_grep "shell-integration" "src-tauri/tauri.conf.json" "WI-3.1 resources bundled"
    assert_grep "shellIntegration" "src/stores/settingsStore.ts" "WI-3.1 setting present"
    assert_grep_re 'registerOscHandler\(\s*133' "$TERMDIR" "WI-3.2 OSC 133 handler registered"
    ;;
  4)
    # WI-4.1: onActivate must carry line/col — i.e. its signature gains a 2nd
    # param (or an object arg). Today it is single-param `(filePath: string)`,
    # so a comma / brace after the open paren means the change landed.
    assert_grep_re 'onActivate:\s*\([^)]*,|onActivate:\s*\(\{' "$TERMDIR/fileLinkProvider.ts" "WI-4.1 line/col carried through onActivate"
    # WI-4.2: OSC 8 via an OSC handler or xterm linkHandler — both absent today.
    assert_grep_re 'registerOscHandler\(\s*8|linkHandler' "$TERMDIR" "WI-4.2 OSC 8 handling wired"
    ;;
  5)
    assert_grep "persist" "src/stores/uiStore.ts" "WI-5.1 terminal slice persisted"
    # WI-5.2: either scrollback restore wired OR SerializeAddon removed entirely.
    if grep -rqF "serializeAddon.serialize" "$TERMDIR" 2>/dev/null; then
      ok "WI-5.2 scrollback serialize wired"
    elif ! grep -rqF "SerializeAddon" "$TERMDIR" 2>/dev/null; then
      ok "WI-5.2 SerializeAddon removed (dead addon dropped)"
    else
      fail "WI-5.2 SerializeAddon loaded but neither serialized nor removed"
    fi
    ;;
  6)
    # Phase 6 was ABORTED per the WI-0.4 live verdict: the only force-kill
    # survivors are intentionally-detached (disown/nohup) processes, which are
    # meant to outlive the shell. DoD = the abort decision is recorded, NOT a
    # killpg implementation.
    assert_file "$GRILL/orphan-process-check.md" "WI-0.4 orphan finding recorded"
    assert_grep "PHASE 6 ABORTED" "$GRILL/orphan-process-check.md" "Phase 6 abort decision recorded"
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
