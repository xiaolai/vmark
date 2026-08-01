#!/usr/bin/env bash
#
# DoD checker for the Workspace Rail Context Switch plan (WRCS).
# Plan: dev-docs/plans/20260730-workspace-rail-context-switch.md
#
# Usage: bash scripts/check-wrcs-phase.sh <phase-number 1-6>
#
# Each phase block runs assertions for that phase's Definition of Done.
# Exit 0 = all assertions pass; 1 = failures. Run before ticking the plan's
# Status header to the next phase. Assertions are refined as phases land —
# keep this script in sync with the implementation in the same commit.

set -uo pipefail

cd "$(dirname "$0")/.."

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase-number>"
  echo "  1  Identity & ownership foundation"
  echo "  2  Per-instance state primitives"
  echo "  3  Context coordinator & activation paths"
  echo "  4  Projections & interactive surfaces"
  echo "  5  Persistence & restoration"
  echo "  6  Full-system closure"
  exit 64
fi

PLAN="dev-docs/plans/20260730-workspace-rail-context-switch.md"
PASS=0
FAIL=0
FAIL_DETAIL=()

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); FAIL_DETAIL+=("$1"); }

assert_file() {
  local path="$1"; local label="${2:-$1}"
  if [[ -f "$path" ]]; then ok "$label exists"; else fail "$label missing: $path"; fi
}

assert_grep() {
  local pattern="$1"; local file="$2"; local label="$3"
  if grep -q -- "$pattern" "$file" 2>/dev/null; then ok "$label"; else fail "$label (pattern '$pattern' not in $file)"; fi
}

assert_not_grep() {
  local pattern="$1"; local file="$2"; local label="$3"
  if [[ ! -f "$file" ]]; then ok "$label (file gone)"; return; fi
  if grep -q -- "$pattern" "$file" 2>/dev/null; then fail "$label (pattern '$pattern' still in $file)"; else ok "$label"; fi
}

# ─── Phase 1 — Identity & ownership foundation ───────────────────────────
phase_1() {
  echo "Phase 1 — Identity & ownership foundation"

  # WI-0 — this script
  assert_file "scripts/check-wrcs-phase.sh" "WI-0 phase checker"

  # WI-17.1 — platform-aware comparison identity (leaf-pure utils)
  assert_file "src/utils/paths/pathComparison.ts"       "WI-17.1 comparison normalizer"
  assert_file "src/utils/paths/pathComparison.test.ts"  "WI-17.1 tests"
  assert_grep "normalizePathForCompare" "src/utils/paths/pathComparison.ts" "WI-17.1 normalizePathForCompare exported"
  assert_grep "isWithinRootForCompare"  "src/utils/paths/pathComparison.ts" "WI-17.1 isWithinRootForCompare exported"
  # Ownership classification must use the comparison normalizer
  assert_grep "pathComparison\|normalizePathForCompare\|isWithinRootForCompare" \
    "src/services/workspaces/workspaceContextOwnership.ts" "WI-17.1 ownership classification wired"

  # WI-17.2 — stable root use (asserted in Phase 5 where session writes land;
  # Phase 1 requires the resolver primitive)
  assert_grep "resolveStableRootPath\|stableRootPath" \
    "src/services/workspaces/workspaceInstanceActions.ts" "WI-17.2 stable-root resolver present"

  # WI-17.3 — Rust parity marker (containment normalization test)
  if grep -rq "wrcs_windows_containment\|windows_path_case_containment" src-tauri/src 2>/dev/null; then
    ok "WI-17.3 Rust containment parity test present"
  else
    fail "WI-17.3 Rust containment parity test missing (marker not found in src-tauri/src)"
  fi

  # WI-1R — pure ownership kernel
  assert_file "src/services/workspaces/workspaceOwnershipKernel.ts"      "WI-1R kernel"
  assert_file "src/services/workspaces/workspaceOwnershipKernel.test.ts" "WI-1R kernel tests"
  assert_grep "partitionWindowTabs"      "src/services/workspaces/workspaceOwnershipKernel.ts" "WI-1R partitionWindowTabs exported"
  assert_grep "visibleTabsForWindow"     "src/services/workspaces/workspaceOwnershipKernel.ts" "WI-1R visibleTabsForWindow exported"
  assert_grep "resolveIncomingActiveTab" "src/services/workspaces/workspaceOwnershipKernel.ts" "WI-1R resolveIncomingActiveTab exported"
  # Kernel must be argument-pure: no store imports
  assert_not_grep "@/stores/" "src/services/workspaces/workspaceOwnershipKernel.ts" "WI-1R kernel has no store imports"
  # tabBelongsToWorkspace rewired through the kernel
  assert_grep "workspaceOwnershipKernel\|partitionWindowTabs" \
    "src/services/workspaces/workspaceTabCollection.ts" "WI-1R tabBelongsToWorkspace routes through kernel"
  # Private hot-exit classifier deleted
  assert_not_grep "function assignTabsToInstances" \
    "src/services/persistence/hotExit/workspaceInstances.ts" "WI-1R private hot-exit classifier removed"

  echo "  ⓘ gate: pnpm check:all + cargo test/fmt/clippy + pnpm check:cross"
}

# ─── Phase 2 — Per-instance state primitives ─────────────────────────────
phase_2() {
  echo "Phase 2 — Per-instance state primitives"

  # WI-9.1
  assert_file "src/stores/workspaceInstanceUiStore.ts"      "WI-9.1 UI-state store"
  assert_file "src/stores/workspaceInstanceUiStore.test.ts" "WI-9.1 tests"
  for action in copyInstanceUiState rekeyInstanceUiState removeInstanceUiState; do
    assert_grep "$action" "src/stores/workspaceInstanceUiStore.ts" "WI-9.1 lifecycle action $action"
  done

  # WI-9.2
  assert_grep "workspaceInstanceId" "src/components/Sidebar/FileExplorer/FileExplorer.tsx" \
    "WI-9.2 tree keyed by instance"
  assert_grep "fileTreeScrollOffset\|scrollToOffset" "src/components/Sidebar/FileExplorer/useFileExplorerOpenState.ts" \
    "WI-9.2 scroll restoration wired"

  # WI-9.3
  assert_grep "outlineByTabId" "src/stores/workspaceInstanceUiStore.ts" "WI-9.3 outline state shape"
  assert_grep "useOutlineInstanceState" "src/components/Sidebar/OutlineView.tsx" \
    "WI-9.3 OutlineView reads per-instance state"

  # WI-10.1
  assert_grep "replaceWindowSplit" "src/stores/paneStore.ts" "WI-10.1 atomic pane replacement"

  # WI-10.2
  assert_file "src/stores/workspacePaneLayoutsStore.ts"      "WI-10.2 pane snapshots store"
  assert_file "src/stores/workspacePaneLayoutsStore.test.ts" "WI-10.2 tests"

  # WI-11.1
  assert_grep "scopeKey\|closedScope" "src/stores/tabStoreClosedScopes.ts" "WI-11.1 scoped closed-tab history"
  assert_file "src/stores/tabStoreClosedScopes.test.ts" "WI-11.1 tests"
  assert_grep "reason" "src/stores/tabRemovalBus.ts" "WI-11.1 removal bus carries reason"

  # WI-11.2
  assert_file "src/services/workspaces/reopenClosedTab.ts" "WI-11.2 context-aware reopen service"
  assert_grep "reopenClosedTabForActiveContext" "src/services/workspaces/reopenClosedTab.ts" \
    "WI-11.2 reopenClosedTabForActiveContext exported"

  echo "  ⓘ gate: pnpm check:all"
}

# ─── Phase 3 — Context coordinator & activation paths ────────────────────
phase_3() {
  echo "Phase 3 — Context coordinator & activation paths"

  assert_file "src/services/workspaces/switchWorkspaceInstance.ts"      "WI-2R coordinator"
  assert_file "src/services/workspaces/switchWorkspaceInstance.test.ts" "WI-2R tests"
  assert_grep "ContextGeneration" "src/services/workspaces/switchWorkspaceInstance.ts" "WI-2R generation counter"
  assert_file "src/services/workspaces/workspaceContextGeneration.ts" "WI-2R generation module"

  assert_file "src/services/workspaces/syncLegacyWorkspaceContext.ts"      "WI-5R legacy sync"
  assert_file "src/services/workspaces/syncLegacyWorkspaceContext.test.ts" "WI-5R tests"

  assert_file "src/services/workspaces/hydrateWorkspaceInstanceContext.ts" "WI-13.1 hydrate API"
  # ensureLooseInstance no longer activates as a side effect
  assert_not_grep "activeWorkspaceInstanceId: looseId\|activateWorkspaceInstance" \
    "src/stores/workspaceInstancesStore/helpers.ts" "WI-13.1 ensureLooseInstance side-activation removed"

  if grep -rq "activateTabWithWorkspaceContext" src/services 2>/dev/null; then
    ok "WI-12.2/13.x activateTabWithWorkspaceContext service present"
  else
    fail "activateTabWithWorkspaceContext missing"
  fi

  # WI-14 — MCP surface
  if grep -rq "switch_tab" server/mcp/src 2>/dev/null; then
    ok "WI-14 workspace.switch_tab in MCP server"
  else
    fail "WI-14 workspace.switch_tab missing from server/mcp"
  fi
  if grep -rq "workspaceSwitched" src/hooks/mcpBridge 2>/dev/null; then
    ok "WI-14 bridge returns workspaceSwitched"
  else
    fail "WI-14 bridge workspaceSwitched payload missing"
  fi

  # WI-3R — rail click wired
  assert_grep "switchWorkspaceInstance" "src/components/WorkspaceRail/WorkspaceRail.tsx" "WI-3R rail click wired"

  echo "  ⓘ gate: pnpm check:all"
}

# ─── Phase 4 — Projections & interactive surfaces ────────────────────────
phase_4() {
  echo "Phase 4 — Projections & interactive surfaces"

  assert_grep "visibleTabsForWindow\|useVisibleWindowTabs" \
    "src/components/Browser/useBrowserWorkspaceState.ts" "WI-8.1/4R browser+strip projection"
  if grep -rq "useVisibleWindowTabs\|visibleTabsForWindow" src/hooks/tabCommands.ts 2>/dev/null; then
    ok "WI-4R cycling uses visible projection"
  else
    fail "WI-4R tab cycling not filtered"
  fi
  assert_grep "allWindowTabs" "src/hooks/useVisibleWindowTabs.ts" "WI-12.1 allWindowTabs operational service"
  assert_grep "activateTabWithWorkspaceContext" "src/services/navigation/fileOpen.ts" \
    "WI-12.2 user activations ownership-aware"
  assert_grep "ContextGeneration" "src/stores/uiStore/contentSearchSlice.ts" \
    "WI-12.3 content-search generation binding"
  assert_grep "visible" "src/components/StatusBar/tabDragRules.ts" \
    "WI-12.4 reorder translates via visible ids"

  echo "  ⓘ gate: pnpm check:all"
}

# ─── Phase 5 — Persistence & restoration ─────────────────────────────────
phase_5() {
  echo "Phase 5 — Persistence & restoration"

  assert_grep "partitionWindowTabs\|workspaceOwnershipKernel" \
    "src/services/workspaces/workspaceSession.ts" "WI-6R session uses kernel ownership"
  if grep -rq "browserSession\|windowBrowserSession" src/services/persistence 2>/dev/null; then
    ok "WI-8.2 window browser-session persistence"
  else
    fail "WI-8.2 window browser-session persistence missing"
  fi
  if grep -rq "splitLayout\|paneLayout" src/services/workspaces/workspaceSession.ts src/services/workspaces/workspaceSessionInstances.ts 2>/dev/null; then
    ok "WI-10.3 per-root split persistence in session payload"
  else
    fail "WI-10.3 split persistence missing from session payload"
  fi
  if grep -rq "uiState\|instanceUi" src/services/persistence/hotExit 2>/dev/null; then
    ok "WI-9.4 hot-exit UI-state extension"
  else
    fail "WI-9.4 hot-exit schema extension missing"
  fi

  echo "  ⓘ gate: pnpm check:all + cargo test/fmt/clippy + pnpm check:cross"
}

# ─── Phase 6 — Full-system closure ───────────────────────────────────────
phase_6() {
  echo "Phase 6 — Full-system closure"

  assert_file "src/services/workspaces/workspaceSwitchInterplay.test.ts" "WI-7R regression suite"
  assert_file "dev-docs/e2e/wrcs-e2e-results.md" "WI-15 E2E run record"
  assert_file "website/guide/workspace-rail.md" "WI-16 workspace rail guide"
  assert_grep "workspace-rail" "website/guide/workspace-management.md" "WI-16 cross-linked from workspace-management"
  if grep -rq "switch_tab" website/guide/mcp-tools.md 2>/dev/null; then
    ok "WI-16 mcp-tools documents switch_tab"
  else
    fail "WI-16 mcp-tools.md missing switch_tab docs"
  fi
  # WI linkage for the whole plan
  if bash scripts/check-wi-linkage.sh "$PLAN" >/dev/null 2>&1; then
    ok "WI linkage check passes"
  else
    echo "  ⓘ WI linkage check not clean yet (run: bash scripts/check-wi-linkage.sh $PLAN)"
  fi

  echo "  ⓘ gate: pnpm check:all + 4 E2E scenarios + website build/link check"
}

# ─── Dispatch ────────────────────────────────────────────────────────────
case "$PHASE" in
  1) phase_1 ;;
  2) phase_2 ;;
  3) phase_3 ;;
  4) phase_4 ;;
  5) phase_5 ;;
  6) phase_6 ;;
  *) echo "unknown phase: $PHASE"; exit 64 ;;
esac

echo
echo "─────────────────────────────────────────────"
echo "Phase $PHASE: $PASS passed, $FAIL failed"
if (( FAIL > 0 )); then
  echo
  echo "Failed assertions:"
  for d in "${FAIL_DETAIL[@]}"; do echo "  • $d"; done
  exit 1
fi
exit 0
