#!/usr/bin/env bash
#
# DoD checker for the baseline debt paydown plan.
# Plan: .claude/tdd-guardian/plan-20260809-debt-paydown.md
#
# Usage: bash scripts/check-paydown-phase.sh <0-4|all> [--root=<dir>]
#
# THE BASELINES ARE THE DoD (plan ADR-1). Every phase assertion reads the real
# baseline file that `pnpm lint:*` reads, rather than counting the work another
# way. A second definition of "how much debt is left" can disagree with the
# gate's, and then neither is trusted.
#
# Exit codes: 0 phase complete · 1 incomplete / not started · 64 bad invocation
#
# A phase with nothing done reports NOT STARTED, which does not share an exit
# code with DONE.
#
# There is deliberately NO ``UNVERIFIED`` state here, unlike the predecessor
# checker: every assertion reads a file that is always present, so nothing can
# be skipped. An earlier draft copied that branch across anyway and nothing ever
# incremented its counter — a contract asserted in a header and unreachable in
# the code, which is the exact defect this line of work exists to delete, in the
# file written to police it. Cross-model review 019fe5eb caught it (Dim 1 #5).
#
# @coordinates-with .claude/tdd-guardian/plan-20260809-debt-paydown.md

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
Usage: bash scripts/check-paydown-phase.sh <0-4|all> [--root=<dir>]

  0    Scaffolding and cross-model review
  1    Shakedown: merge-drop-allowlist + knip
  2    command-error 99 -> 0
  3    mock-boundaries 274 -> 0
  4    bespoke-buttons 168 -> down
  all  Every phase, one report
EOF
}

[[ -z "$PHASE" ]] && { usage; exit 64; }
case "$PHASE" in 0|1|2|3|4|all) ;; *) echo "unknown phase: $PHASE" >&2; usage; exit 64 ;; esac
[[ -d "$ROOT" ]] || { echo "--root is not a directory: $ROOT" >&2; exit 64; }

PASS=0; FAIL=0; PRESENT=0; CHECKED=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

has_file() {
  local rel="$1" label="${2:-$1}"
  CHECKED=$((CHECKED+1))
  if [[ -f "$ROOT/$rel" ]]; then PRESENT=$((PRESENT+1)); ok "$label"; else bad "$label — missing: $rel"; fi
}

has_text() {
  local rel="$1" pat="$2" label="$3"
  CHECKED=$((CHECKED+1))
  if [[ ! -f "$ROOT/$rel" ]]; then bad "$label — missing: $rel"; return; fi
  PRESENT=$((PRESENT+1))
  if grep -qE -- "$pat" "$ROOT/$rel"; then ok "$label"; else bad "$label — $rel lacks /$pat/"; fi
}

# Count debt in a baseline, the way the ratchet counts it. `mode` selects the
# shape: sum of numeric values, number of records, or a named scalar.
count() {
  local rel="$1" mode="$2" at="${3:-}"
  [[ -f "$ROOT/$rel" ]] || { echo ""; return; }
  ROOT="$ROOT" REL="$rel" MODE="$mode" AT="$at" node -e '
    // No top-level `return` — node -e compiles the body as a script, where it is
    // a syntax error. Everything lives in a function that returns a value.
    const fs = require("fs");
    const isComment = (k) => k.startsWith("//") || k.startsWith("_");
    const compute = () => {
      const doc = JSON.parse(fs.readFileSync(`${process.env.ROOT}/${process.env.REL}`, "utf8"));
      const at = process.env.AT;
      const node = at ? at.split(".").reduce((a, k) => (a == null ? undefined : a[k]), doc) : doc;
      if (node == null) return 0;
      if (process.env.MODE === "sum") {
        const sum = (o) => Object.entries(o).reduce(
          (n, [k, v]) => n + (isComment(k) ? 0
            : typeof v === "number" ? v
            : v && typeof v === "object" ? sum(v) : 0), 0);
        return typeof node === "object" ? sum(node) : 0;
      }
      if (process.env.MODE === "records") {
        return Array.isArray(node) ? node.length
          : Object.keys(node).filter((k) => !isComment(k)).length;
      }
      return typeof node === "number" ? node : 0;
    };
    process.stdout.write(String(compute()));
  ' 2>/dev/null || echo ""
}

# Assert a baseline has reached `want` (or below).
at_most() {
  local label="$1" got="$2" want="$3"
  CHECKED=$((CHECKED+1))
  if [[ -z "$got" ]]; then bad "$label — baseline unreadable"; return; fi
  PRESENT=$((PRESENT+1))
  if (( got <= want )); then ok "$label ($got ≤ $want)"; else bad "$label — still $got, target $want"; fi
}

phase_0() {
  echo "Phase 0 — Scaffolding and cross-model review"
  has_file ".claude/tdd-guardian/plan-20260809-debt-paydown.md" "plan file (WI-DP0.1)"
  has_file "scripts/check-paydown-phase.sh"                     "DoD checker (WI-DP0.1)"
  has_file "scripts/check-paydown-phase.test.mjs"               "DoD checker test (WI-DP0.1)"
  has_text ".claude/tdd-guardian/plan-20260809-debt-paydown.md" \
           "Review thread: *\`?0[0-9a-f]{7}" "cross-model review recorded (WI-DP0.2, governance §6)"
  # This plan pays down the register the predecessor built; without it there is
  # nothing to measure against (stated as a risk in the plan).
  has_file "scripts/baseline-review-schedule.json" "debt register present (stacked dependency)"
}

phase_1() {
  echo "Phase 1 — Shakedown: merge-drop-allowlist + knip"
  at_most "merge-drop-allowlist cleared (WI-DP1.1)" "$(count scripts/merge-drop-allowlist.json records)" 0
  at_most "knip findings cleared (WI-DP1.2)"        "$(count scripts/knip-baseline.json sum)" 0
}

phase_2() {
  echo "Phase 2 — command-error 99 -> 0"
  at_most "legacy Result<T, String> signatures (WI-DP2.x)" \
          "$(count scripts/command-error-baseline.json sum files)" 0
}

phase_3() {
  echo "Phase 3 — mock-boundaries 274 -> 0"
  at_most "store mocks in tests (WI-DP3.x)" \
          "$(count scripts/mock-boundaries-baseline.json records entries)" 0
}

phase_4() {
  echo "Phase 4 — bespoke-buttons 168 -> down"
  # "Down", not zero: the plan's target is a reduction, and the honest assertion
  # is BELOW the starting measurement. A phase that passed at 88/80 would
  # certify having done nothing.
  local named styled
  named=$(count scripts/bespoke-buttons-baseline.json scalar maxBespokeButtonClasses)
  styled=$(count scripts/bespoke-buttons-baseline.json scalar maxStyledButtonClasses)
  at_most "bespoke button classes below the 88 starting point (WI-DP4.1)" "$named" 87
  at_most "styled button classes below the 80 starting point (WI-DP4.1)"  "$styled" 79
}

run_phase() {
  PASS=0; FAIL=0; PRESENT=0; CHECKED=0
  "phase_$1"
  if (( PRESENT == 0 )); then
    echo "  → Phase $1: NOT STARTED (0 of $CHECKED deliverables present)"; echo; return 1
  fi
  if (( FAIL > 0 )); then
    echo "  → Phase $1: INCOMPLETE ($PASS passed, $FAIL failed)"; echo; return 1
  fi
  echo "  → Phase $1: DONE ($PASS passed)"; echo; return 0
}

RC=0
if [[ "$PHASE" == "all" ]]; then
  for p in 0 1 2 3 4; do run_phase "$p" || RC=1; done
  if (( RC == 0 )); then echo "✅ every phase DONE"; else echo "❌ paydown incomplete"; fi
else
  run_phase "$PHASE" || RC=1
fi
exit $RC
