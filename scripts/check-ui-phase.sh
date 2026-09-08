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
# script asserts TREE state only — files, npm wiring, baselines, gate output —
# plus the RUN of every test it names as a deliverable: a test file that
# exists but is empty, skipped or failing is not a deliverable, so phases 0, 1
# and 4 run theirs through vitest and read the JSON report SUITE BY SUITE
# (audit 20260907 #63/#65/#66 — existence alone was the assertion before, and
# then a run total, which one green suite satisfied on behalf of a skipped one).
# The fixture assertions under dev-docs/ (phase 0's PNGs and reference doc,
# phase 4's design-system.md) run only where that folder exists, and
# VMARK_UI_PHASE_NO_DEVDOCS=1 skips them explicitly — see has_devdocs.

set -uo pipefail

usage() {
  echo "Usage: $0 <phase-number>"
  echo "  0  Instrument (gates + baselines + fixtures)"
  echo "  1  Contrast, theme-keyed emission, blocking findings"
  echo "  2  Typography, Tailwind bridge, icon-button primitive"
  echo "  3  Shells, surfaces, one owner per value"
  echo "  4  Copy, semantics, front door, docs"
}

# `set -e` is deliberately off (an assertion may fail and the run continues), so
# a failed `cd` used to be IGNORED and every path assertion below then resolved
# against the caller's working directory — a phase reporting on whatever tree
# the reader happened to stand in (audit R2 #90).
cd "$(dirname "$0")/.." || { echo "cannot cd to the repository root from $0"; exit 64; }

# Exactly one argument. A second positional used to be discarded in silence, so
# `check-ui-phase.sh 2 3` ran phase 2 and said nothing about the 3 (audit R2
# #91) — the same class check-terminal-edge-phase.sh already refuses.
if (( $# > 1 )); then
  usage
  echo "  (unexpected extra argument: $2)"
  exit 64
fi
PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  usage
  exit 64
fi

PASS=0
FAIL=0
FAIL_DETAIL=()

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
MISSING_HELPER_MARK="$(mktemp -t vmark-dod-missing)"
# Every temp file this run creates. The vitest report used to be removed only
# on the normal path, so an interrupted run (Ctrl-C during a several-minute
# vitest invocation is the ordinary case here) left it in $TMPDIR (audit R2
# #95). INT and TERM are trapped as well as EXIT — bash does not run an EXIT
# trap for an uncaught SIGINT.
TEMP_FILES=("$MISSING_HELPER_MARK")
cleanup_temp() { rm -f "${TEMP_FILES[@]}"; }
trap cleanup_temp EXIT
trap 'cleanup_temp; exit 130' INT
trap 'cleanup_temp; exit 143' TERM
# A misspelled assertion helper used to be SILENT: bash printed "command not
# found" to stderr and the phase counted neither a pass nor a failure, so the
# check simply did not exist. bash runs this handler in a SUBSHELL, so a
# counter bumped here would not reach the summary — record it on disk.
command_not_found_handle() { echo "  ✗ assertion helper '$1' is not defined in this script"; echo "$1" >> "$MISSING_HELPER_MARK"; return 1; }
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

# The gate's own output IS the diagnostic. Discarding it left "command failed:
# pnpm lint:ui-consistency" and nothing to act on, for a gate whose whole job is
# to name the offending file and line (audit R2 #93).
ASSERT_CMD_TAIL=20
assert_cmd() {
  local label="$1"; shift
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if (( rc == 0 )); then ok "$label"; return; fi
  fail "$label (exit $rc: $*)"
  printf '%s\n' "$out" | tail -n "$ASSERT_CMD_TAIL" | sed 's/^/      | /'
}

# A test that RUNS green — existence is not the property. `tier` picks the
# vitest config (gates for scripts/**, app for src/**); `pattern` is a file or
# a vitest filename filter. Read from the JSON report AND from vitest's exit
# status, and PER SUITE: every suite in the report must have a passing test and
# no failing one, and every suite that matches the filter ON DISK must appear
# in the report BY NAME. The run's totals are not enough — an all-`it.skip`
# suite reports `status: "passed"` with only skipped assertions, and beside one
# green suite it vanished into a green total (audit 20260907 #66).
#
# Two things this used to get wrong (audit R2 #96/#97): vitest's exit status
# was DISCARDED, so a run that wrote a green-looking report and then died (a
# reporter crash, a teardown failure, an unhandled rejection) was reported as
# successful; and the suite check compared COUNTS, only rejecting "too few", so
# a filter that ran a different set of the same size — `find`'s `-name` and
# vitest's substring filter are different matchers — passed while a required
# suite never ran. The expected FILE LIST is compared by name now.
assert_test_run() {
  local tier="$1" pattern="$2" label="${3:-$2}" report why status vitest_status roots="src" expected_list
  if [[ "$pattern" == */* && "$pattern" != *'*'* && ! -f "$pattern" ]]; then fail "$label missing: $pattern"; return; fi
  [[ "$tier" == "gates" ]] && roots="scripts .claude/hooks"
  if [[ "$pattern" == */* ]]; then expected_list="$pattern"
  else expected_list="$(find $roots -name "*${pattern}" -not -path "*/node_modules/*" 2>/dev/null | sed 's|^\./||')"; fi
  report="$(mktemp)"
  TEMP_FILES+=("$report")
  if [[ "$tier" == "gates" ]]; then pnpm vitest run --config vitest.gates.config.ts "$pattern" --reporter=json --outputFile="$report" >/dev/null 2>&1
  else pnpm vitest run "$pattern" --reporter=json --outputFile="$report" >/dev/null 2>&1; fi
  vitest_status=$?
  # The verdict is scripts/vitestReportVerdict.mjs — a MODULE, not a
  # `node -e` string. Code inside a shell string is checked by nothing here,
  # and two of this validator's branches were unreachable from any test
  # (audit R2 #94). stderr is folded into the message so a crash in the
  # validator says why, instead of degrading to "report unreadable".
  why="$(node scripts/vitestReportVerdict.mjs "$report" "$expected_list" "$vitest_status" 2>&1)"
  status=$?
  rm -f "$report"
  if (( status == 0 )); then ok "$label runs green"; else fail "$label did not run green (vitest, $tier tier: $pattern — ${why:-report unreadable})"; fi
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

# ONE theme list. Phases 0 and 1 each carried their own copy — the baseline
# screenshots and the contrast lists — so a seventh theme would have been
# covered by whichever phase somebody remembered (audit R2 #98).
THEMES=(white paper mint sepia night solarized)
# And the list is CHECKED, not merely shared: `scripts/theme-contrast-baseline.json`
# is written from the typed catalog by check-theme-contrast.ts, so its `failing`
# keys ARE the shipped theme ids. A hardcoded array that disagrees with them is
# the drift this consolidation would otherwise only halve, so it fails the
# phase rather than silently checking a subset.
assert_themes_current() {
  local want listed
  want="$(printf '%s\n' "${THEMES[@]}" | sort | tr '\n' ' ')"
  listed="$(node -e 'const f=require("./scripts/theme-contrast-baseline.json").failing||{};console.log(Object.keys(f).sort().join(" "))' 2>&1)"
  if [[ "$listed" == "${want% }" ]]; then ok "theme list matches the contrast baseline's themes"
  else fail "theme list is stale: this script has [${want% }], scripts/theme-contrast-baseline.json has [$listed]"; fi
}

case "$PHASE" in
  0)
    echo "Phase 0 — Instrument:"
    assert_file scripts/check-theme-contrast.ts
    assert_test_run gates scripts/check-theme-contrast.test.ts "check-theme-contrast self-test"
    assert_file scripts/theme-contrast-baseline.json
    assert_themes_current
    assert_file scripts/check-ui-consistency.mjs
    assert_test_run gates scripts/check-ui-consistency.test.mjs "check-ui-consistency self-test"
    assert_file scripts/ui-consistency-baseline.json
    assert_file scripts/design-tokens-baseline.json
    assert_file scripts/gate-tests-baseline.json
    assert_test_run gates scripts/check-theme-names.test.mjs "check-theme-names self-test"
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
    assert_grep 'check-selection-styles' scripts/lib/deletedNamesRegistry.mjs "selection-styles registered as deleted (registry moved out of the gate script, WI-FL3.2)"
    assert_cmd "lint:theme-contrast green" pnpm lint:theme-contrast
    assert_cmd "lint:ui-consistency green" pnpm lint:ui-consistency
    assert_cmd "lint:design-tokens green" pnpm lint:design-tokens
    # Visual-QA fixtures exist only where a real dev-docs/ does — see
    # has_devdocs for the README-marker probe and the override.
    if has_devdocs; then
      assert_file dev-docs/css-reference.md "visual-QA reference doc"
      assert_file dev-docs/e2e-testing.md "e2e harness runbook"
      for theme in "${THEMES[@]}"; do
        assert_file "dev-docs/baselines/${theme}.png" "baseline screenshot ${theme}"
      done
    else
      ok "visual-QA fixture checks skipped — dev-docs/ absent or disabled (AGENTS.md)"
    fi
    ;;
  1)
    echo "Phase 1 — Contrast + emission:"
    assert_themes_current
    for theme in "${THEMES[@]}"; do
      assert_empty_list scripts/theme-contrast-baseline.json "failing.${theme}" "contrast failing list empty (${theme})"
    done
    assert_empty_list scripts/ui-consistency-baseline.json "C10" "C10 (focus) list empty"
    assert_grep 'prefers-reduced-motion' src/styles/index.css "global reduced-motion block"
    assert_file src/utils/motion.ts "motion utility"
    assert_test_run app src/test/reducedMotionGlobal.test.ts "reduced-motion global test"
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
    # Every *.a11y.test.tsx at any depth (a vitest filename filter, so no
    # globstar dependence), and EACH must pass — a present-but-skipped or
    # failing axe suite is not the deliverable, however green its siblings.
    assert_test_run app ".a11y.test.tsx" "a11y axe suites (every *.a11y.test.tsx)"
    ;;
  *)
    echo "unknown phase: $PHASE"
    exit 64
    ;;
esac

echo
MISSING=$(wc -l < "$MISSING_HELPER_MARK" | tr -d " ")
if (( MISSING > 0 )); then
  echo "  $MISSING assertion(s) named a helper this script does not define — they checked NOTHING."
  sort -u "$MISSING_HELPER_MARK" | sed 's/^/    - /'
  exit 1
fi
echo "Phase $PHASE: $PASS passed, $FAIL failed"
if (( FAIL > 0 )); then
  for d in "${FAIL_DETAIL[@]}"; do echo "  ✗ $d"; done
  exit 1
fi
exit 0
