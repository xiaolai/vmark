#!/usr/bin/env bash
#
# DoD checker for the Coherence Layer plan.
# Plan: dev-docs/plans/20260718-coherence-layer.md
# Spec: dev-docs/specs/coherence-format-v0.md
#
# Usage: bash scripts/check-coherence-phase.sh <phase-number>
#
# Each phase block runs assertions for that phase's Definition of Done.
# Exit 0 iff all assertions pass. Run before ticking the plan's Status
# header (rule 60 §3). Template: scripts/check-gha-phase.sh.
#
# Phase 0: format spec + kernel decisions, gates G1/G2 PASS, spikes S1-S4
#          reported, M1-M5 baselines set, paper §3.4 gaps closed.
# Phase 1: Rust kernel + breakdown view + read-only MCP tools + docs.
# Phases 2a/2b/3/4: stubs — decomposed by plan amendment after Phase 2a.

set -uo pipefail

cd "$(dirname "$0")/.."

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase-number>"
  echo "  0   Format spec, gates, spikes"
  echo "  1   Kernel + breakdown view + read-only MCP"
  echo "  2a  Semantic-model design session (stub)"
  echo "  2b  Semantic layer (stub)"
  echo "  3   Human-edit inference + git contexts (stub)"
  echo "  4   Verticals (stub)"
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

assert_status_pass() {
  local file="$1"; local label="$2"
  if [[ -f "$file" ]] && grep -E -q "^> Status: \*\*PASS" "$file"; then
    ok "$label marked PASS"
  else
    fail "$label not marked PASS in status header ($file)"
  fi
}

SPEC="dev-docs/specs/coherence-format-v0.md"
PLAN="dev-docs/plans/20260718-coherence-layer.md"
PAPER="dev-docs/coherence-layer-paper.md"
GRILLS="dev-docs/grills/coherence"

# ─── Phase 0 ─────────────────────────────────────────────────────────────
phase_0() {
  echo "Phase 0 — Format spec, kernel decisions, gates, spikes"

  # WI-0.1 / WI-0.2 — the spec and its required sections.
  assert_file "$SPEC" "WI-0.1 format spec"
  assert_grep "## 5. Ledger (R17)"                 "$SPEC" "WI-0.1 ledger schema section"
  assert_grep "## 6. Contexts"                     "$SPEC" "WI-0.1 pin-manifest section"
  assert_grep "## 7. Input-set taxonomy (R24)"     "$SPEC" "WI-0.1 input-set taxonomy"
  assert_grep "## 3. Canonicalization and hashing" "$SPEC" "WI-0.1 hashing canonicalization"
  assert_grep "## 8. Provenance confidence (R28)"  "$SPEC" "WI-0.1 provenance-confidence states"
  assert_grep "5.4.4 \`check-result\` (R25)"       "$SPEC" "WI-0.1 semantic-check result schema"
  assert_grep "5.4.5 \`claim\` (R32)"              "$SPEC" "WI-0.1 bi-temporal claim schema"
  assert_grep "5.4.3 \`ratification\` and \`waiver\`" "$SPEC" "WI-0.1 waiver/ratification schema"
  assert_grep "## 9. Staleness computation"        "$SPEC" "WI-0.2 staleness algorithm"
  assert_grep "file-level"                         "$SPEC" "WI-0.2 granularity decision (R31)"
  assert_grep "multi-writer protocol"              "$SPEC" "WI-0.2 multi-writer protocol (O7)"
  assert_grep "## 10. Performance targets (O6)"    "$SPEC" "WI-0.2 performance targets"

  # WI-0.3 — Gate G1.
  assert_file "$GRILLS/gate-g1.md"                    "WI-0.3 G1 report"
  assert_status_pass "$GRILLS/gate-g1.md"             "WI-0.3 G1"
  assert_file "$GRILLS/probes/g1-capture.mjs"         "WI-0.3 G1 probe"
  assert_file "$GRILLS/probes/g1-results.json"        "WI-0.3 G1 results"
  assert_grep "Write-path inventory" "$GRILLS/gate-g1.md" "WI-0.3 inventory table present"

  # WI-0.4 — Gate G2.
  assert_file "$GRILLS/gate-g2.md"                    "WI-0.4 G2 report"
  assert_status_pass "$GRILLS/gate-g2.md"             "WI-0.4 G2"
  assert_file "$GRILLS/probes/g2-gitops.mjs"          "WI-0.4 G2 probe"
  assert_file "$GRILLS/probes/g2-results.json"        "WI-0.4 G2 results"

  # WI-0.5 — Spike S1.
  assert_file "$GRILLS/spike-s1.md"                   "WI-0.5 S1 report"
  assert_status_pass "$GRILLS/spike-s1.md"            "WI-0.5 S1"
  assert_file "$GRILLS/probes/s1-results.json"        "WI-0.5 S1 results"

  # WI-0.6 — Spike S2.
  assert_file "$GRILLS/spike-s2.md"                   "WI-0.6 S2 report"
  assert_status_pass "$GRILLS/spike-s2.md"            "WI-0.6 S2"
  assert_file "$GRILLS/probes/s2-rusqlite/results.json" "WI-0.6 S2 results"
  assert_grep "bundled" "$GRILLS/spike-s2.md"         "WI-0.6 ADR-C1 decision recorded"

  # WI-0.7 — Spikes S3 + S4.
  assert_file "$GRILLS/spike-s3.md"                   "WI-0.7 S3 report"
  assert_status_pass "$GRILLS/spike-s3.md"            "WI-0.7 S3"
  assert_file "$GRILLS/spike-s4.md"                   "WI-0.7 S4 report"
  assert_status_pass "$GRILLS/spike-s4.md"            "WI-0.7 S4"
  assert_grep "M3 baseline" "$GRILLS/spike-s4.md"     "WI-0.7 M3 baseline recorded"

  # WI-0.8 — evidence gaps closed in the paper.
  assert_grep "Known evidence gaps — resolved" "$PAPER" "WI-0.8 paper §3.4 updated"
  assert_grep "Jacquard" "$PAPER"                      "WI-0.8 Jacquard finding rowed"

  # WI-0.9 — M1-M5 baselines/exit thresholds in the spec.
  assert_grep "## 11. Metric baselines and exit thresholds" "$SPEC" "WI-0.9 M1-M5 section"
  for m in M1 M2 M3 M4 M5; do
    assert_grep "| $m |" "$SPEC" "WI-0.9 $m row"
  done
}

# ─── Phase 1 ─────────────────────────────────────────────────────────────
phase_1() {
  echo "Phase 1 — Rust kernel + breakdown view + read-only MCP"

  local K="src-tauri/src/coherence"

  # WI-1.1 — kernel scaffold + core types (ADR-C4 module boundaries).
  assert_file "$K/mod.rs"          "WI-1.1 kernel module"
  assert_file "$K/types.rs"        "WI-1.1 core types"
  assert_file "$K/types.test.rs"   "WI-1.1 core-types tests"
  assert_file "$K/project.rs"      "WI-1.1 projection (pure kernel, ADR-C4)"
  assert_file "$K/commands.rs"     "WI-1.1 Tauri command surface (ADR-C4)"

  # WI-1.2 — ledger.
  assert_file "$K/ledger.rs"       "WI-1.2 ledger"
  assert_file "$K/ledger.test.rs"  "WI-1.2 ledger tests"
  assert_grep "quarantine" "$K/ledger.rs" "WI-1.2 malformed-entry quarantine"

  # WI-1.3 — snapshot CAS + hashing.
  assert_file "$K/canonical.rs"      "WI-1.3 canonicalization"
  assert_file "$K/canonical.test.rs" "WI-1.3 canonicalization tests"
  assert_file "$K/cas.rs"            "WI-1.3 snapshot CAS"
  assert_file "$K/cas.test.rs"       "WI-1.3 CAS tests"
  assert_grep "identity" "$K/canonical.test.rs" "WI-1.3 identity-field exclusion test"

  # WI-1.4 — revision DAG + staleness.
  assert_file "$K/dag.rs"          "WI-1.4 revision DAG"
  assert_file "$K/dag.test.rs"     "WI-1.4 DAG tests"
  assert_grep "Diverged" "$K/dag.rs" "WI-1.4 diverged state first-class"

  # WI-1.5 — SQLite index; R16 delete-and-rebuild test.
  assert_file "$K/index.rs"        "WI-1.5 SQLite index"
  assert_file "$K/index.test.rs"   "WI-1.5 index tests"
  assert_grep "rusqlite" "src-tauri/Cargo.toml" "WI-1.5 rusqlite dependency"
  assert_grep "delete_index_rescan_identical\|delete.*rebuild.*identical" "$K/index.test.rs" "WI-1.5 R16 delete-and-rebuild test"

  # WI-1.6 — capture instrumentation (vertical slice + adapters + scan).
  assert_file "$K/capture.rs"      "WI-1.6 capture API"
  assert_file "$K/capture.test.rs" "WI-1.6 capture tests"
  assert_file "$K/scan.rs"         "WI-1.6 scan reconciliation"
  assert_file "$K/scan.test.rs"    "WI-1.6 scan tests (spec §9.4 table)"
  assert_grep "coherence_capture" "src/services/persistence/saveToPath.ts" "WI-1.6 editor-save funnel instrumented"

  # WI-1.7 — git reconciliation.
  assert_file "$K/gitops.rs"       "WI-1.7 git reconciliation"
  assert_file "$K/gitops.test.rs"  "WI-1.7 git tests"

  # WI-1.8 — frontmatter IDs.
  assert_file "$K/frontmatter.rs"      "WI-1.8 frontmatter IDs"
  assert_file "$K/frontmatter.test.rs" "WI-1.8 frontmatter tests"
  assert_grep "duplicate" "$K/frontmatter.rs" "WI-1.8 duplicate-ID detection"

  # I5 append-only property test (plan-level success criterion 2).
  if grep -rq "append_only\|append-only" "$K"/*.test.rs 2>/dev/null; then
    ok "I5 append-only property test present"
  else
    fail "I5 append-only property test not found in $K/*.test.rs"
  fi

  # WI-1.12 — lifecycle.
  assert_file "$K/state.rs"        "WI-1.12 per-workspace kernel state"
  assert_file "$K/state.test.rs"   "WI-1.12 lifecycle tests"

  # WI-1.9a — resolution write API.
  assert_grep "coherence_resolve" "$K/commands.rs" "WI-1.9a resolution command"

  # WI-1.9b — breakdown view.
  assert_file "src/stores/breakdownStore.ts"       "WI-1.9b breakdown store"
  assert_file "src/stores/breakdownStore.test.ts"  "WI-1.9b store tests"
  assert_file "src/components/BreakdownPanel/BreakdownPanel.tsx" "WI-1.9b panel"
  assert_file "src/components/BreakdownPanel/BreakdownPanel.test.tsx" "WI-1.9b panel tests"

  # WI-1.10 — read-only MCP tools.
  assert_file "vmark-mcp-server/src/tools/coherence.ts" "WI-1.10 sidecar tool"
  assert_grep "coherence_status" "vmark-mcp-server/src/tools/coherence.ts" "WI-1.10 coherence_status"
  assert_grep "coherence_edges"  "vmark-mcp-server/src/tools/coherence.ts" "WI-1.10 coherence_edges"

  # WI-1.11 — docs.
  assert_file "website/guide/coherence.md"          "WI-1.11 website guide page"
  assert_grep "coherence" "dev-docs/README.md"      "WI-1.11 dev-docs README index"

  # Phase-1 DoD extras from the plan.
  assert_file "$GRILLS/phase1-e2e.md"               "breakdown-view E2E record (Tauri MCP)"
  assert_file "$GRILLS/dogfood-log.md"              "dogfood log with M1 entry"
  assert_grep "M1" "$GRILLS/dogfood-log.md"         "M1 recorded in dogfood log"

  # Fail closed: RUN the coherence test suites (Codex review D2#5) instead
  # of reminding. Scoped runs keep this fast enough for a gate.
  if [[ "${SKIP_TESTS:-}" == "1" ]]; then
    # Progress-report mode: file assertions still print, but the run can
    # NEVER tick a phase — count it as a hard failure by construction.
    fail "SKIP_TESTS=1 set — test suites not run; this run cannot tick Phase 1"
  else
    if cargo test --manifest-path src-tauri/Cargo.toml --lib coherence -- --quiet >/dev/null 2>&1; then
      ok "cargo test coherence suite green"
    else
      fail "cargo test coherence suite RED (run: cargo test --manifest-path src-tauri/Cargo.toml --lib coherence)"
    fi
    if pnpm vitest run src/stores/breakdownStore.test.ts src/components/BreakdownPanel >/dev/null 2>&1; then
      ok "breakdown-view vitest suites green"
    else
      fail "breakdown-view vitest suites RED (run: pnpm vitest run src/stores/breakdownStore.test.ts src/components/BreakdownPanel)"
    fi
    # Full repo gate — part of the DoD, run for real (fail closed; slow but
    # a phase tick is rare). No reminder-only escape.
    if pnpm check:all >/dev/null 2>&1; then
      ok "pnpm check:all green"
    else
      fail "pnpm check:all RED"
    fi
  fi

  echo "  ⓘ WI linkage: bash scripts/check-wi-linkage.sh $PLAN --phase=1"
}

# ─── Stubs ───────────────────────────────────────────────────────────────
phase_stub() {
  echo "Phase $1 — stub (decomposed by plan amendment after Phase 2a; rule 60 §3)"
  fail "Phase $1 DoD assertions not yet defined"
}

case "$PHASE" in
  0) phase_0 ;;
  1) phase_1 ;;
  2a|2b|3|4) phase_stub "$PHASE" ;;
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
