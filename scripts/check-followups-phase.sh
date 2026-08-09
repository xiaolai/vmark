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

PASS=0; FAIL=0; PRESENT=0; CHECKED=0; SKIPPED=0

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
# A skipped assertion is UNVERIFIED, never satisfied. Cross-model review
# (thread 019fe450, Dim 2 #2) caught this file doing the thing it exists to
# police: with only REAL-ROOT assertions skipped, a fixture phase printed DONE
# and exited 0 — a green verdict over work nobody checked. Skips now propagate.
skip() { echo "  · $1 — UNVERIFIED (REAL-ROOT only)"; SKIPPED=$((SKIPPED+1)); }

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
  has_file ".claude/tdd-guardian/plan-20260809-followups.md" "plan file (WI-AF0.1)"
  has_file "scripts/check-followups-phase.sh"                "DoD checker (WI-AF0.1)"
  has_file "scripts/check-followups-phase.test.mjs"          "DoD checker test (WI-AF0.1)"
  # Backtick-optional: the plan renders the id as `019fe450-…`.
  has_text ".claude/tdd-guardian/plan-20260809-followups.md" \
           "Review thread: *\`?0[0-9a-f]{7}" "cross-model review recorded (WI-AF0.2, governance §6)"
}

phase_1() {
  echo "Phase 1 — Repair the linkage gate (F3)"
  has_file "scripts/check-wi-linkage.test.mjs" "linkage gate has a test (WI-AF1.1)"
  # WI-AF1.4: the header claimed it checked only phases marked complete in the
  # plan's Status header. No code ever parsed one. The claim is deleted.
  lacks_text "scripts/check-wi-linkage.sh" \
             "^# - Phase numbering" "no false Status-header claim (WI-AF1.4)"
  # "0 unlinked" is the WEAK assertion and must never be the only one: while
  # this plan's own commit messages DESCRIBE the WI-16 bug, the string "WI-16"
  # appears in the commit log and the gate reports it linked — satisfied by
  # prose about the defect rather than by the fix (observed 2026-08-09, F6).
  # The 21-vs-22 count below is the load-bearing check.
  cmd_ok "predecessor plan reports 0 unlinked (WI-AF1.2)" \
         bash scripts/check-wi-linkage.sh .claude/tdd-guardian/plan-20260803-161713.md
  if (( IS_REAL_ROOT == 1 )); then
    CHECKED=$((CHECKED+1)); PRESENT=$((PRESENT+1))
    local n
    n=$(cd "$ROOT" && bash scripts/check-wi-linkage.sh \
          .claude/tdd-guardian/plan-20260803-161713.md 2>/dev/null \
        | sed -n 's/^WIs found: *\([0-9]*\).*/\1/p')
    if [[ "$n" == "21" ]]; then ok "extracts exactly 21 work items (WI-AF1.3)"
    else bad "extracts ${n:-?} work items, expected 21 — prose IDs still counted (WI-AF1.3)"; fi
  else
    skip "extracts exactly 21 work items (WI-AF1.3)"
  fi
  # F6: commit-side linkage must require the documented trailing-tag form, so a
  # commit that merely mentions an ID in prose cannot vouch for it.
  has_text "scripts/check-wi-linkage.sh" \
           "COMMIT_TAG" "commit linkage requires the tag form (WI-AF1.5)"
}

phase_2() {
  echo "Phase 2 — Prove the unproven gates (F1, F2)"
  # A workflow FILE is not a workflow VERDICT. F1 is closed by a recorded run
  # id + SHA, which is why the assertion reads the header rather than the path.
  has_text ".github/workflows/tier0-e2e.yml" \
           "First green run: *[0-9]{6,} @ [0-9a-f]{7,}" "tier0-e2e first green run recorded (WI-AF2.1)"
  has_file "scripts/check-gate-liveness.mjs"        "gate-liveness checker (WI-AF2.3)"
  has_file "scripts/check-gate-liveness.test.mjs"   "gate-liveness test (WI-AF2.3)"
  has_file ".github/workflows/gate-liveness.yml"    "gate-liveness schedule (WI-AF2.3)"
  cmd_ok "gate-liveness passes against real run history (WI-AF2.3)" \
         node scripts/check-gate-liveness.mjs
}

phase_3() {
  echo "Phase 3 — Frozen debt becomes scheduled debt (F5)"
  # ADR-1 (revised): the deadlines live in their OWN json baseline, not inside
  # the manifest module. The manifest is loaded from HEAD only and never at the
  # base ref, so dates kept there could not have been ratcheted at all.
  has_file "scripts/baseline-review-schedule.json" "review schedule exists (WI-AF3.2)"
  has_file "scripts/check-review-schedule.mjs"     "schedule validator (WI-AF3.2)"
  has_file "scripts/check-review-schedule.test.mjs" "validator test (WI-AF3.1)"
  has_text "scripts/baselineRatchetManifest.mjs" "baseline-review-schedule\.json" \
           "schedule registered in the ratchet (WI-AF3.2)"
  has_file ".github/workflows/baseline-review.yml" "overdue reporter schedule (WI-AF3.3)"
  cmd_ok "every baseline is dated or justifiably exempt (WI-AF3.4)" \
         node scripts/check-review-schedule.mjs
  lacks_text ".claude/rules/00-engineering-principles.md" \
             "153 pre-existing" "rules no longer quote a live gate count (WI-AF3.3)"
  cmd_ok "baseline ratchet green with review dates active (WI-AF3.2)" \
         node scripts/check-baseline-ratchet.mjs origin/main
}

phase_4() {
  echo "Phase 4 — A control on change size (F4)"
  has_file "scripts/check-change-size.mjs"     "change-size gate (WI-AF4.1)"
  has_file "scripts/check-change-size.test.mjs" "change-size gate test (WI-AF4.2)"
  has_text ".github/workflows/ci.yml" "check-change-size\.mjs" "gate wired into ci.yml PR tier (WI-AF4.1)"
  # §13, not §12 — §12 is already taken by the dark-feature verdicts
  # (60-ai-governance.md:326). Caught by review 019fe450, Dim 1 #4.
  has_text ".claude/rules/60-ai-governance.md" "^## 13\." "governance §13 records the control (WI-AF4.2)"
}

phase_5() {
  echo "Phase 5 — Documentation hygiene"
  # dev-docs/ is gitignored (.gitignore:8), so a clean CI checkout does not have
  # it and CANNOT satisfy this. Requiring it unconditionally would make the
  # phase pass only on a maintainer machine — "green on my machine" wearing a
  # gate's uniform (review 019fe450, Dim 2 #3). Where the tree has no dev-docs/
  # at all, the assertion is UNVERIFIED, not passed.
  CHECKED=$((CHECKED+1))
  if [[ -d "$ROOT/dev-docs" ]]; then
    PRESENT=$((PRESENT+1))
    if [[ -f "$ROOT/dev-docs/README.md" ]]; then ok "dev-docs index exists (WI-AF5.1)"
    else bad "dev-docs index exists (WI-AF5.1) — missing: dev-docs/README.md"; fi
  else
    skip "dev-docs index (WI-AF5.1) — maintainer-local, gitignored"
  fi
  # Both authorities, not one: AGENTS.md:303 mandates dev-docs/plans/ too, so
  # amending only the rules file leaves the repo contradicting itself.
  has_text ".claude/rules/60-ai-governance.md" \
           "\.claude/tdd-guardian" "governance §1 names both plan homes (WI-AF5.2)"
  has_text "AGENTS.md" "\.claude/tdd-guardian" "AGENTS.md agrees with §1 (WI-AF5.2)"
}

run_phase() {
  PASS=0; FAIL=0; PRESENT=0; CHECKED=0; SKIPPED=0
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
  if (( SKIPPED > 0 )); then
    echo "  → Phase $1: UNVERIFIED ($PASS passed, $SKIPPED unverified — run without --root)"
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
