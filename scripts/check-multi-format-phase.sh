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

  1B)
    echo "Phase 1B — Entry-point and save-path generalization"

    # WI-1B.3 — TS SUPPORTED_EXTENSIONS
    if grep -q "MARKDOWN_ONLY_EXTENSIONS" src/utils/dropPaths.ts \
      && grep -q "getSupportedExtensionsWithDots" src/utils/dropPaths.ts; then
      ok "dropPaths.ts uses MARKDOWN_ONLY_EXTENSIONS + registry-derived getter"
    else
      fail "dropPaths.ts not migrated"
    fi

    # WI-1B.4 — Rust SUPPORTED_EXTENSIONS
    if grep -q "pub(crate) const SUPPORTED_EXTENSIONS:" src-tauri/src/lib.rs; then
      ok "Rust SUPPORTED_EXTENSIONS const present"
    else
      fail "Rust SUPPORTED_EXTENSIONS missing"
    fi
    if grep -q "fn has_supported_extension" src-tauri/src/lib.rs; then
      ok "has_supported_extension function present"
    else
      fail "has_supported_extension function missing"
    fi

    # WI-1B.5 — security gate uses is_openable_supported
    if grep -q "is_openable_supported" src-tauri/src/window_manager.rs; then
      ok "validate_openable_path uses is_openable_supported"
    else
      fail "validate_openable_path still markdown-only"
    fi

    # WI-1B.16 — quarantine uses has_supported_extension
    if grep -q "has_supported_extension" src-tauri/src/quarantine.rs; then
      ok "strip_workspace_quarantine uses has_supported_extension"
    else
      fail "quarantine.rs still markdown-only"
    fi

    # ADR-12 — sync script
    [[ -f scripts/check-ext-sync.sh ]] && ok "check-ext-sync.sh present" || fail "check-ext-sync.sh missing"
    if bash scripts/check-ext-sync.sh >/dev/null 2>&1; then
      ok "Rust ↔ TS extension lists in sync"
    else
      fail "Rust ↔ TS extension drift (run scripts/check-ext-sync.sh)"
    fi

    # WI-1B.1 — open dialog filter
    if grep -q "All Supported" src/hooks/useFileOpen.ts; then
      ok "Open dialog has All Supported preset"
    else
      fail "Open dialog filter not generalized"
    fi

    # WI-1B.2 — drag-drop generalization
    if grep -q "filterSupportedPaths" src/hooks/useDragDropOpen.ts; then
      ok "Drag-drop uses filterSupportedPaths"
    else
      fail "Drag-drop still markdown-only"
    fi

    # WI-1B.6 + 1B.7 — maybeForceSourceForYaml removed from finder + recent
    if ! grep -q "maybeForceSourceForYaml" src/hooks/useFinderFileOpen.ts \
      && ! grep -q "maybeForceSourceForYaml" src/hooks/useRecentFilesMenuEvents.ts; then
      ok "maybeForceSourceForYaml removed from useFinderFileOpen + useRecentFilesMenuEvents"
    else
      fail "maybeForceSourceForYaml still called from finder/recent"
    fi

    # WI-1B.8 — closeSave saveDialogFilters per-tab
    if grep -q "saveFiltersForFilePath\|saveDialogFilters" src/hooks/closeSave.ts \
      && ! grep -q "MARKDOWN_FILTERS" src/hooks/closeSave.ts; then
      ok "closeSave.ts derives filters per format"
    else
      fail "closeSave.ts still uses MARKDOWN_FILTERS"
    fi

    # WI-1B.9 — useFileSave uses untitledExtension
    if grep -q "untitledExtension" src/hooks/useFileSave.ts; then
      ok "useFileSave uses adapters.untitledExtension"
    else
      fail "useFileSave still hardcodes .md"
    fi

    # WI-1B.10 — newFile.createUntitledTab(formatId?)
    if grep -q "_formatId\|formatId.*=.*\"markdown\"" src/utils/newFile.ts; then
      ok "createUntitledTab accepts formatId"
    else
      fail "createUntitledTab not migrated"
    fi

    # WI-1B.11 — fileAssociations expanded
    EXT_COUNT=$(grep -c '"ext":' src-tauri/tauri.conf.json || true)
    if [[ "$EXT_COUNT" -gt 1 ]]; then
      ok "tauri.conf.json fileAssociations expanded ($EXT_COUNT entries)"
    else
      fail "tauri.conf.json fileAssociations still markdown-only"
    fi

    # WI-1B.13 — content search consults registry
    if grep -q "listFormats" src/stores/contentSearchStore.ts \
      && ! grep -qE "^import.*MARKDOWN_EXTENSIONS" src/stores/contentSearchStore.ts; then
      ok "contentSearchStore uses listFormats() filtered by contentSearchIndexed"
    else
      fail "contentSearchStore still imports MARKDOWN_EXTENSIONS"
    fi
    ;;

  2|3|4|5|6)
    note "Phase $PHASE DoD script not yet implemented"
    note "(this is expected during Phase 1B — phases write their own checks)"
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
