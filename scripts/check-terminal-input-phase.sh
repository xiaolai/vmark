#!/usr/bin/env bash
#
# DoD checker for the Terminal Input Channel-Ownership migration.
# Plan:  dev-docs/plans/20260722-terminal-input-channel-ownership.md
# Audit: dev-docs/deep-researches/20260721-terminal-input-architecture-audit.md
#
# Usage: bash scripts/check-terminal-input-phase.sh <phase-number>
#
# Structural (file-presence + grep) assertions only. "Gates green"
# (pnpm check:all) and live/human IME checks are verified separately.
# Exit 0 if all pass, 1 if any fail.

set -uo pipefail
cd "$(dirname "$0")/.."

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase-number>"
  echo "  0  Trace harness + measurement"
  echo "  1  Safe structural fixes (no arbitration change)"
  echo "  2  Channel Ownership behind a flag"
  echo "  3  Collapse to a single writer"
  echo "  4  Delete the proxy guards + flip default"
  echo "  5  Test-estate repair + mutation gate"
  exit 64
fi

PASS=0; FAIL=0; FAIL_DETAIL=()
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); FAIL_DETAIL+=("$1"); }

# assert_grep <fixed-pattern> <file-or-dir> <label>
assert_grep()   { if grep -rqF -- "$1" "$2" 2>/dev/null; then ok "$3"; else fail "$3 (pattern '$1' not in $2)"; fi; }
# assert_absent <fixed-pattern> <file> <label>  — used to prove a guard was deleted
assert_absent() { if grep -rqF -- "$1" "$2" 2>/dev/null; then fail "$3 (pattern '$1' STILL in $2)"; else ok "$3"; fi; }
assert_file()   { if [[ -f "$1" ]]; then ok "$2"; else fail "$2 ($1 missing)"; fi; }
assert_nofile() { if [[ -f "$1" ]]; then fail "$2 ($1 still present)"; else ok "$2"; fi; }

TDIR="src/components/Terminal"
SIC="$TDIR/setupImeComposition.ts"
CTI="$TDIR/createTerminalInstance.ts"
TSW="$TDIR/terminalSessionInputWiring.ts"
TKH="$TDIR/terminalKeyHandler.ts"
REG="$TDIR/terminalSessionRegistry.ts"
PTY="src/lib/pty.ts"
SYS="src/stores/settingsTypes/system.ts"

case "$PHASE" in
  0)
    assert_file "$TDIR/terminalInputTrace.ts"      "WI-0.1 trace recorder present"
    assert_file "$TDIR/traceReplay.ts"             "WI-0.1 replay harness present"
    assert_file "$TDIR/traceReplay.test.ts"        "WI-0.1 replay tests present"
    [[ -d "$TDIR/__fixtures__/traces" ]] && ok "WI-0.3 trace fixtures dir present" \
      || fail "WI-0.3 trace fixtures dir missing ($TDIR/__fixtures__/traces)"
    ;;
  1)
    assert_absent ".xterm-helper-textarea" "$SIC"  "WI-1.1 internal-class lookup removed"
    # Resolution + validation live in resolveHelperTextarea.ts (extracted to keep
    # createTerminalInstance under the 300-line limit); the caller invokes it.
    assert_grep "term.textarea"          "$TDIR/resolveHelperTextarea.ts" "WI-1.1 public textarea getter used"
    assert_grep "resolveHelperTextarea"  "$CTI"    "WI-1.1 caller uses the resolver"
    assert_grep "container.contains"     "$TDIR/resolveHelperTextarea.ts" "WI-1.2 container-anchor invariant asserted"
    assert_absent "run before xterm's own input handler" "$SIC" "WI-1.2 false ordering comment removed"
    # WI-1.3: the destroy-guard must be inside write() specifically. `_destroyed`
    # already appears in kill/resize/close, so require the write-guard test name.
    assert_grep "no-op after destroy" "src/lib/pty.test.ts" "WI-1.3 write-after-destroy test present"
    # WI-1.4: require the new grace-window regression test by name, not a bare
    # stopPropagation (which already exists for Ctrl+C).
    assert_grep "during the grace window" "$TDIR/terminalKeyHandler.test.ts" "WI-1.4 toggle-during-grace regression test present"
    ;;
  2)
    GATE="$TDIR/setupImeCompositionGate.ts"
    assert_grep "inputGate"              "$SYS"    "WI-2.1 inputGate in TerminalSettings"
    assert_grep "inputGate"              "src/stores/settingsStore/defaults.ts" "WI-2.1 inputGate default set"
    # inputGate is a string enum, not a numeric range — validated by the
    # consumer's `=== \"gate\"` fail-safe, not clamp.ts. Assert the store test.
    assert_grep "inputGate"              "src/stores/__tests__/settingsStore.test.ts" "WI-2.1 inputGate store test present"
    assert_grep "inputGate"              "$TDIR/useTerminalSessions.ts" "WI-2.1 flag flows from store to instance"
    assert_file "$GATE"                            "WI-2.2 gate module present"
    assert_grep "stopPropagation"        "$GATE"   "WI-2.2 T1 container input stopPropagation"
    assert_grep "gateMode"               "$TKH"    "WI-2.3 T2 gate branch in key handler"
    assert_grep 'textarea.value = ""'    "$GATE"   "WI-2.4 T3 synchronous textarea clear on compositionend"
    # Verified in the real-WebKit tier (jsdom cannot — plan Q1/Q3).
    assert_file "$TDIR/setupImeCompositionGate.webkit.test.ts" "WI-2.x gate webkit tests present"
    assert_file "$TDIR/browserTier.smoke.webkit.test.ts"       "browser tier smoke present"
    ;;
  3)
    # Single writer per keystroke: gate mode routes IME commits straight to the
    # PTY (one writer, since T1 severs xterm's input path) — not term.input,
    # which would re-enter the onData composing-guard. resolveCommit is the pure
    # decision replacing the five legacy early-returns.
    assert_grep "onCompositionCommit"    "$TDIR/setupImeCompositionGate.ts" "WI-3.1 gate commit path present"
    assert_file "$TDIR/resolveCommit.ts"          "WI-3.2 pure resolveCommit module present"
    assert_file "$TDIR/resolveCommit.test.ts"     "WI-3.2 resolveCommit table tests present"
    assert_grep "resolveCommit"          "$TDIR/setupImeCompositionGate.ts" "WI-3.2 gate uses resolveCommit"
    ;;
  4)
    assert_absent "IME_COMPOSITION_GRACE_MS" "$SIC" "WI-4.1 grace constant deleted"
    assert_absent "IME_DEDUP_WINDOW_MS"    "$CTI"   "WI-4.1 dedup window constant deleted"
    assert_absent "lastCommittedConsumed"  "$TSW"   "WI-4.1 Path A consumed-prefix deleted"
    assert_grep '"gate"'                   "src/stores/settingsStore/defaults.ts" "WI-4.1 default flipped to gate"
    ;;
  5)
    assert_nofile "$TDIR/compositionGuard.test.ts" "WI-5.1 drifted compositionGuard suite deleted"
    assert_absent "await Promise.resolve()" "$TDIR/terminalSessionInputWiring.test.ts" "WI-5.1 false-model microtask sim removed"
    assert_grep "src/components/Terminal"  "stryker.config.json" "WI-5.2 terminal in mutation scope"
    ;;
  *)
    echo "Unknown phase: $PHASE"; exit 64 ;;
esac

echo ""
echo "Phase $PHASE: $PASS passed, $FAIL failed."
if [[ $FAIL -gt 0 ]]; then
  printf '  - %s\n' "${FAIL_DETAIL[@]}"
  exit 1
fi
exit 0
