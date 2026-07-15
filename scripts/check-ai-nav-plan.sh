#!/usr/bin/env bash
# Structural plan gate for the AI browser navigation implementation.
# Usage: bash scripts/check-ai-nav-plan.sh [plan-file]

set -uo pipefail
cd "$(dirname "$0")/.."

PLAN="${1:-dev-docs/plans/20260714-ai-browser-navigation.md}"
if [[ ! -f "$PLAN" ]]; then
  echo "✗ plan not found: $PLAN"
  exit 1
fi

failures=0
check() {
  local description="$1"; shift
  if "$@"; then
    echo "  ✓ $description"
  else
    echo "  ✗ $description"
    failures=$((failures + 1))
  fi
}

wi_count=$(grep -E -c '^#### WI-N[0-5]\.[0-9]+:' "$PLAN" 2>/dev/null || true)
check "30 WI-N work items are declared" test "$wi_count" -eq 30
for rule in R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 R11 R12 R13; do
  check "$rule is declared" grep -q "^### $rule" "$PLAN"
done
for action in read act open navigate wait; do
  check "browser action '$action' is in the contract" grep -q -- "$action" "$PLAN"
done
for route in vmark.browser.read vmark.browser.act vmark.browser.open vmark.browser.navigate vmark.browser.wait; do
  check "route '$route' is declared" grep -q "$route" "$PLAN"
done
check "browser.enabled is the feature gate" grep -q "browser.enabled" "$PLAN"
check "sandbox is the default posture" grep -q "Sandbox is the default" "$PLAN"
check "DNS rebinding limitation is explicit" grep -qi "DNS-rebinding" "$PLAN"
check "AI tabs are not persisted by default" grep -q "AI-created tabs and their ephemeral state are not persisted" "$PLAN"

if (( failures > 0 )); then
  echo "AI browser plan gate failed: $failures check(s) failed."
  exit 1
fi
echo "AI browser plan gate passed."
