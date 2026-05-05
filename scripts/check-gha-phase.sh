#!/usr/bin/env bash
#
# DoD checker for the GitHub Actions Workflow Viewer plan.
# Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md
#
# Usage: bash scripts/check-gha-phase.sh <phase-number>
#
# Each phase block runs assertions for that phase's Definition of Done.
# Exit code is 0 if all assertions pass, 1 if any fail. Run before ticking
# the plan's Status header to the next phase.
#
# Phase 0: feasibility spikes — must be present and PASS-marked.
# Phase 1: foundation parser + IR.
# Phase 2-9: stubs (filled in as each phase begins).

set -uo pipefail

cd "$(dirname "$0")/.."

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase-number>"
  echo "  0  Feasibility spikes"
  echo "  1  Foundation: parser + IR"
  echo "  2  Standalone file viewer"
  echo "  3  Code-fence inline preview"
  echo "  4  Exports"
  echo "  5  Validation"
  echo "  6  Action input discovery"
  echo "  7  Structured editor"
  echo "  8  CST round-trip"
  echo "  9  Polish"
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

assert_dir() {
  local path="$1"; local label="${2:-$1}"
  if [[ -d "$path" ]]; then ok "$label exists"; else fail "$label missing: $path"; fi
}

assert_grep() {
  local pattern="$1"; local file="$2"; local label="$3"
  if grep -q -- "$pattern" "$file" 2>/dev/null; then ok "$label"; else fail "$label (pattern '$pattern' not in $file)"; fi
}

assert_wc_min() {
  local path="$1"; local min="$2"; local label="$3"
  local n
  if [[ -f "$path" ]]; then
    n=$(wc -l <"$path" | tr -d ' ')
    if (( n >= min )); then ok "$label ($n lines)"; else fail "$label (only $n lines, need ≥$min)"; fi
  else
    fail "$label (file missing)"
  fi
}

# ─── Phase 0 ─────────────────────────────────────────────────────────────
phase_0() {
  echo "Phase 0 — Feasibility spikes"
  assert_dir "dev-docs/grills/gha-workflow"             "grills directory"
  assert_dir "dev-docs/grills/gha-workflow/fixtures"    "fixtures directory"
  assert_dir "dev-docs/grills/gha-workflow/probes"      "probes directory"

  # All four spike write-ups present.
  for s in a-parser b-export c-prosemirror d-roundtrip; do
    assert_file "dev-docs/grills/gha-workflow/spike-${s}.md" "spike-${s} write-up"
  done

  # Each write-up must declare PASS in its status line.
  for s in a-parser b-export c-prosemirror d-roundtrip; do
    f="dev-docs/grills/gha-workflow/spike-${s}.md"
    if [[ -f "$f" ]]; then
      if grep -E -q "^> Status: \*\*PASS" "$f"; then
        ok "spike-${s} marked PASS"
      else
        fail "spike-${s} not marked PASS in status header"
      fi
    fi
  done

  # Probe scripts present.
  assert_file "dev-docs/grills/gha-workflow/probes/spike-a-parser.mjs"
  assert_file "dev-docs/grills/gha-workflow/probes/spike-d-roundtrip.mjs"
  assert_file "dev-docs/grills/gha-workflow/probes/spike-b-runner.mjs"
  assert_file "dev-docs/grills/gha-workflow/probes/spike-c-runner.mjs"

  # Captured spike outputs (for B, C — the headless runs).
  assert_file "dev-docs/grills/gha-workflow/probes/spike-b-results.json"
  assert_file "dev-docs/grills/gha-workflow/probes/spike-c-results.json"

  # ≥7 fixtures.
  local n
  n=$(find dev-docs/grills/gha-workflow/fixtures -name "*.yml" -o -name "*.yaml" 2>/dev/null | wc -l | tr -d ' ')
  if (( n >= 7 )); then ok "fixture corpus ($n files)"; else fail "fixture corpus only $n files (need ≥7)"; fi

  # Plan reflects Phase 0 outcomes.
  assert_grep "Phase 0 spikes complete" "dev-docs/plans/20260504-github-actions-workflow-viewer.md" "plan header reflects Phase 0 status"
  assert_grep "Spike A result" "dev-docs/plans/20260504-github-actions-workflow-viewer.md" "ADR-3 records Spike A outcome"
  assert_grep "Spike B result" "dev-docs/plans/20260504-github-actions-workflow-viewer.md" "ADR-8 records Spike B outcome"
  assert_grep "Spike C result" "dev-docs/plans/20260504-github-actions-workflow-viewer.md" "ADR-4 records Spike C outcome"
  assert_grep "Spike D result" "dev-docs/plans/20260504-github-actions-workflow-viewer.md" "ADR-11 records Spike D outcome"
}

# ─── Phase 1 ─────────────────────────────────────────────────────────────
phase_1() {
  echo "Phase 1 — Foundation: parser + IR"

  # WI-1.1 — IR types
  assert_file "src/lib/ghaWorkflow/types.ts"            "WI-1.1 IR types"

  # WI-1.2 — parser orchestrator (split per ADR-3 / module map)
  assert_file "src/lib/ghaWorkflow/parser/index.ts"     "WI-1.2 parser orchestrator"

  # WI-1.3 — subparsers
  assert_file "src/lib/ghaWorkflow/parser/triggers.ts"  "WI-1.3 triggers subparser"
  assert_file "src/lib/ghaWorkflow/parser/jobs.ts"      "WI-1.3 jobs subparser"
  assert_file "src/lib/ghaWorkflow/parser/edges.ts"     "WI-1.3 edges subparser"
  assert_file "src/lib/ghaWorkflow/parser/matrix.ts"    "WI-1.3 matrix subparser"
  assert_file "src/lib/ghaWorkflow/parser/permissions.ts" "WI-1.3 permissions subparser"

  # WI-1.4 — detection heuristic
  assert_file "src/lib/ghaWorkflow/detection.ts"        "WI-1.4 detection heuristic"

  # WI-1.5 — workflow router. Originally a separate module under
  # src/lib/workflowRouting/, but production never imported it: the
  # routing decision is made directly by sourceEditorExtensions
  # (.yml extension) + sourceGhaWorkflowPreview (workflow shape).
  # Removed as dead code in the Codex audit round 5; the gate now
  # checks the actual decision points instead.
  assert_grep "isYamlFileName" \
    "src/utils/sourceEditorExtensions.ts" "WI-1.5 routing — yaml extension gate"
  assert_grep "isWorkflowYaml" \
    "src/plugins/codemirror/sourceGhaWorkflowPreview.ts" \
    "WI-1.5 routing — workflow-shape gate"

  # WI-1.6 — fixture corpus (≥20 per plan)
  if [[ -d "dev-docs/fixtures/gha-workflows" ]]; then
    local n
    n=$(find dev-docs/fixtures/gha-workflows -name "*.yml" -o -name "*.yaml" 2>/dev/null | wc -l | tr -d ' ')
    if (( n >= 20 )); then ok "WI-1.6 fixture corpus ($n files)"; else fail "WI-1.6 fixture corpus only $n files (need ≥20)"; fi
  else
    fail "WI-1.6 fixture directory missing: dev-docs/fixtures/gha-workflows/"
  fi

  # Test coverage threshold (≥95% on parser branches per plan AC).
  # Run the relevant slice; coverage report should exist.
  if [[ -f "coverage/coverage-summary.json" ]]; then
    ok "coverage report present"
  else
    echo "  ⓘ coverage report not found — run 'pnpm test:coverage' first"
  fi

  # Diagnostic taxonomy: every code in §4.4 must have an i18n key (post-WI-DoD).
  # Locale keys use a `diagnostics.<CODE>` namespace, so substring match.
  local plan="dev-docs/plans/20260504-github-actions-workflow-viewer.md"
  if [[ -f "$plan" ]] && [[ -f "src/locales/en/workflowEditor.json" ]]; then
    local missing=0
    for code in $(grep -E -o "GHA-[A-Z]+-[0-9]+" "$plan" | sort -u); do
      if ! grep -q "$code" "src/locales/en/workflowEditor.json"; then
        missing=$((missing+1))
      fi
    done
    if (( missing == 0 )); then
      ok "diagnostic taxonomy keys present in workflowEditor.json"
    else
      fail "diagnostic taxonomy: $missing GHA-* codes missing i18n keys"
    fi
  else
    echo "  ⓘ skipping i18n taxonomy check (locale file not yet created)"
  fi

  # Top-level gate — `pnpm check:all` must be green.
  echo "  ⓘ remember: 'pnpm check:all' must pass before phase tick"
}

# ─── Phase 8 ─────────────────────────────────────────────────────────────
phase_8() {
  echo "Phase 8 — CST round-trip"

  # WI-8.1 — CST parser
  assert_file "src/lib/ghaWorkflow/save/cstParser.ts"                  "WI-8.1 CST parser"
  assert_file "src/lib/ghaWorkflow/save/__tests__/cstParser.test.ts"   "WI-8.1 CST parser tests"
  assert_grep "WORKFLOW_YAML_STRINGIFY_OPTIONS" \
    "src/lib/ghaWorkflow/save/cstParser.ts" "WI-8.1 stringify options exported"
  assert_grep "semanticEqual" \
    "src/lib/ghaWorkflow/save/cstParser.ts" "WI-8.1 semanticEqual exported"

  # WI-8.2 — Mutators
  assert_file "src/lib/ghaWorkflow/save/mutators.ts"                   "WI-8.2 mutators"
  assert_file "src/lib/ghaWorkflow/save/__tests__/mutators.test.ts"    "WI-8.2 mutator tests"
  for kind in workflow.set job.set step.set with.set with.remove needs.add needs.remove; do
    if grep -q "\"$kind\"" "src/lib/ghaWorkflow/save/mutators.ts" 2>/dev/null; then
      ok "WI-8.2 patch kind '$kind' wired"
    else
      fail "WI-8.2 patch kind '$kind' not in mutators.ts"
    fi
  done

  # WI-8.3 — workflowEditStore + save pipeline
  assert_file "src/stores/workflowEditStore.ts"                        "WI-8.3 edit store"
  assert_file "src/stores/__tests__/workflowEditStore.test.ts"         "WI-8.3 edit store tests"
  assert_grep "applyAndSerialize" \
    "src/stores/workflowEditStore.ts" "WI-8.3 save pipeline exposed"
  assert_grep "preserveYamlFormatting" \
    "src/stores/workflowEditStore.ts" "WI-8.3 preserve-formatting toggle"

  echo "  ⓘ remember: 'pnpm check:all' must pass before phase tick"
}

# ─── Phase 7 ─────────────────────────────────────────────────────────────
phase_7() {
  echo "Phase 7 — Structured editor (forms)"

  # WI-7.1 — JobForm, StepForm, TriggerForm
  assert_dir "src/components/Editor/WorkflowEditor"                    "WI-7.1 forms directory"
  assert_file "src/components/Editor/WorkflowEditor/JobForm.tsx"       "WI-7.1 JobForm"
  assert_file "src/components/Editor/WorkflowEditor/StepForm.tsx"      "WI-7.1 StepForm"
  assert_file "src/components/Editor/WorkflowEditor/TriggerForm.tsx"   "WI-7.1 TriggerForm"

  # WI-7.2 — Edit pipeline (forms emit IRPatch via workflowEditStore)
  assert_grep "useWorkflowEditStore" \
    "src/components/Editor/WorkflowEditor/JobForm.tsx" "WI-7.2 JobForm uses edit store"

  echo "  ⓘ remember: 'pnpm check:all' must pass before phase tick"
}

# ─── Phase 9 ─────────────────────────────────────────────────────────────
phase_9() {
  echo "Phase 9 — Polish"

  # Locale completion (en authoritative)
  assert_file "src/locales/en/workflowEditor.json"      "Phase 9 en workflowEditor locale"

  # Documentation
  assert_file "website/guide/workflow-viewer.md"        "Phase 9 user-facing docs"
  if grep -q "workflow-viewer\|github-actions-workflow-viewer" "dev-docs/README.md" 2>/dev/null; then
    ok "dev-docs/README.md links the workflow viewer plan or guide"
  else
    fail "dev-docs/README.md is missing a topical entry for the workflow viewer"
  fi

  # Performance benchmark with 100-job fixture
  assert_file "src/bench/workflow.bench.ts"             "100-job perf benchmark"
  assert_grep "100" "src/bench/workflow.bench.ts"       "perf bench targets a 100-job fixture"

  # Accessibility — JobNode has an aria-label summary helper
  assert_grep "buildJobAriaLabel\|aria-label" \
    "src/components/Editor/WorkflowPanel/JobNode.tsx" "JobNode exposes an aria-label"
  # Accessibility — Escape on JobNode clears selection (per plan: Esc returns focus)
  assert_grep "Escape" \
    "src/components/Editor/WorkflowPanel/JobNode.tsx" "JobNode handles Escape"
  # Accessibility — Enter / Space activates the node (already in place; lock it)
  assert_grep "Enter" \
    "src/components/Editor/WorkflowPanel/JobNode.tsx" "JobNode handles Enter"
  # Accessibility — JobNode has a focus-visible style
  assert_grep "focus-visible" \
    "src/components/Editor/WorkflowPanel/job-node.css" "JobNode has focus-visible style"
  # Accessibility — every interactive control in the editor forms has a focus-visible style
  for cls in workflow-editor-panel__btn workflow-form__step-row workflow-form__with-add \
             workflow-form__with-remove workflow-form__missing-required-key \
             workflow-diagnostics-banner__row-button workflow-diagnostics-banner__toggle; do
    if grep -q "${cls}:focus-visible\|${cls}:focus" \
        "src/components/Editor/WorkflowEditor/workflow-editor.css" 2>/dev/null; then
      ok "${cls} has a focus style"
    else
      fail "${cls} missing focus style — see .claude/rules/33-focus-indicators.md"
    fi
  done

  # Dark theme — canvas chrome must style the side-panel canvas (the
  # bug Phase 9 dark-theme QA found was that styles only matched
  # .gha-workflow-canvas, not .gha-workflow-side-panel__canvas).
  assert_grep "gha-workflow-side-panel__canvas" \
    "src/components/Editor/WorkflowPanel/workflow-canvas.css" \
    "canvas chrome covers the side-panel surface (dark-theme parity)"

  # Manual a11y / VoiceOver checklist documented for the human pass
  assert_file "dev-docs/plans/gha-workflow-viewer-a11y-checklist.md" \
    "VoiceOver / keyboard-nav manual checklist"

  echo "  ⓘ remember: 'pnpm check:all' must pass before phase tick"
}

# ─── Phases 2-6: stubs (each phase fills in its own assertions) ──────────
phase_stub() {
  local n="$1"
  echo "Phase $n — stub (assertions will be added when Phase $n begins)"
  fail "Phase $n DoD assertions not yet defined"
}

# ─── Dispatch ────────────────────────────────────────────────────────────
case "$PHASE" in
  0) phase_0 ;;
  1) phase_1 ;;
  7) phase_7 ;;
  8) phase_8 ;;
  9) phase_9 ;;
  2|3|4|5|6) phase_stub "$PHASE" ;;
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
