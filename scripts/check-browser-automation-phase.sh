#!/usr/bin/env bash
#
# DoD checker for the Browser Automation — Richer Perception & Interaction plan.
# Plan: dev-docs/plans/20260715-browser-automation-perception.md
#
# Usage: bash scripts/check-browser-automation-phase.sh <phase-number> [--full]
#
#   --full  also run the heavyweight gates a phase's DoD names but that the
#           pre-push hook normally owns (`pnpm check:all`, website build).
#           Without it those rows report SKIP, never PASS.
#
# Exit codes:
#   0  every assertion for the phase passed
#   1  one or more assertions failed
#   2  bad usage (no/unknown phase)
#   3  phase recognized but its assertions are not authored yet (fail closed)
#
# Governance (.claude/rules/60-ai-governance.md §3): a phase gate must be
# machine-checkable and RUN THE TESTS its DoD names — asserting a file exists
# proves nothing about whether it works. Un-authored phases fail closed (exit 3);
# each phase block below is filled in only when that phase's code lands.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

GRILLS="dev-docs/grills/browser-automation"
PLAN="dev-docs/plans/20260715-browser-automation-perception.md"

PHASE=""
FULL=0
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    -*)
      echo "Unknown flag: $arg" >&2
      echo "Usage: $0 <phase-number> [--full]" >&2
      exit 2
      ;;
    *)
      if [[ -n "$PHASE" ]]; then
        echo "Unexpected extra argument: '$arg' (phase already set to '$PHASE')" >&2
        exit 2
      fi
      PHASE="$arg"
      ;;
  esac
done

FAIL=0

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=""; C_BAD=""; C_DIM=""; C_OFF=""
fi

pass() { printf '  %sPASS%s %s\n' "$C_OK" "$C_OFF" "$1"; }
fail() { printf '  %sFAIL%s %s\n' "$C_BAD" "$C_OFF" "$1"; FAIL=1; }
skip() { printf '  %sSKIP%s %s\n' "$C_DIM" "$C_OFF" "$1"; }

# Extract the single structured `Verdict:` token from a spike write-up, or an
# ERROR:<reason> sentinel. Mirrors scripts/check-browser-phase.sh.
spike_verdict() {
  local file="$1" lines count raw tok
  lines=$(grep -iE '^[[:space:]>*_]*\*{0,2}Verdict\*{0,2}[[:space:]]*:' "$file" 2>/dev/null)
  count=$(printf '%s' "$lines" | grep -c .)
  if [[ "$count" -eq 0 ]]; then echo "ERROR:no-verdict-line"; return; fi
  if [[ "$count" -gt 1 ]]; then echo "ERROR:$count-conflicting-verdict-lines"; return; fi
  raw=$(printf '%s' "$lines" | sed -E 's/.*[Vv][Ee][Rr][Dd][Ii][Cc][Tt][*_[:space:]]*:[*_[:space:]]*//')
  tok=$(printf '%s' "$raw" | tr '[:lower:]' '[:upper:]')
  case "$tok" in
    PASS|PASS[!A-Z0-9_-]*)         echo "PASS" ;;
    FAIL|FAIL[!A-Z0-9_-]*)         echo "FAIL" ;;
    REFUTED|REFUTED[!A-Z0-9_-]*)   echo "REFUTED" ;;
    *)                             echo "ERROR:unrecognized-verdict" ;;
  esac
}

# A spike write-up passes when it exists and carries an accepted verdict token.
check_spike() {
  local file="$1" desc="$2"; shift 2
  local accepted="$*" verdict
  if [[ ! -f "$file" ]]; then fail "spike write-up missing ($file) — $desc"; return; fi
  verdict=$(spike_verdict "$file")
  if [[ "$verdict" == ERROR:* ]]; then
    fail "$file verdict unusable (${verdict#ERROR:}) — $desc"; return
  fi
  if [[ " $accepted " == *" $verdict "* ]]; then
    pass "$(basename "$file") $verdict — $desc"
  else
    fail "$(basename "$file") verdict is $verdict; accepts only [$accepted] — $desc"
  fi
}

# A runnable probe passes when the node script exits 0.
run_probe() {
  local file="$1" label="$2"
  if [[ ! -f "$file" ]]; then fail "$label — probe missing ($file)"; return; fi
  if node "$file" >/dev/null 2>&1; then
    pass "$label — $file green"
  else
    fail "$label — $file FAILING (rerun: node $file)"
  fi
}

# The plan cites a prior spike for an already-discharged risk. Assert the
# citation is really in the plan, so a reused-evidence claim can't rot silently.
check_cites() {
  local needle="$1" label="$2"
  if grep -qF "$needle" "$PLAN" 2>/dev/null; then
    pass "$label (plan cites $needle)"
  else
    fail "$label — plan does not cite $needle"
  fi
}

run_vitest() {
  local file="$1" label="$2"
  if [[ ! -f "$file" ]]; then fail "$label — test file missing ($file)"; return; fi
  if pnpm exec vitest run "$file" >/dev/null 2>&1; then
    pass "$label — $file green"
  else
    fail "$label — $file FAILING (rerun: pnpm exec vitest run $file)"
  fi
}

run_cargo() {
  local filter="$1" label="$2"
  if cargo test --manifest-path src-tauri/Cargo.toml --lib "$filter" >/dev/null 2>&1; then
    pass "$label — cargo --lib $filter green"
  else
    fail "$label — cargo --lib $filter FAILING (rerun: cargo test --manifest-path src-tauri/Cargo.toml --lib $filter)"
  fi
}

run_script() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label (rerun: $*)"; fi
}

# check:cross soft-skips when the mingw toolchain is absent (see the plan's
# cross-platform note). A hard FAIL here would punish a mac-only dev box.
run_cross() {
  local out
  out=$(bash scripts/check-cross-target.sh 2>&1)
  if [[ $? -eq 0 ]]; then
    pass "check:cross — Windows cross-target compile green (or soft-skipped)"
  else
    fail "check:cross — Windows cross-target compile FAILING"
    printf '%s\n' "$out" | tail -5
  fi
}

case "$PHASE" in
  0)
    echo "Phase 0 — feasibility probes (structured verdict + runnable evidence):"
    check_spike "$GRILLS/SPIKE-P0.3-refs.md"    "WI-P0.3 ref stability across repeated reads" PASS
    check_spike "$GRILLS/SPIKE-P0.4-waitfor.md" "WI-P0.4 wait_for resolves + tears down"      PASS
    echo "Phase 0 — probes actually run green:"
    run_probe "$GRILLS/probe-refs.mjs"    "WI-P0.3 probe"
    run_probe "$GRILLS/probe-waitfor.mjs" "WI-P0.4 probe"
    echo "Phase 0 — prior spikes cited for already-discharged risk:"
    check_cites "SPIKE-5" "WI-P0.1 (takeSnapshot) reuses screenshot spike evidence"
    check_cites "SPIKE-3" "WI-P0.2 (synthetic input) reuses the trusted-input spike"
    ;;

  1)
    echo "Phase 1 — visual perception (screenshot). Running the DoD suites:"
    run_vitest src/hooks/mcpBridge/v2/__tests__/browserScreenshot.test.ts "WI-P1.2 screenshot handler (gate, attachment, redaction)"
    run_cargo commands_auth "WI-P1.1 shared driver-auth gate (browser_screenshot + browser_eval)"
    run_script "WI-P1.3 sidecar browser tool (screenshot action)" pnpm --dir vmark-mcp-server exec vitest run __tests__/unit/tools/browser.test.ts
    run_script "WI-linkage for phase P1" bash scripts/check-wi-linkage.sh "$PLAN" --phase=P1
    run_cross
    if [[ "$FULL" -eq 1 ]]; then
      run_script "pnpm check:all" pnpm check:all
    else
      skip "pnpm check:all — not run (pre-push gate owns it; re-run with --full)"
    fi
    echo "  NOTE: live E2E (capture a real JPEG of an AI tab via Tauri MCP, and no"
    echo "        occlusion/freeze disturbance) is verified manually in a session."
    ;;

  2|3|4|5|6|7)
    echo "Phase $PHASE — assertions not yet authored."
    echo "  (Template: copy the Phase-1 block — run_vitest/run_cargo/run_script rows"
    echo "   mirroring that phase's DoD line in $PLAN, plus WI-linkage --phase=P$PHASE.)"
    echo "Phase $PHASE: NOT IMPLEMENTED — treated as not passing."
    exit 3
    ;;

  *)
    echo "Usage: $0 <phase-number> [--full]"
    echo "  0  Feasibility probes (ref stability, wait_for teardown)"
    echo "  1  Visual perception (screenshot)"
    echo "  2  Stable element handles (ref-IDs)"
    echo "  3  Condition waits (wait_for)"
    echo "  4  Richer interaction (scroll, key)"
    echo "  5  Scripted power tools (query, style, execute_js)"
    echo "  6  Session & storage management"
    echo "  7  Observation (stretch: console)"
    exit 2
    ;;
esac

echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "Phase $PHASE: all assertions passed."
  exit 0
fi
echo "Phase $PHASE: one or more assertions FAILED."
exit 1
