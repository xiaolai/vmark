#!/usr/bin/env bash
#
# DoD checker for the open-cost plan (#1565, rule 60 §3).
# Plan: .claude/tdd-guardian/plan-20261017-open-cost.md
#
# Usage: bash scripts/check-open-cost-phase.sh <OC1|OC2|OC3|all> [--root=<dir>]
#
# Each phase block asserts that phase's Definition of Done: its deliverables
# exist and carry the mechanism the plan names, and (REAL-ROOT) every work item
# of the phase is linked. When this file and the plan disagree, this file wins —
# prose cannot be executed.
#
# Exit codes:
#   0   every assertion for the requested phase(s) passed
#   1   an assertion failed, the phase has not started, or a REAL-ROOT
#       assertion could not run (UNVERIFIED is never a pass)
#  64   bad invocation (no phase, unknown phase, unusable --root)
#
# --root lets scripts/check-open-cost-phase.test.mjs drive this against fixture
# trees in both directions. Linkage reads git history, so it is REAL-ROOT and
# reported UNVERIFIED anywhere else.
#
# @coordinates-with .claude/tdd-guardian/plan-20261017-open-cost.md

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$REPO_ROOT"
PHASE=""
PLAN=".claude/tdd-guardian/plan-20261017-open-cost.md"

for arg in "$@"; do
  case "$arg" in
    --root=*) ROOT="${arg#--root=}" ;;
    -*) echo "unknown flag: $arg" >&2; exit 64 ;;
    *)
      if [[ -n "$PHASE" ]]; then echo "expected one phase, got '$PHASE' and '$arg'" >&2; exit 64; fi
      PHASE="$arg" ;;
  esac
done

usage() {
  cat <<'EOF'
Usage: bash scripts/check-open-cost-phase.sh <OC1|OC2|OC3|all> [--root=<dir>]

  OC1  The window is never starved by its document
  OC2  No redundant or quadratic work at load
  OC3  Guards, documentation, acceptance
  all  Every phase, one report
EOF
}

[[ -z "$PHASE" ]] && { usage; exit 64; }
case "$PHASE" in
  OC1|OC2|OC3|all) ;;
  *) echo "unknown phase: $PHASE" >&2; usage; exit 64 ;;
esac
[[ -d "$ROOT" ]] || { echo "--root is not a directory: $ROOT" >&2; exit 64; }

IS_REAL_ROOT=0
[[ "$(cd "$ROOT" && pwd)" == "$REPO_ROOT" ]] && IS_REAL_ROOT=1

PASS=0; FAIL=0; PRESENT=0; CHECKED=0; SKIPPED=0

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
skip() { echo "  · $1 — UNVERIFIED (REAL-ROOT only)"; SKIPPED=$((SKIPPED+1)); }

has_file() {
  local rel="$1" label="$2"
  CHECKED=$((CHECKED+1))
  if [[ -f "$ROOT/$rel" ]]; then PRESENT=$((PRESENT+1)); ok "$label"; else bad "$label — missing: $rel"; fi
}

# A grep over a missing file is a vacuous truth, so both text helpers fail on
# a missing file before they look at its contents.
has_text() {
  local rel="$1" pat="$2" label="$3"
  CHECKED=$((CHECKED+1))
  if [[ ! -f "$ROOT/$rel" ]]; then bad "$label — missing: $rel"; return; fi
  PRESENT=$((PRESENT+1))
  if grep -qE -- "$pat" "$ROOT/$rel"; then ok "$label"; else bad "$label — $rel lacks /$pat/"; fi
}

lacks_text() {
  local rel="$1" pat="$2" label="$3"
  CHECKED=$((CHECKED+1))
  if [[ ! -f "$ROOT/$rel" ]]; then bad "$label — missing: $rel"; return; fi
  PRESENT=$((PRESENT+1))
  if grep -qE -- "$pat" "$ROOT/$rel"; then bad "$label — $rel still matches /$pat/"; else ok "$label"; fi
}

linked() {
  local phase="$1"
  if (( IS_REAL_ROOT == 0 )); then skip "every WI-$phase work item is linked"; return; fi
  CHECKED=$((CHECKED+1)); PRESENT=$((PRESENT+1))
  if ( cd "$ROOT" && bash scripts/check-wi-linkage.sh "$PLAN" --phase="$phase" >/dev/null 2>&1 ); then
    ok "every WI-$phase work item is linked"
  else
    bad "WI-$phase linkage is red — run: bash scripts/check-wi-linkage.sh $PLAN --phase=$phase"
  fi
}

phase_OC1() {
  echo "Phase OC1 — The window is never starved by its document"
  has_text "src/components/Editor/contentApplied.ts" "export function hasContentApplied" \
           "the applied state exists (WI-OC1.1)"
  has_text "src/components/Editor/useTiptapFlush.ts" "hasContentApplied\(editor\)" \
           "the flush asks for it (WI-OC1.1)"
  has_text "src/services/commands/menuListener.ts" "Promise\.all\(bindings\.map" \
           "every menu listener is requested at once (WI-OC1.2)"
  lacks_text "src/services/commands/menuListener.ts" "shouldAbort" \
             "no polled abort between registrations is left (WI-OC1.2)"
  has_text "src/contexts/windowListening.ts" "export function useWindowListening" \
           "the window-listening signal exists (WI-OC1.3)"
  has_text "src/contexts/useWindowReady.ts" "publishWindowListening\(\)" \
           "the announcement publishes it (WI-OC1.3)"
  has_text "src/components/Editor/DocumentSplit/DocumentSplitContainer.tsx" "useWindowListening\(\) \?" \
           "the document surface waits on it, above its hooks (WI-OC1.3)"
  has_file "src/export/pandocFormats.ts" "the Pandoc format keys are a leaf module (WI-OC1.4)"
  lacks_text "src/services/commands/exportCommands.ts" "PANDOC_FORMAT_KEYS \} = await import" \
             "registering Pandoc commands imports no exporter (WI-OC1.4)"
  has_file "src/components/Editor/useTiptapFlush.test.ts" "the flush-before-load regression test (WI-OC1.1)"
  has_file "src/services/commands/menuListener.test.ts" "the concurrent-mount lifetime tests (WI-OC1.2)"
  has_file "src/contexts/windowListening.test.ts" "the window-listening signal's tests (WI-OC1.3)"
  has_file "src/contexts/WindowContext.surfaceGate.test.tsx" \
           "every ready path opens the gate, under StrictMode (WI-OC1.3)"
  has_file "src/components/Editor/DocumentSplit/DocumentSplitContainer.test.tsx" \
           "the document surface waits on the gate (WI-OC1.3)"
  has_file "src/services/commands/exportCommands.test.ts" \
           "registering Pandoc commands loads no exporter, tested (WI-OC1.4)"
  has_file "scripts/check-open-cost-phase.test.mjs" "this checker has its self-test (WI-OC1.5)"
  linked OC1
}

phase_OC2() {
  echo "Phase OC2 — No redundant or quadratic work at load"
  has_text "src/plugins/codeBlockLineNumbers/tiptap.ts" "addProseMirrorPlugins" \
           "the code-block extension stops re-adding its parent's plugins (WI-OC2.1)"
  has_file "src/services/assembly/extensionPluginFamilies.test.ts" \
           "no extension yields a plugin family twice (WI-OC2.1)"
  has_file "patches/prosemirror-view@1.42.6.patch" "the decoration-set patch (WI-OC2.2)"
  has_text "package.json" "\"prosemirror-view@1\.42\.6\"" "the patch is applied by pnpm (WI-OC2.2)"
  local tests="src/plugins/shared/__tests__"
  has_file "$tests/decorationSet.differential.test.ts" "the patch agrees with upstream's trees (WI-OC2.2)"
  has_file "$tests/decorationSet.render.test.ts" "the patch draws upstream's DOM (WI-OC2.2)"
  has_file "$tests/decorationSet.growth.test.ts" "decoration sets grow about linearly (WI-OC2.2)"
  has_file "$tests/decorationSet.patchParity.test.ts" "both entry points carry the patch (WI-OC2.2)"
  has_file "src/services/assembly/cjkLetterSpacingLoad.test.ts" \
           "the CJK spacing scan runs once per load (WI-OC2.3)"
  has_file "src/plugins/cjkLetterSpacing/__tests__/incrementalStructure.test.ts" \
           "incremental CJK spacing matches a fresh scan after any edit (WI-OC2.3)"
  linked OC2
}

phase_OC3() {
  echo "Phase OC3 — Guards, documentation, acceptance"
  has_file "src/bench/openCost.bench.ts" "the open-cost bench (WI-OC3.1)"
  has_text "website/guide/large-files.md" "^## While a document opens" \
           "the large-files guide says the window answers before the document appears (WI-OC3.2)"
  has_text "website/guide/large-files.md" "used to cost quadratically" \
           "the large-files guide states the decoration fix (WI-OC3.2)"
  has_text "website/guide/large-files.md" "between a quarter and two fifths" \
           "the large-files guide states the measured parse share (WI-OC3.2)"
  has_text "$PLAN" "^### Acceptance results" "acceptance results are recorded (WI-OC3.3)"
  linked OC3
}

run_phase() {
  PASS=0; FAIL=0; PRESENT=0; CHECKED=0; SKIPPED=0
  "phase_$1"
  if (( PRESENT == 0 )); then
    echo "  → Phase $1: NOT STARTED (0 of $CHECKED deliverables present)"; echo; return 1
  fi
  if (( FAIL > 0 )); then
    echo "  → Phase $1: INCOMPLETE ($PASS passed, $FAIL failed)"; echo; return 1
  fi
  if (( SKIPPED > 0 )); then
    echo "  → Phase $1: UNVERIFIED ($PASS passed, $SKIPPED unverified — run without --root)"; echo; return 1
  fi
  echo "  → Phase $1: DONE ($PASS passed)"; echo
  return 0
}

RC=0
if [[ "$PHASE" == "all" ]]; then
  for p in OC1 OC2 OC3; do run_phase "$p" || RC=1; done
  if (( RC == 0 )); then echo "✅ every phase DONE"; else echo "❌ plan incomplete"; fi
else
  run_phase "$PHASE" || RC=1
fi
exit $RC
