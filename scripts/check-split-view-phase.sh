#!/usr/bin/env bash
# Split-pane view-modes (Source/Split/Preview) phase DoD checker.
#
# Usage:  scripts/check-split-view-phase.sh <N>   where N ∈ {1, 2}
#
# Exits 0 when the phase's machine-checkable DoD passes; non-zero otherwise.
# Plan: dev-docs/plans/20260703-split-pane-view-modes.md
# Per .claude/rules/60-ai-governance.md rule 3 — phase boundaries are gated
# by scripts, not prose.

set -euo pipefail

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase>" >&2
  echo "  Phases: 1, 2" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

SPE="src/components/Editor/SplitPaneEditor"

case "$PHASE" in
  1)
    echo "Phase 1 — Core state + rendering"

    # WI-1.1 — SplitViewMode type + Tab.viewMode + setter
    if grep -q "export type SplitViewMode" src/lib/formats/types.ts; then
      ok "SplitViewMode type exported"
    else
      fail "SplitViewMode type missing from types.ts"
    fi
    # Tab shape lives in tabStoreTypes.ts (extracted to keep tabStore under its
    # size baseline; re-exported from tabStore.ts).
    if grep -q "viewMode?: SplitViewMode" src/stores/tabStoreTypes.ts; then
      ok "Tab.viewMode field declared"
    else
      fail "Tab.viewMode field missing"
    fi
    if grep -q "setTabViewMode" src/stores/tabStore.ts; then
      ok "setTabViewMode action present"
    else
      fail "setTabViewMode action missing"
    fi

    # WI-1.2 — SplitPaneEditor branches on the effective mode
    if grep -q "defaultViewMode" "$SPE/SplitPaneEditor.tsx" \
      && grep -qE "showPreview|showSource" "$SPE/SplitPaneEditor.tsx"; then
      ok "SplitPaneEditor resolves + branches on view mode"
    else
      fail "SplitPaneEditor does not branch on view mode"
    fi

    # Settings default field backs the resolution
    if grep -q "defaultViewMode: SplitViewMode" src/stores/settingsTypes/workspace.ts \
      && grep -q 'defaultViewMode: "split"' src/stores/settingsStore/defaults.ts; then
      ok "formats.defaultViewMode setting (default split) present"
    else
      fail "formats.defaultViewMode setting missing / not defaulting to split"
    fi

    # Tests
    if pnpm exec vitest run "$SPE/SplitPaneEditor.test.tsx" src/stores/tabStore.test.ts >/dev/null 2>&1; then
      ok "SplitPaneEditor + tabStore tests pass"
    else
      fail "Phase 1 tests failing"
    fi
    ;;

  2)
    echo "Phase 2 — UX, shortcut, i18n, docs"

    # WI-2.1 — ViewModeToggle component + css + tests
    [[ -f "$SPE/ViewModeToggle.tsx" ]] && ok "ViewModeToggle.tsx present" || fail "ViewModeToggle.tsx missing"
    [[ -f "$SPE/view-mode-toggle.css" ]] && ok "view-mode-toggle.css present" || fail "view-mode-toggle.css missing"
    [[ -f "$SPE/ViewModeToggle.test.tsx" ]] && ok "ViewModeToggle.test.tsx present" || fail "ViewModeToggle test missing"
    if grep -q 'role="radiogroup"' "$SPE/ViewModeToggle.tsx"; then
      ok "ViewModeToggle is a radiogroup"
    else
      fail "ViewModeToggle missing radiogroup role"
    fi
    if grep -q "ViewModeToggle" "$SPE/SplitPaneEditor.tsx"; then
      ok "SplitPaneEditor renders ViewModeToggle"
    else
      fail "SplitPaneEditor does not render ViewModeToggle"
    fi

    # WI-2.2 — format-aware F6/Shift+F6
    [[ -f src/hooks/splitPaneViewShortcut.ts ]] && ok "splitPaneViewShortcut module present" || fail "splitPaneViewShortcut missing"
    if grep -q "applySplitPaneViewShortcut" src/hooks/useViewShortcuts.ts; then
      ok "useViewShortcuts branches F6/Shift+F6 to split-pane"
    else
      fail "useViewShortcuts does not use applySplitPaneViewShortcut"
    fi

    # WI-2.4 — i18n keys across all 10 locales
    MISSING=""
    for loc in en de es fr it ja ko pt-BR zh-CN zh-TW; do
      grep -q "splitPane.viewMode.preview" "src/locales/$loc/editor.json" \
        && grep -q "formats.defaultViewMode.label" "src/locales/$loc/settings.json" \
        || MISSING="$MISSING $loc"
    done
    if [[ -z "$MISSING" ]]; then
      ok "view-mode i18n keys present in all 10 locales"
    else
      fail "view-mode i18n keys missing in:$MISSING"
    fi

    # WI-2.5 — docs
    if grep -q "View modes (Source / Split / Preview)" website/guide/formats.md; then
      ok "formats.md documents view modes"
    else
      fail "formats.md missing view-modes section"
    fi
    if grep -q "Default view mode" website/guide/settings.md; then
      ok "settings.md documents default view mode"
    else
      fail "settings.md missing default-view-mode section"
    fi

    # Tests
    if pnpm exec vitest run "$SPE/ViewModeToggle.test.tsx" src/hooks/splitPaneViewShortcut.test.ts >/dev/null 2>&1; then
      ok "Phase 2 unit tests pass"
    else
      fail "Phase 2 tests failing"
    fi
    ;;

  *)
    echo "Unknown phase: $PHASE" >&2
    echo "Phases: 1, 2" >&2
    exit 2
    ;;
esac

echo
echo "Phase $PHASE: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
