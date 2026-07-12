#!/usr/bin/env bash
#
# DoD checker for the Embedded Browser / Site Plugins / Web Workflows plan.
# Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md
#
# Usage: bash scripts/check-browser-phase.sh <phase-number>
#
# Exit 0 if all assertions for the phase pass, 1 otherwise. Run before ticking
# the plan's Status header to the next phase.
#
# Phase 0: seven feasibility spikes present and PASS-marked; the no-bridge probe
#          (SPIKE-1) is the blocking one — a FAIL there halts the whole plan.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PHASE="${1:-}"
GRILLS="dev-docs/grills/embedded-browser"
FAIL=0

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=1; }

# A spike write-up "passes" when it exists and its Verdict line reads PASS
# (case-insensitive). A stub marked NOT RUN correctly does not pass.
check_spike() {
  local n="$1"
  local desc="$2"
  local file="$GRILLS/SPIKE-$n.md"
  if [[ ! -f "$file" ]]; then
    fail "SPIKE-$n write-up missing ($file) — $desc"
    return
  fi
  # Match a real verdict LINE: optional markdown markers, then "Verdict",
  # emphasis/colon/space, then PASS as a whole word. Anchored to line start so
  # "NotVerdict: PASS" or "Verdict: PASS_FAIL" cannot false-positive.
  if grep -qiE '^[[:space:]>*]*Verdict[:* ]+PASS([^A-Za-z0-9_-]|$)' "$file"; then
    pass "SPIKE-$n PASS — $desc"
  else
    fail "SPIKE-$n present but not PASS-marked — $desc"
  fi
}

case "$PHASE" in
  0)
    echo "Phase 0 — feasibility spikes:"
    check_spike 1 "owned native webview + NO-BRIDGE security probe (BLOCKING)"
    check_spike 2 "sync + async eval, init scripts, dependency matrix"
    check_spike 3 "screenshot + trusted-input reality check"
    check_spike 4 "profile persistence + isolation floor"
    check_spike 5 "occlusion (freeze-to-snapshot) reality check"
    check_spike 6 "Windows + Linux embedding + Windows isolated world"
    check_spike 7 "publishing probe + CSRF/session reality"
    ;;
  1)
    echo "Phase 1 — browser surface (foundation):"
    # Pure-logic core that gates nothing native — must be present WITH its tests.
    for src in \
      src/lib/browser/origin/originGuard.ts \
      src/lib/sites/registry.ts \
      src/lib/browser/workflow/parser.ts; do
      test="${src%.ts}.test.ts"
      if [[ -f "$src" && -f "$test" ]]; then
        pass "$src present with sibling test"
      else
        fail "$src or its sibling test ($test) missing"
      fi
    done
    echo "  NOTE: native surface WIs (1.2/1.4/1.5/1.6/1.7/1.8/1.9) require the"
    echo "        Phase 0 spikes to PASS first and are verified in a live Tauri"
    echo "        session, not by this script."
    ;;
  2|3|4|5)
    # Fail closed: an un-authored phase must NOT report success.
    echo "Phase $PHASE — assertions not yet authored."
    echo "  (Template: copy a Phase-0/1 block and add per-WI checks.)"
    echo "Phase $PHASE: NOT IMPLEMENTED — treated as not passing."
    exit 3
    ;;
  *)
    echo "Usage: $0 <phase-number>"
    echo "  0  Feasibility spikes (7)"
    echo "  1  Browser surface (foundation)"
    echo "  2  Driver + automation agent"
    echo "  3  Site plugin system"
    echo "  4  Web workflow engine"
    echo "  5  Polish / cross-platform / a11y"
    exit 2
    ;;
esac

if [[ "$FAIL" -eq 0 ]]; then
  echo "Phase $PHASE: all assertions passed."
  exit 0
fi
echo "Phase $PHASE: one or more assertions FAILED."
exit 1
