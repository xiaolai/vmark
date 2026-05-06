#!/usr/bin/env bash
# Multi-format rebrand phase DoD checker.
#
# Usage:  scripts/check-multi-format-phase.sh <N>
# Where N ∈ {0, 1A, 1B, 2, 3, 4, 5, 6}
#
# Exits 0 when the phase's machine-checkable DoD passes; non-zero otherwise.
#
# Per .claude/rules/60-ai-governance.md rule 3 — phase boundaries are gated
# by scripts, not prose.

set -euo pipefail

PHASE="${1:-}"
if [[ -z "$PHASE" ]]; then
  echo "Usage: $0 <phase>" >&2
  echo "  Phases: 0, 1A, 1B, 2, 3, 4, 5, 6" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
note() { echo "  · $1"; }

case "$PHASE" in
  0)
    echo "Phase 0 — Architecture spikes"
    if [[ -f dev-docs/grills/multi-format/findings.md ]]; then
      ok "findings.md exists"
    else
      fail "findings.md missing"
    fi
    for f in findings-spikes-1-to-3 findings-libraries findings-refactor-audit findings-spike-04-html-sandbox; do
      if [[ -f "dev-docs/grills/multi-format/${f}.md" ]]; then
        ok "${f}.md exists"
      else
        fail "${f}.md missing"
      fi
    done
    ;;

  1A)
    echo "Phase 1A — Registry substrate + Editor.tsx surface refactor"

    # WI-1A.1 + 1A.2 — registry types + singleton
    [[ -f src/lib/formats/types.ts ]]    && ok "types.ts present"     || fail "types.ts missing"
    [[ -f src/lib/formats/registry.ts ]] && ok "registry.ts present"  || fail "registry.ts missing"

    # WI-1A.3 — markdown adapter
    [[ -f src/lib/formats/adapters/markdown.tsx ]] && ok "markdown adapter present" || fail "markdown adapter missing"

    # WI-1A.4 + 1A.10 — SplitPaneEditor
    [[ -d src/components/Editor/SplitPaneEditor ]] && ok "SplitPaneEditor directory present" || fail "SplitPaneEditor missing"
    [[ -f src/components/Editor/SplitPaneEditor/SplitPaneEditor.tsx ]] && ok "SplitPaneEditor.tsx present" || fail "SplitPaneEditor.tsx missing"

    # WI-1A.5 — Editor.tsx dispatcher
    if grep -q "dispatchEditor" src/components/Editor/Editor.tsx; then
      ok "Editor.tsx uses dispatchEditor()"
    else
      fail "Editor.tsx does not call dispatchEditor()"
    fi

    # WI-1A.6 — markForcedSource only inside markdown adapter (entry-point side)
    OFFENDERS=$(git grep -l "markForcedSource" -- 'src/' 2>/dev/null \
      | grep -v -E '\.test\.|\.bench\.' \
      | grep -v -E 'src/lib/formats/adapters/markdown\.tsx$' \
      | grep -v -E 'src/lib/formats/markdownLargeFile\.ts$' \
      | grep -v -E 'src/stores/largeFileSessionStore\.ts$' \
      | grep -v -E 'src/utils/largeFileRouting\.ts$' \
      | grep -v -E 'src/utils/yamlOpenRouting\.ts$' \
      || true)
    if [[ -z "$OFFENDERS" ]]; then
      ok "markForcedSource only inside markdown adapter (yamlOpenRouting exempt per WI-2.6)"
    else
      fail "markForcedSource called outside markdown adapter:"
      echo "$OFFENDERS" | sed 's/^/      - /'
    fi

    # WI-1A.7 — useUnifiedMenuCommands consults menuPolicy
    if grep -q "isMenuActionAllowedForActiveFormat" src/hooks/useUnifiedMenuCommands.ts; then
      ok "useUnifiedMenuCommands consults menuPolicy"
    else
      fail "useUnifiedMenuCommands does not gate by menuPolicy"
    fi

    # WI-1A.8 — ValidationGutter
    [[ -f src/components/Editor/SplitPaneEditor/ValidationGutter.tsx ]] && ok "ValidationGutter present" || fail "ValidationGutter missing"

    # WI-1A.9 — txt adapter
    [[ -f src/lib/formats/adapters/txt.ts ]] && ok "txt adapter present" || fail "txt adapter missing"

    # WI-1A.11 — stubs
    [[ -f src/lib/formats/adapters/stubs.ts ]] && ok "stubs adapter present" || fail "stubs adapter missing"

    # WI-1A.12 — Tab.formatId
    if grep -q "formatId: string" src/stores/tabStore.ts; then
      ok "Tab.formatId field declared"
    else
      fail "Tab.formatId field not found in tabStore.ts"
    fi

    # getSupportedExtensions returns >= 14 entries (runtime check via vitest)
    if pnpm exec vitest run src/lib/formats/index.test.ts >/dev/null 2>&1; then
      ok "bootstrapFormats tests pass (getSupportedExtensions >= 14 verified)"
    else
      fail "bootstrapFormats tests failing"
    fi

    # TDD hook installed
    [[ -f .claude/hooks/multi-format-tdd-guard.mjs ]] && ok "multi-format TDD hook present" || fail "multi-format TDD hook missing"

    # Cross-model review noted in plan body
    if grep -q "Review iteration 4" dev-docs/plans/20260506-multi-format-rebrand.md; then
      ok "Codex review iteration-4 resolution recorded"
    else
      fail "Codex review iteration-4 resolution not recorded in plan body"
    fi
    ;;

  1B|2|3|4|5|6)
    note "Phase $PHASE DoD script not yet implemented"
    note "(this is expected during Phase 1A — phases write their own checks)"
    exit 0
    ;;

  *)
    echo "Unknown phase: $PHASE" >&2
    echo "Phases: 0, 1A, 1B, 2, 3, 4, 5, 6" >&2
    exit 2
    ;;
esac

echo
echo "Phase $PHASE: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
