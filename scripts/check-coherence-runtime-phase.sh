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

# Run a filtered subset of the LIB test suite (the coherence modules keep their
# tests in sibling *.test.rs, not tests/). Fails closed if the filter matches
# zero tests, so a renamed module can never silently "pass".
assert_cargo_lib_test() {
  local filter="$1"; local label="$2"
  if [[ "${SKIP_TESTS:-0}" == "1" ]]; then
    fail "SKIP_TESTS=1 — $label not run (fail-closed)"; return
  fi
  local safe; safe="$(echo "$filter" | tr -c 'A-Za-z0-9' '_')"
  local log="/tmp/rt-lib-$safe.log"
  if cargo test --manifest-path src-tauri/Cargo.toml --lib "$filter" >"$log" 2>&1; then
    if grep -qE "test result: ok\. [1-9]" "$log"; then
      ok "$label green"
    else
      fail "$label matched 0 tests (filter '$filter' — renamed?)"
    fi
  else
    fail "$label FAILED (see $log)"
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
  # WI-1.4 — checker robustness (cost/budget/backoff/resume/manifest).
  assert_cargo_lib_test "coherence::check_sweep::"          "WI-1.4 checker robustness tests"
  # WI-1.1 — volume harness + run manifest (coverage/cursor/cost).
  assert_cargo_lib_test "coherence::check_sweep_run::"      "WI-1.1 sweep run manifest tests"
  # WI-1.2 — drift-gauge baseline: a REAL, content-hash-pinned run.
  assert_file "$GRILLS/drift-baseline-20260720.md"          "WI-1.2 drift baseline"
  assert_grep "Status: REAL RUN" "$GRILLS/drift-baseline-20260720.md" "WI-1.2 baseline is a real run"
  assert_grep "content-hash" "$GRILLS/drift-baseline-20260720.md"     "WI-1.2 baseline content-hash pinned"
  assert_file "$GRILLS/verify-at-volume-baseline.md"        "verify-at-volume record"
  # WI-1.3 — the LIVE volume sweep + owner-judged M2/M4/M5 need the running
  # app + provider + a human session; the baseline doc itself flags this as
  # owner/app/provider-gated. Honest fail-closed until the owner records it.
  assert_grep "live sweep: ✅ done" "$GRILLS/verify-at-volume-baseline.md" \
    "WI-1.3 live sweep + M2/M4/M5 owner sign-off recorded"
}

# ─── Phase 2 — relationship classifier (edge-kind registry) ──────────────
phase_2() {
  echo "Phase 2 — relationship classifier (edge-kind registry)"
  assert_file "src-tauri/src/coherence/edge_kind.rs"        "WI-2.1 edge_kind registry"
  assert_cargo_lib_test "coherence::edge_kind::"            "WI-2.1 edge_kind registry tests"
  # The version axis is a typed kind that gates propagation, and it is persisted.
  assert_grep "OriginEdgeKind" "src-tauri/src/coherence/project.rs" "WI-2.1 project_edge gates on kind"
  assert_grep "edge_kind" "src-tauri/src/coherence/index.rs" "WI-2.4 edge_kind persisted (schema)"
}

# ─── Phase 3.0 — accept primitives ───────────────────────────────────────
phase_30() {
  echo "Phase 3.0 — accept primitives"
  assert_cargo_lib_test "coherence::read_view::"           "WI-3.0a bounded ReadView tests"
  assert_cargo_lib_test "coherence::operator_accept::"     "WI-3.0c accept idem tests"
  assert_cargo_lib_test "coherence::accept_precondition::" "WI-3.0e reproject precondition tests"
  # WI-3.0b — idem-receipt fast path is persisted (schema v5) + queried.
  assert_grep "fn entry_id_by_idem" "src-tauri/src/coherence/index_state.rs" "WI-3.0b idem-receipt lookup"
}

# ─── Phase 3 — forward operators (single-object) ─────────────────────────
phase_3() {
  echo "Phase 3 — forward operators (single-object)"
  # SP0 integration gate — functional + fault gates PASS.
  assert_file "$GRILLS/spike-sp0-operator-slice.md"        "SP0 operator-slice report"
  assert_grep "FUNCTIONAL + FAULT GATES PASS" "$GRILLS/spike-sp0-operator-slice.md" "SP0 functional+fault PASS"
  # The operator runtime: propose (operator) → preview (dry-run) → accept.
  assert_cargo_lib_test "coherence::operator::"            "WI-3.2 operator runtime tests"
  assert_cargo_lib_test "coherence::preview::"             "WI-3.1 dry-run projection tests"
  assert_cargo_lib_test "coherence::accept::"              "WI-3.4 commit-on-accept tests"
  assert_cargo_lib_test "coherence::operator_verify::"     "WI-3.3 verify scaffold tests"
  # WI-3.6 — the MCP operator surface (propose/preview/accept), read-only + human.
  assert_file "src-tauri/src/coherence/operator_commands.rs" "WI-3.6 operator MCP commands"
  # The absolute 500k-scale perf benchmark (20 ms / 16 MiB) is a criterion
  # harness the SP0 report flags PENDING — headlessly buildable, not yet done.
  assert_grep "perf benchmark: ✅ PASS" "$GRILLS/spike-sp0-operator-slice.md" \
    "WI-3.4 absolute-scale perf benchmark landed"
}

# ─── Phase 4 — canon-hub + Extract-Canon (PROTOTYPE, NOT ship-ready) ──────
phase_4() {
  echo "Phase 4 — canon-hub + Extract-Canon"
  # SP-canon design gate (the Phase-4 prerequisite).
  assert_file "$GRILLS/spike-sp-canon.md"                  "SP-canon report"
  assert_grep "DESIGN RESOLVED" "$GRILLS/spike-sp-canon.md" "SP-canon design resolved"
  # The prototype artifacts exist and pass their own tests.
  assert_cargo_lib_test "coherence::extract_canon::"       "WI-4.3 Extract-Canon tests"
  assert_cargo_lib_test "coherence::accept_group::"        "group-commit tests"
  # HONEST fail-closed: the G-B review returned MAJOR GAPS. The group-commit is
  # a prototype pending a group-boundary redesign (durable group identity #1,
  # whole-group preflight #2, defined partial-recovery #3, cross-process #7,
  # preview-new-edges #5) + a G-B re-review. Phase 4 is NOT complete.
  # Passes ONLY on an unambiguous positive marker — never on "NOT ship-ready".
  assert_grep "group-commit: ✅ ship-ready (G-B re-review PASS)" "$PLAN" \
    "Phase 4 group-commit passed its redesign + G-B re-review"
}

# ─── Phase 5 — semantic-merge auditor ────────────────────────────────────
phase_5() {
  echo "Phase 5 — semantic-merge auditor"
  # SP4 mapping gate.
  assert_file "$GRILLS/spike-sp4-merge-mapping.md"         "SP4 merge-mapping report"
  # WI-5.1 — merge → files → objects → edges, end-to-end over a real git merge.
  assert_cargo_lib_test "coherence::merge_audit::"         "WI-5.1 merge-affected edge set tests"
  assert_cargo_lib_test "coherence::gitops::"              "WI-5.1 git merge-diff tests"
  # WI-5.2 — the auditor command surface (read-only).
  assert_grep "coherence_merge_audit" "src-tauri/src/coherence/merge_audit.rs" "WI-5.2 merge-audit command"
}

# ─── Phase 6 — projection framework ──────────────────────────────────────
phase_6() {
  echo "Phase 6 — projection framework"
  assert_file "$GRILLS/design-projection-framework.md"     "Phase 6 design pass"
  # WI-6.1 — the shared read-model contract (Projection trait + CoherenceRow).
  assert_file "src-tauri/src/coherence/read_model.rs"      "WI-6.1 read-model contract"
  assert_cargo_lib_test "coherence::read_model::"          "WI-6.1 read-model tests"
  assert_grep "trait Projection" "src-tauri/src/coherence/read_model.rs" "WI-6.1 Projection trait defined"
}

case "$PHASE" in
  0)   phase_0 ;;
  1)   phase_1 ;;
  2)   phase_2 ;;
  3.0) phase_30 ;;
  3)   phase_3 ;;
  4)   phase_4 ;;
  5)   phase_5 ;;
  6)   phase_6 ;;
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
