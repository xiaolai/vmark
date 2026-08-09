#!/usr/bin/env bash
#
# DoD checker for the architecture-review follow-ups plan.
# Plan: .claude/tdd-guardian/plan-20260809-followups.md
#
# Usage:
#   bash scripts/check-followups-phase.sh <0-5|all> [--root=<dir>]
#
# Each phase block asserts that phase's Definition of Done. This script decides
# whether a phase is done; the plan explains why the phase exists. When the two
# disagree, this file wins — prose cannot be executed.
#
# Exit codes:
#   0   every assertion for the requested phase(s) passed
#   1   assertions failed, or the phase has not been started
#  64   bad invocation (no phase, unknown phase, unusable --root)
#
# A phase with ZERO deliverables present reports NOT STARTED and exits 1. It is
# deliberately NOT a pass: scripts/check-wi-linkage.sh once exited 0 when it
# could parse no work items, and a plan it could not read therefore "passed".
# Nothing-yet and all-done must never share an exit code.
#
# --root exists so scripts/check-followups-phase.test.mjs can drive this against
# fixture trees in both directions. Assertions that need the real repository
# (git history, a live gate run) are marked REAL-ROOT and skipped elsewhere;
# they are the phase's real property, so a fixture pass is necessarily weaker
# than a repo pass, and the report says so.
#
# @coordinates-with .claude/tdd-guardian/plan-20260809-followups.md

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$REPO_ROOT"
PHASE=""

for arg in "$@"; do
  case "$arg" in
    --root=*) ROOT="${arg#--root=}" ;;
    -*) echo "unknown flag: $arg" >&2; exit 64 ;;
    *) PHASE="$arg" ;;
  esac
done

usage() {
  cat <<'EOF'
Usage: bash scripts/check-followups-phase.sh <0-5|all> [--root=<dir>]

  0    Scaffolding and cross-model review
  1    Repair the linkage gate (F3)
  2    Prove the unproven gates (F1, F2)
  3    Frozen debt becomes scheduled debt (F5)
  4    A control on change size (F4)
  5    Documentation hygiene
  all  Every phase, one report
EOF
}

[[ -z "$PHASE" ]] && { usage; exit 64; }
case "$PHASE" in
  0|1|2|3|4|5|all) ;;
  *) echo "unknown phase: $PHASE" >&2; usage; exit 64 ;;
esac
[[ -d "$ROOT" ]] || { echo "--root is not a directory: $ROOT" >&2; exit 64; }

IS_REAL_ROOT=0
[[ "$(cd "$ROOT" && pwd)" == "$REPO_ROOT" ]] && IS_REAL_ROOT=1

PASS=0; FAIL=0; PRESENT=0; CHECKED=0

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
skip() { echo "  · $1 (REAL-ROOT only — skipped)"; }

# Deliverable existence. Counts toward PRESENT so a phase with none can be
# distinguished from a phase that is merely incomplete.
has_file() {
  local rel="$1" label="${2:-$1}"
  CHECKED=$((CHECKED+1))
  if [[ -f "$ROOT/$rel" ]]; then PRESENT=$((PRESENT+1)); ok "$label"; else bad "$label — missing: $rel"; fi
}

# A file must exist AND contain a pattern. A grep over a missing file is a
# vacuous truth, which is how a negative assertion passes for the wrong reason.
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

# REAL-ROOT: a command that must exit 0 in the actual working tree.
cmd_ok() {
  local label="$1"; shift
  if (( IS_REAL_ROOT == 0 )); then skip "$label"; return; fi
  CHECKED=$((CHECKED+1)); PRESENT=$((PRESENT+1))
  if ( cd "$ROOT" && "$@" >/dev/null 2>&1 ); then ok "$label"; else bad "$label — \`$*\` exited non-zero"; fi
}

phase_0() {
  echo "Phase 0 — Scaffolding and cross-model review"
  has_file ".claude/tdd-guardian/plan-20260809-followups.md" "plan file (WI-0.1)"
  has_file "scripts/check-followups-phase.sh"                "DoD checker (WI-0.1)"
  has_file "scripts/check-followups-phase.test.mjs"          "DoD checker test (WI-0.1)"
  has_text ".claude/tdd-guardian/plan-20260809-followups.md" \
           "Review thread: *0[0-9a-f]{7}" "cross-model review recorded (WI-0.2, governance §6)"
}

phase_1() {
  echo "Phase 1 — Repair the linkage gate (F3)"
  has_file "scripts/check-wi-linkage.test.mjs" "linkage gate has a test (WI-1.4)"
  # The property, not the file: the predecessor plan must report zero unlinked
  # (WI-1.1 gates-tier glob) and extract 21 work items, not 22 (WI-1.2 phantom
  # prose ID). Both are only checkable against the real tree and real git.
  cmd_ok "predecessor plan reports 0 unlinked (WI-1.1)" \
         bash scripts/check-wi-linkage.sh .claude/tdd-guardian/plan-20260803-161713.md
  if (( IS_REAL_ROOT == 1 )); then
    CHECKED=$((CHECKED+1)); PRESENT=$((PRESENT+1))
    local n
    n=$(cd "$ROOT" && bash scripts/check-wi-linkage.sh \
          .claude/tdd-guardian/plan-20260803-161713.md 2>/dev/null \
        | sed -n 's/^WIs found: *\([0-9]*\).*/\1/p')
    if [[ "$n" == "21" ]]; then ok "extracts exactly 21 work items (WI-1.2)"
    else bad "extracts ${n:-?} work items, expected 21 — prose IDs still counted (WI-1.2)"; fi
  else
    skip "extracts exactly 21 work items (WI-1.2)"
  fi
}

phase_2() {
  echo "Phase 2 — Prove the unproven gates (F1, F2)"
  # A workflow FILE is not a workflow VERDICT. F1 is closed by a recorded run
  # id + SHA, which is why the assertion reads the header rather than the path.
  has_text ".github/workflows/tier0-e2e.yml" \
           "First green run: *[0-9]{6,} @ [0-9a-f]{7,}" "tier0-e2e first green run recorded (WI-2.1)"
  has_file "scripts/check-gate-liveness.mjs"        "gate-liveness checker (WI-2.3)"
  has_file "scripts/check-gate-liveness.test.mjs"   "gate-liveness test (WI-2.3)"
  has_file ".github/workflows/gate-liveness.yml"    "gate-liveness schedule (WI-2.3)"
  cmd_ok "gate-liveness passes against real run history (WI-2.3)" \
         node scripts/check-gate-liveness.mjs
}

phase_3() {
  echo "Phase 3 — Frozen debt becomes scheduled debt (F5)"
  has_text "scripts/baselineRatchetManifest.mjs" "review: *\{" "manifest carries review dates (WI-3.1)"
  lacks_text ".claude/rules/00-engineering-principles.md" \
             "153 pre-existing" "rules no longer quote a live gate count (WI-3.3)"
  cmd_ok "baseline ratchet green with review dates active (WI-3.2)" \
         node scripts/check-baseline-ratchet.mjs origin/main
}

phase_4() {
  echo "Phase 4 — A control on change size (F4)"
  has_file "scripts/check-change-size.sh"      "change-size gate (WI-4.1)"
  has_file "scripts/check-change-size.test.mjs" "change-size gate test (WI-4.2)"
  has_text ".github/workflows/ci.yml" "check-change-size\.sh" "gate wired into ci.yml PR tier (WI-4.1)"
  has_text ".claude/rules/60-ai-governance.md" "[Cc]hange size" "governance records the control (WI-4.2)"
}

phase_5() {
  echo "Phase 5 — Documentation hygiene"
  has_file "dev-docs/README.md" "dev-docs index exists (WI-5.1)"
  has_text ".claude/rules/60-ai-governance.md" \
           "\.claude/tdd-guardian" "governance §1 names both plan homes (WI-5.2)"
}

run_phase() {
  PASS=0; FAIL=0; PRESENT=0; CHECKED=0
  "phase_$1"
  if (( PRESENT == 0 )); then
    echo "  → Phase $1: NOT STARTED (0 of $CHECKED deliverables present)"
    echo
    return 1
  fi
  if (( FAIL > 0 )); then
    echo "  → Phase $1: INCOMPLETE ($PASS passed, $FAIL failed)"
    echo
    return 1
  fi
  echo "  → Phase $1: DONE ($PASS passed)"
  echo
  return 0
}

RC=0
if [[ "$PHASE" == "all" ]]; then
  for p in 0 1 2 3 4 5; do run_phase "$p" || RC=1; done
  (( IS_REAL_ROOT == 0 )) && echo "note: fixture root — REAL-ROOT assertions were skipped."
  if (( RC == 0 )); then echo "✅ every phase DONE"; else echo "❌ plan incomplete"; fi
else
  run_phase "$PHASE" || RC=1
fi
exit $RC
