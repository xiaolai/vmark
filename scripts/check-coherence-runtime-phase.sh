#!/usr/bin/env bash
#
# DoD checker for the Coherence RUNTIME LAYER plan.
# Plan:   dev-docs/plans/20260719-coherence-runtime-layer.md
# Design: dev-docs/grills/coherence/design-runtime.md (v4)
#
# Usage: bash scripts/check-coherence-runtime-phase.sh <phase>
#
# Exit 0 iff all of that phase's Definition-of-Done assertions pass. Run before
# ticking the plan's Status header (rule 60 §3). Template: check-coherence-phase.sh.
#
# Phases (see the plan):
#   0    Spikes (SP1 green, SP3 decision) + entry-gate addendum + this script.
#   1    Verify at volume — run manifest (live-edge coverage/cost/resume) + drift baseline.
#   2    Relationship classifier — version axis as an edge_kind registry entry.
#   3.0  Accept primitives (ReadView, idem-receipt, transient check, reproject-under-lock).
#   3    Forward operators — SP0 PASS + preview/verify/accept + guardrails.
#   4    Canon-hub (outlined; SP-canon first) — fail-closed.
#   5    Merge auditor (SP4 first) — fail-closed.
#   6    Projection framework (design pass first) — fail-closed.

set -uo pipefail
cd "$(dirname "$0")/.."

# pnpm may be absent from non-login shells (mise-managed node); fall back to the
# mise shim so the gate itself never fails on PATH.
if ! command -v pnpm >/dev/null 2>&1 && [ -x "$HOME/.local/share/mise/shims/pnpm" ]; then
  PATH="$HOME/.local/share/mise/shims:$PATH"
fi

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase>  (0 | 1 | 2 | 3.0 | 3 | 4 | 5 | 6)"
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

# Accept both blockquote status styles: "> **Status: PASS" and "> Status: **PASS".
assert_status_pass() {
  local file="$1"; local label="$2"
  if [[ -f "$file" ]] && grep -E -q "^> (\*\*Status: PASS|Status: \*\*PASS)" "$file"; then
    ok "$label marked PASS"
  else
    fail "$label not marked PASS in status header ($file)"
  fi
}

# Run one cargo integration test and assert it is green. Heavy but authoritative;
# SKIP_TESTS=1 turns this into a fail-closed reminder (never a silent pass).
assert_cargo_test() {
  local test_name="$1"; local label="$2"
  if [[ "${SKIP_TESTS:-0}" == "1" ]]; then
    fail "SKIP_TESTS=1 — $label not run (fail-closed)"; return
  fi
  if cargo test --manifest-path src-tauri/Cargo.toml --test "$test_name" >/tmp/rt-$test_name.log 2>&1; then
    ok "$label green"
  else
    fail "$label FAILED (see /tmp/rt-$test_name.log)"
  fi
}

PLAN="dev-docs/plans/20260719-coherence-runtime-layer.md"
DESIGN="dev-docs/grills/coherence/design-runtime.md"
GRILLS="dev-docs/grills/coherence"

# ─── Phase 0 — spikes + entry gate ───────────────────────────────────────
phase_0() {
  echo "Phase 0 — spikes (SP1 green, SP3 decision) + entry gate"

  # WI-0.1 — SP1 dry-run projection over a disposable clone.
  assert_file "$GRILLS/spike-sp1-dry-run-projection.md"      "WI-0.1 SP1 report"
  assert_status_pass "$GRILLS/spike-sp1-dry-run-projection.md" "WI-0.1 SP1"
  assert_file "src-tauri/tests/spike_sp1_dry_run_projection.rs" "WI-0.1 SP1 probe"
  assert_cargo_test "spike_sp1_dry_run_projection"          "WI-0.1 SP1 test"

  # WI-0.3 — SP3 classifier placement (kernel registry decision recorded).
  assert_file "$GRILLS/spike-sp3-classifier-placement.md"   "WI-0.3 SP3 report"
  assert_status_pass "$GRILLS/spike-sp3-classifier-placement.md" "WI-0.3 SP3"
  assert_grep "kernel-level typed" "$GRILLS/spike-sp3-classifier-placement.md" "WI-0.3 ADR-P2 decision recorded"
  assert_file "src-tauri/tests/spike_sp3_edge_kind_registry.rs" "WI-0.3 SP3 probe"
  assert_cargo_test "spike_sp3_edge_kind_registry"          "WI-0.3 SP3 test"

  # WI-0.4 — entry-gate spec addendum (rev 3). Fail-closed until authored.
  assert_grep "rev 3" "dev-docs/specs/coherence-format-v0.md" "WI-0.4 spec addendum rev 3"

  # WI-0.5 — this script exists (self-check) and the plan is on the right contract.
  assert_file "scripts/check-coherence-runtime-phase.sh"    "WI-0.5 phase script"
  assert_grep "v2.0" "$PLAN"                                "WI-0.5 plan on paper v2.0"
  assert_grep "V4.9" "$DESIGN"                              "design v4 present"
}

# ─── Phase 1 — verify at volume ──────────────────────────────────────────
phase_1() {
  echo "Phase 1 — verify at volume + drift baseline"
  # Fail-closed until the volume harness + run manifest + drift baseline land.
  assert_file "$GRILLS/verify-at-volume-baseline.md"        "verify-at-volume record"
  fail "WI-1.1 run manifest (live-edge coverage/cursor/cost) not yet committed"
  fail "WI-1.2 drift-gauge baseline (content-hash-pinned) not yet committed"
  fail "WI-1.4 checker robustness volume-failure-path tests not yet green"
}

phase_2()   { echo "Phase 2 — classifier";        fail "WI-2.x edge_kind registry not yet implemented (fail-closed)"; }
phase_30()  { echo "Phase 3.0 — accept primitives"; fail "WI-3.0a..e primitives not yet implemented (fail-closed)"; }
phase_3()   { echo "Phase 3 — forward operators";  fail "SP0 + WI-3.x not yet implemented (fail-closed)"; }

# Outlined phases: decomposed by amendment after their design pass (rule 60 §3).
phase_stub() {
  echo "Phase $1 — outlined (decomposed by amendment after its design pass)"
  fail "Phase $1 DoD assertions not yet defined"
}

case "$PHASE" in
  0)   phase_0 ;;
  1)   phase_1 ;;
  2)   phase_2 ;;
  3.0) phase_30 ;;
  3)   phase_3 ;;
  4|5|6) phase_stub "$PHASE" ;;
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
