#!/usr/bin/env bash
#
# DoD checker for the per-workspace-instance terminal sessions plan (WI-TS).
# Plan: .claude/tdd-guardian/20260831-terminal-per-instance-sessions.md
#
# Usage: bash scripts/check-tscope-phase.sh <phase-number 0-5>
#
# Each phase block runs assertions for that phase's Definition of Done.
# Exit code is 0 if all assertions pass, 1 if any fail, 64 on bad invocation.
# Run before ticking the plan's Status header to the next phase.
#
# WI linkage is invoked as `--phase=TS<N>` — the linkage filter builds
# `^WI-<arg>…`, so a bare numeric phase matches zero `WI-TS*` ids and the
# fail-closed branch exits 1 (verified by execution; see WI-TS0.1).

set -uo pipefail

cd "$(dirname "$0")/.."

PLAN_FILE=".claude/tdd-guardian/20260831-terminal-per-instance-sessions.md"

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase-number>"
  echo "  0  Infrastructure & headroom (gate script, pre-splits)"
  echo "  1  Store model (owner field, scope actions, selectors)"
  echo "  2  Guards + transition wiring (cd-follow, coordinator, lifecycle)"
  echo "  3  UI (tab bar filtering, auto-create, last-session)"
  echo "  4  Spawn & pickers (spawn context contract, out-of-tree pickers)"
  echo "  5  E2E, docs, i18n"
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

assert_grep() {
  local pattern="$1"; local file="$2"; local label="$3"
  if grep -q -- "$pattern" "$file" 2>/dev/null; then ok "$label"; else fail "$label (pattern '$pattern' not in $file)"; fi
}

assert_wc_max() {
  local path="$1"; local max="$2"; local label="$3"
  local n
  if [[ -f "$path" ]]; then
    n=$(wc -l <"$path" | tr -d ' ')
    if (( n <= max )); then ok "$label ($n lines ≤ $max)"; else fail "$label ($n lines, need ≤ $max)"; fi
  else
    fail "$label (file missing: $path)"
  fi
}

# WI linkage for one phase. MUST use the TS-prefixed spelling: the linkage
# filter regex is `^WI-<arg>…`, so `--phase=0` matches nothing in a WI-TS plan
# and fails closed.
assert_linkage() {
  local phase="$1"
  if bash scripts/check-wi-linkage.sh "$PLAN_FILE" --phase="TS${phase}" >/dev/null 2>&1; then
    ok "WI linkage green for phase TS${phase}"
  else
    fail "WI linkage red for phase TS${phase} (run: bash scripts/check-wi-linkage.sh $PLAN_FILE --phase=TS${phase})"
  fi
}

# ─── Phase 0 — Infrastructure & headroom ─────────────────────────────────
phase_0() {
  echo "Phase 0 — Infrastructure & headroom"

  # WI-TS0.1 — this gate + its self-test
  assert_file "scripts/check-tscope-phase.test.mjs" "WI-TS0.1 gate self-test"
  assert_file "$PLAN_FILE" "WI-TS0.1 plan file"

  # WI-TS0.2 — useTerminalSessions pre-split
  assert_file "src/components/Terminal/terminalSessionBell.ts"     "WI-TS0.2 bell wiring module"
  assert_file "src/components/Terminal/useTerminalSessionsInit.ts" "WI-TS0.2 mount/init module"
  assert_wc_max "src/components/Terminal/useTerminalSessions.ts" 249 "WI-TS0.2 useTerminalSessions.ts under 250"

  # WI-TS0.3 — workspaceInstancesStore pre-split
  assert_wc_max "src/stores/workspaceInstancesStore.ts" 280 "WI-TS0.3 workspaceInstancesStore.ts ≤ 280"

  assert_linkage 0
}

# ─── Phase 1 — Store model ───────────────────────────────────────────────
phase_1() {
  echo "Phase 1 — Store model (no wiring yet)"

  # WI-TS1.1 — owner field + stamping helper + union cap/ordinals
  assert_grep "workspaceInstanceId" "src/stores/uiStore/types.ts" "WI-TS1.1 owner field on TerminalSession"
  assert_file "src/services/terminal/resolveTerminalOwnerInstanceId.ts" "WI-TS1.1 stamping helper"
  assert_file "src/services/terminal/resolveTerminalOwnerInstanceId.test.ts" "WI-TS1.1 stamping helper tests"
  assert_file "src/stores/uiStore/terminalSlice.scope.test.ts" "WI-TS1.1 slice scope tests"

  # WI-TS1.2 — scope-transition actions
  assert_file "src/stores/uiStore/terminalScopeActions.ts" "WI-TS1.2 scope actions module"
  for action in terminalAdoptUnscopedSessions terminalSwitchScope terminalHydrateScope \
                terminalRemoveScopeSessions terminalRekeyScope; do
    assert_grep "$action" "src/stores/uiStore/terminalScopeActions.ts" "WI-TS1.2 action $action"
  done
  assert_grep "lastActiveByScope" "src/stores/uiStore/types.ts" "WI-TS1.2 per-scope active memory"

  # WI-TS1.3 — scoped selectors
  assert_file "src/stores/uiStore/terminalScopeSelectors.ts" "WI-TS1.3 selectors module"
  assert_grep "selectVisibleTerminalSessions" "src/stores/uiStore/terminalScopeSelectors.ts" "WI-TS1.3 visible selector"
  assert_grep "selectVisibleSessionCount" "src/stores/uiStore/terminalScopeSelectors.ts" "WI-TS1.3 count selector"

  assert_linkage 1
}

# ─── Phase 2 — Guards + transition wiring ────────────────────────────────
phase_2() {
  echo "Phase 2 — Guards + transition wiring"

  # WI-TS2.1 — cd-follow gated at all three sites
  assert_file "src/services/terminal/terminalCdFollow.ts" "WI-TS2.1 cd-follow predicate module"
  assert_grep "shouldFollowWorkspaceCd" "src/components/Terminal/terminalSessionStoreSync.ts" "WI-TS2.1 syncRoot + flushPendingRoot guard"
  assert_grep "shouldFollowWorkspaceCd" "src/components/Terminal/useTerminalShellLifecycle.ts" "WI-TS2.1 post-spawn catch-up guard"

  # WI-TS2.2 — coordinator + hydrate
  assert_grep "terminalAdoptUnscopedSessions" "src/services/workspaces/switchWorkspaceInstance.ts" "WI-TS2.2 adoption on switch"
  assert_grep "terminalSwitchScope" "src/services/workspaces/switchWorkspaceInstance.ts" "WI-TS2.2 scope switch on switch"
  assert_grep "terminalHydrateScope" "src/services/workspaces/hydrateWorkspaceInstanceContext.ts" "WI-TS2.2 hydrate realign"

  # WI-TS2.3 — instance lifecycle wiring
  assert_grep "terminalRemoveScopeSessions" "src/services/workspaces/closeWorkspaceInstance.ts" "WI-TS2.3 close kills scope sessions"
  assert_grep "terminalHydrateScope" "src/services/workspaces/closeWorkspaceInstance.ts" "WI-TS2.3 close realigns active"
  assert_grep "terminalRemoveScopeSessions" "src/services/workspaces/workspaceWindowActions.ts" "WI-TS2.3 move kills source scope"
  assert_grep "terminalRekeyScope" "src/stores/workspaceInstancesStore.ts" "WI-TS2.3 rekey follower"
  assert_grep "removeClosedScope" "src/stores/tabStoreClosedScopes.ts" "WI-TS2.3 closed-scope cleanup action"
  assert_grep "removeClosedScope" "src/services/workspaces/closeWorkspaceInstance.ts" "WI-TS2.3 closed-scope cleanup wired"

  # WI-TS2.4 — store-chain integration test
  assert_file "src/components/Terminal/terminalSessionStoreSync.railswitch.test.ts" "WI-TS2.4 rail-switch chain test"

  assert_linkage 2
}

# ─── Phase 3 — UI ────────────────────────────────────────────────────────
phase_3() {
  echo "Phase 3 — UI"

  # WI-TS3.1 — UI filtering
  assert_grep "useVisibleTerminalSessions" "src/components/Terminal/TerminalTabBar.tsx" "WI-TS3.1 tab bar renders visible population"
  assert_file "src/components/Terminal/TerminalTabBar.scope.test.tsx" "WI-TS3.1 tab bar scope tests"
  assert_grep "visible" "src/components/Terminal/terminalKeyHandler.ts" "WI-TS3.1 keyHandler indexes visible list"

  # WI-TS3.2 — shared auto-create helper + empty state
  assert_file "src/services/terminal/maybeAutoCreateTerminalSession.ts" "WI-TS3.2 shared auto-create helper"
  assert_grep "canAutoCreateInScope" "src/services/terminal/maybeAutoCreateTerminalSession.ts" "WI-TS3.2 scope-aware gate"
  for locale in en de es fr it ja ko pt-BR zh-CN zh-TW; do
    assert_grep "terminal.noWorkspaceSession" "src/locales/${locale}/statusbar.json" "WI-TS3.2 empty-state key (${locale})"
  done

  # WI-TS3.3 — visible-scope last-session semantics
  assert_grep "visible" "src/components/Terminal/TerminalPanel.tsx" "WI-TS3.3 panel last-ness on visible population"

  assert_linkage 3
}

# ─── Phase 4 — Spawn & pickers ───────────────────────────────────────────
phase_4() {
  echo "Phase 4 — Spawn & pickers"

  # WI-TS4.1 — spawn context contract
  assert_file "src/components/Terminal/resolveTerminalSpawnContext.ts" "WI-TS4.1 spawn context contract"
  assert_file "src/components/Terminal/resolveTerminalSpawnContext.test.ts" "WI-TS4.1 contract matrix tests"
  assert_grep "workspaceRoot" "src/components/Terminal/spawnPty.ts" "WI-TS4.1 spawnPty takes workspaceRoot"

  # WI-TS4.2 — out-of-tree pickers
  assert_grep "resolveTerminalOwnerInstanceId" "src/services/terminal/revealTerminalSession.ts" "WI-TS4.2 pickers stamp owners"
  assert_grep "WI-TS4.2" "src/services/terminal/runInTerminal.test.ts" "WI-TS4.2 id-pinned delivery test"

  assert_linkage 4
}

# ─── Phase 5 — E2E, docs, i18n ───────────────────────────────────────────
phase_5() {
  echo "Phase 5 — E2E, docs, i18n"

  # WI-TS5.1 — rail e2e plumbing
  assert_file "e2e/lib/rail.mjs" "WI-TS5.1 rail e2e helpers"
  assert_grep "data-rail-action" "src/components/WorkspaceRail/WorkspaceRail.tsx" "WI-TS5.1 stable rail selectors"

  # WI-TS5.2 — journeys
  assert_file "e2e/journeys/35-terminal-rail-scoping.mjs" "WI-TS5.2 rail-scoping journey"
  assert_grep "withRailMode" "e2e/journeys/18-terminal-workspace-cd-sync.mjs" "WI-TS5.2 journey 18 rail-OFF precondition"
  # CI's run loop passes journey NAMES (--only substrings), not file names.
  assert_grep "terminal-rail-scoping" ".github/workflows/tier0-e2e.yml" "WI-TS5.2 CI journey list includes 35"
  if [[ -d dev-docs ]]; then
    assert_grep "terminal-rail-scoping" "dev-docs/e2e-tier0-matrix.md" "WI-TS5.2 tier-0 matrix updated"
  else
    echo "  ⓘ dev-docs/ absent on this machine — matrix check skipped (maintainer-local)"
  fi

  # WI-TS5.3 — website docs
  assert_grep "workspace" "website/guide/terminal.md" "WI-TS5.3 terminal guide covers scoping"
  assert_grep "erminal" "website/guide/workspace-rail.md" "WI-TS5.3 rail guide terminal section"
  assert_grep "workspace-rail.md" ".claude/rules/21-website-docs.md" "WI-TS5.3 rule 21 mapping row"

  assert_linkage 5
}

# ─── Dispatch ────────────────────────────────────────────────────────────
case "$PHASE" in
  0) phase_0 ;;
  1) phase_1 ;;
  2) phase_2 ;;
  3) phase_3 ;;
  4) phase_4 ;;
  5) phase_5 ;;
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
