#!/usr/bin/env bash
# Fail-closed DoD checker for the AI browser navigation plan.
# Usage: bash scripts/check-ai-nav-phase.sh <0|1|2|3|4|5>

set -uo pipefail
cd "$(dirname "$0")/.."
PHASE="${1:-}"
if [[ ! "$PHASE" =~ ^[0-5]$ ]]; then
  echo "Usage: $0 <0|1|2|3|4|5>"
  exit 64
fi

failures=0
ok() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; failures=$((failures + 1)); }
file() { [[ -f "$1" ]] && ok "$2" || fail "$2 missing: $1"; }
dir() { [[ -d "$1" ]] && ok "$2" || fail "$2 missing: $1"; }
text() { grep -q -- "$1" "$2" 2>/dev/null && ok "$3" || fail "$3"; }
test_file() {
  file "$1" "$2"
  if [[ -f "$1" ]] && grep -E -q '(\.test|describe|#\[cfg\(test\)\]|#\[test\])' "$1"; then
    ok "$2 has test evidence"
  else
    fail "$2 has test evidence"
  fi
}

bash scripts/check-ai-nav-plan.sh >/dev/null || fail "plan structure gate"

case "$PHASE" in
  0)
    echo "Phase 0 — security contract and native feasibility"
    dir dev-docs/grills/ai-browser "AI browser grill directory"
    dir dev-docs/grills/ai-browser/fixtures "AI browser fixtures"
    dir dev-docs/grills/ai-browser/probes "AI browser probes"
    for spike in store-ownership navigation-policy event-broker policy-matrix; do
      file "dev-docs/grills/ai-browser/spike-${spike}.md" "spike-${spike} report"
      if [[ -f "dev-docs/grills/ai-browser/spike-${spike}.md" ]] && grep -E -q '^> Status: \*\*(PASS|PARTIAL|BLOCKED)' "dev-docs/grills/ai-browser/spike-${spike}.md"; then
        ok "spike-${spike} has an explicit status"
      else
        fail "spike-${spike} has no explicit status"
      fi
    done
    fixture_count=$(find dev-docs/grills/ai-browser/fixtures -type f 2>/dev/null | wc -l | tr -d ' ')
    [[ "$fixture_count" -ge 4 ]] && ok "fixture corpus ($fixture_count files)" || fail "fixture corpus needs at least 4 files"
    for probe in store-ownership navigation-policy event-broker; do
      file "dev-docs/grills/ai-browser/probes/${probe}.mjs" "${probe} probe"
    done
    # Phase 0 cannot pass while native-only probes are marked PARTIAL/BLOCKED.
    for report in store-ownership navigation-policy event-broker policy-matrix; do
      if grep -E -q '^> Status: \*\*PASS' "dev-docs/grills/ai-browser/spike-${report}.md"; then
        ok "spike-${report} is PASS"
      else
        fail "spike-${report} is not PASS; do not start Phase 1"
      fi
    done
    ;;
  1)
    echo "Phase 1 — authoritative state, SSRF, and isolation"
    for path in src/stores/tabStoreTypes.ts src/stores/tabStoreBrowser.ts src/stores/__tests__/aiBrowserProvenance.test.ts src-tauri/src/browser/registry.rs src-tauri/src/browser/registry_navigation.rs src-tauri/src/browser/ai_policy.rs src-tauri/src/browser/ai_policy.test.rs src-tauri/src/browser/surface.rs src-tauri/src/browser/browser_store_macos.rs; do file "$path" "$path"; done
    test_file src-tauri/src/browser/registry.test.rs "registry tests"
    test_file src-tauri/src/browser/origin_guard.test.rs "origin policy tests"
    text "AiSandbox" src-tauri/src/browser/browser_store_macos.rs "sandbox store selection"
    ;;
  2)
    echo "Phase 2 — open, navigate, wait, and discovery"
    for path in src/hooks/mcpBridge/v2/browserNavigation.ts src/hooks/mcpBridge/v2/browserHelpers.ts src/services/browser/browserEventBroker.ts src/services/browser/browserEventBroker.test.ts src/hooks/mcpBridge/v2/session.ts src/hooks/mcpBridge/v2/types.ts vmark-mcp-server/src/tools/browser.ts vmark-mcp-server/src/bridge/core-types.ts; do file "$path" "$path"; done
    text "vmark.browser.open" src/hooks/mcpBridge/v2/dispatch.ts "open route"
    text "vmark.browser.navigate" src/hooks/mcpBridge/v2/dispatch.ts "navigate route"
    text "vmark.browser.wait" src/hooks/mcpBridge/v2/dispatch.ts "wait route"
    test_file src/hooks/mcpBridge/v2/__tests__/dispatch.test.ts "dispatch tests"
    ;;
  3)
    echo "Phase 3 — shared posture and attachment approvals"
    for path in src/stores/settingsTypes/workspace.ts src/stores/settingsStore/persistGuards.ts src/pages/settings/AdvancedSettings.tsx src/services/browser/browserAiPolicySync.ts src/stores/browserApprovalStore.ts src/components/Browser/BrowserApprovalDialog.tsx src-tauri/src/browser/commands_auth.rs; do file "$path" "$path"; done
    text "aiSession" src/stores/settingsStore.browser.test.ts "posture settings tests"
    text "browser_ai_attach" src-tauri/src/browser/commands_auth.rs "human attachment route"
    ;;
  4)
    echo "Phase 4 — concurrency, windows, persistence, and hardening"
    for path in src/services/browser/browserEventBroker.ts src-tauri/src/browser/nav_payloads_macos.rs src-tauri/src/browser/nav_registry_macos.rs src-tauri/src/browser/teardown.rs src/services/persistence/sessionTabs.ts src/hooks/mcpBridge/v2/session.ts; do file "$path" "$path"; done
    text "navigationId" src/services/browser/browserEventBroker.test.ts "ticket race tests"
    text "UNSUPPORTED_PLATFORM" src-tauri/src/browser/surface.rs "non-macOS stub"
    ;;
  5)
    echo "Phase 5 — documentation, E2E, performance, and release readiness"
    for path in dev-docs/grills/ai-browser/e2e-checklist.md dev-docs/grills/ai-browser/performance-budget.md dev-docs/grills/ai-browser/limitations.md; do file "$path" "$path"; done
    text "tauri_driver_session" dev-docs/grills/ai-browser/e2e-checklist.md "Tauri MCP E2E procedure"
    text "12,000" dev-docs/grills/ai-browser/performance-budget.md "wait budget"
    text "DNS rebinding" dev-docs/grills/ai-browser/limitations.md "residual SSRF limitation"
    ;;
esac

if (( failures > 0 )); then
  echo "AI browser phase $PHASE gate failed: $failures check(s) failed."
  exit 1
fi
echo "AI browser phase $PHASE gate passed."
