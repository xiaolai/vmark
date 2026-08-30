#!/usr/bin/env bash
#
# DoD checker for the UI-consistency plan (WI-UI0.5).
# Plan: dev-docs/plans/20260829-ui-consistency.md
#
# Usage: bash scripts/check-ui-phase.sh <phase-number>
#
# Each phase block runs assertions for that phase's Definition of Done.
# Exit 0 if all pass, 1 if any fail, 64 on bad invocation. Run before ticking
# the plan's Status header to the next phase. Shape copied from
# scripts/check-gha-phase.sh (rule 60 §3).
#
# The plan itself is maintainer-local (dev-docs/ is gitignored), so this
# script asserts TREE state only — files, npm wiring, baselines, gate output.
# The fixture assertions under dev-docs/ (phase 0's PNGs and reference doc,
# phase 4's design-system.md) run only where that folder exists, and
# VMARK_UI_PHASE_NO_DEVDOCS=1 skips them explicitly — see has_devdocs.

set -uo pipefail

cd "$(dirname "$0")/.."

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase-number>"
  echo "  0  Instrument (gates + baselines + fixtures)"
  echo "  1  Contrast, theme-keyed emission, blocking findings"
  echo "  2  Typography, Tailwind bridge, icon-button primitive"
  echo "  3  Shells, surfaces, one owner per value"
  echo "  4  Copy, semantics, front door, docs"
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

assert_absent() {
  local path="$1"; local label="${2:-$1}"
  if [[ ! -e "$path" ]]; then ok "$label is gone"; else fail "$label still exists: $path"; fi
}

assert_grep() {
  local pattern="$1"; local file="$2"; local label="$3"
  if grep -q -- "$pattern" "$file" 2>/dev/null; then ok "$label"; else fail "$label (pattern '$pattern' not in $file)"; fi
}

assert_cmd() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$label"; else fail "$label (command failed: $*)"; fi
}

# Baseline list emptiness, via node so the JSON is parsed, not grepped.
assert_empty_list() {
  local file="$1"; local key="$2"; local label="$3"
  if node -e "
    const d = require('./$file');
    const v = key => key.split('.').reduce((a, k) => a?.[k], d);
    const list = v('$key');
    process.exit(Array.isArray(list) && list.length === 0 ? 0 : 1);
  " 2>/dev/null; then ok "$label"; else fail "$label ($key in $file is not empty)"; fi
}

# dev-docs/ is maintainer-local (gitignored — AGENTS.md). Two guards against
# the same race, belt and braces: a sibling gate test (clean-dev.test.mjs)
# fabricates fixtures under the REAL dev-docs/ in the same vitest tier, so a
# bare `-d dev-docs` probe mid-run is the read half of a TOCTOU race — on a
# checkout where dev-docs/ is normally absent (CI, a fresh worktree) it can
# see the transient fixture and then demand maintainer files the fixture does
# not carry. So (1) the probe keys on dev-docs/README.md — the index
# AGENTS.md requires of a real dev-docs and no fixture creates — and (2) the
# self-test sets VMARK_UI_PHASE_NO_DEVDOCS=1 to force the absent branch
# deterministically regardless of tree class.
has_devdocs() {
  [[ "${VMARK_UI_PHASE_NO_DEVDOCS:-0}" != "1" && -f dev-docs/README.md ]]
}

case "$PHASE" in
  0)
    echo "Phase 0 — Instrument:"
    assert_file scripts/check-theme-contrast.ts
    assert_file scripts/check-theme-contrast.test.ts
    assert_file scripts/theme-contrast-baseline.json
    assert_file scripts/check-ui-consistency.mjs
    assert_file scripts/check-ui-consistency.test.mjs
    assert_file scripts/ui-consistency-baseline.json
    assert_file scripts/design-tokens-baseline.json
    assert_file scripts/gate-tests-baseline.json
    assert_file scripts/check-theme-names.test.mjs
    assert_file scripts/lib/cssRules.mjs
    assert_absent scripts/check-selection-styles.mjs "check-selection-styles.mjs"
    assert_grep '"lint:theme-contrast"' package.json "lint:theme-contrast npm entry"
    assert_grep '"lint:ui-consistency"' package.json "lint:ui-consistency npm entry"
    assert_grep 'pnpm lint:theme-contrast' package.json "lint:theme-contrast in check:static"
    assert_grep 'pnpm lint:ui-consistency' package.json "lint:ui-consistency in check:static"
    assert_grep 'theme-contrast-baseline' scripts/baselineRatchetManifest.mjs "theme-contrast baseline registered"
    assert_grep 'ui-consistency-baseline' scripts/baselineRatchetManifest.mjs "ui-consistency baseline registered"
    assert_grep 'design-tokens-baseline' scripts/baselineRatchetManifest.mjs "design-tokens baseline registered"
    assert_grep 'gate-tests-baseline' scripts/baselineRatchetManifest.mjs "gate-tests baseline registered"
    assert_grep 'check-selection-styles' scripts/check-deleted-names.mjs "selection-styles registered as deleted"
    assert_cmd "lint:theme-contrast green" pnpm lint:theme-contrast
    assert_cmd "lint:ui-consistency green" pnpm lint:ui-consistency
    assert_cmd "lint:design-tokens green" pnpm lint:design-tokens
    # Visual-QA fixtures exist only where a real dev-docs/ does — see
    # has_devdocs for the README-marker probe and the override.
    if has_devdocs; then
      assert_file dev-docs/css-reference.md "visual-QA reference doc"
      assert_file dev-docs/e2e-testing.md "e2e harness runbook"
      for theme in white paper mint sepia night solarized; do
        assert_file "dev-docs/baselines/${theme}.png" "baseline screenshot ${theme}"
      done
    else
      ok "visual-QA fixture checks skipped — dev-docs/ absent or disabled (AGENTS.md)"
    fi
    ;;
  1)
    echo "Phase 1 — Contrast + emission:"
    for theme in white paper mint sepia night solarized; do
      assert_empty_list scripts/theme-contrast-baseline.json "failing.${theme}" "contrast failing list empty (${theme})"
    done
    assert_empty_list scripts/ui-consistency-baseline.json "C10" "C10 (focus) list empty"
    assert_grep 'prefers-reduced-motion' src/styles/index.css "global reduced-motion block"
    assert_file src/utils/motion.ts "motion utility"
    assert_file src/test/reducedMotionGlobal.test.ts
    assert_cmd "lint:theme-contrast green" pnpm lint:theme-contrast
    assert_cmd "lint:ui-consistency green" pnpm lint:ui-consistency
    ;;
  2)
    echo "Phase 2 — Typography + icon primitive:"
    assert_empty_list scripts/ui-consistency-baseline.json "C5" "C5 (font roles) list empty"
    assert_empty_list scripts/ui-consistency-baseline.json "C7" "C7 (icon sizes) list empty"
    assert_empty_list scripts/ui-consistency-baseline.json "C8" "C8 (hit targets) list empty"
    assert_grep '--font-ui' src/styles/index.css "--font-ui declared"
    assert_grep '@theme' src/styles/index.css "@theme bridge present"
    assert_file src/styles/icon-button-shared.css
    assert_grep 'vm-icon-btn' scripts/check-bespoke-buttons.mjs "vm-icon-btn canonical"
    assert_cmd "lint:ui-consistency green" pnpm lint:ui-consistency
    assert_cmd "lint:bespoke-buttons green" pnpm lint:bespoke-buttons
    ;;
  3)
    echo "Phase 3 — Shells + owners:"
    assert_file src/styles/overlay-shared.css
    assert_file src/styles/input-shared.css
    assert_empty_list scripts/ui-consistency-baseline.json "C9" "C9 (state vocabulary) list empty"
    assert_empty_list scripts/ui-consistency-baseline.json "C11" "C11 (heights) list empty"
    assert_empty_list scripts/ui-consistency-baseline.json "C4" "C4 (overlay shells) list empty (browser-approval carries its ui-ok marker)"
    assert_grep 'BAR_HEIGHT' src/shell/shellChrome.ts "bar height owned by shellChrome"
    assert_cmd "lint:ui-consistency green" pnpm lint:ui-consistency
    ;;
  4)
    echo "Phase 4 — Copy + semantics + docs:"
    assert_file src/services/dialogs/confirmAction.ts
    # The doc lives only where a real dev-docs/ does — see has_devdocs.
    if has_devdocs; then
      assert_file dev-docs/design-system.md
    else
      ok "design-system.md check skipped — dev-docs/ absent or disabled (AGENTS.md)"
    fi
    assert_cmd "lint:i18n green (casing/punctuation checks live there)" pnpm lint:i18n
    assert_cmd "lint:keybinding-manifest green (label parity)" pnpm lint:keybinding-manifest
    if ls src/components/**/*.a11y.test.tsx >/dev/null 2>&1 || ls src/components/*/*.a11y.test.tsx >/dev/null 2>&1; then
      ok "a11y axe suites present"
    else
      fail "no *.a11y.test.tsx suites found"
    fi
    ;;
  *)
    echo "unknown phase: $PHASE"
    exit 64
    ;;
esac

echo
echo "Phase $PHASE: $PASS passed, $FAIL failed"
if (( FAIL > 0 )); then
  for d in "${FAIL_DETAIL[@]}"; do echo "  ✗ $d"; done
  exit 1
fi
exit 0
