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

    # WI-1B.1 — open dialog filter is registry-driven (calls
    # getSupportedExtensions). Structural check survives i18n filter
    # name changes — earlier literal match for "All Supported"
    # blocked translation work.
    if grep -q "getSupportedExtensions" src/hooks/useFileOpen.ts; then
      ok "Open dialog filter is registry-driven"
    else
      fail "Open dialog filter must use getSupportedExtensions()"
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

  2)
    echo "Phase 2 — Data formats + first schema detectors (rebrand gate)"

    [[ -f src/lib/formats/adapters/json.tsx ]] && ok "json adapter present" || fail "json adapter missing"
    [[ -f src/lib/formats/adapters/yaml.tsx ]] && ok "yaml adapter present" || fail "yaml adapter missing"
    [[ -f src/lib/formats/adapters/toml.tsx ]] && ok "toml adapter present" || fail "toml adapter missing"
    [[ -f src/lib/formats/adapters/cargoToml.tsx ]] && ok "cargoToml schema renderer present" || fail "cargoToml renderer missing"

    if grep -q "schemaDetector" src/lib/formats/adapters/yaml.tsx; then
      ok "yaml adapter declares schemaDetector"
    else
      fail "yaml adapter missing schemaDetector"
    fi
    if grep -q "schemaDetector" src/lib/formats/adapters/toml.tsx; then
      ok "toml adapter declares schemaDetector (Cargo.toml)"
    else
      fail "toml adapter missing schemaDetector"
    fi

    if [[ ! -f src/utils/yamlOpenRouting.ts ]]; then
      ok "yamlOpenRouting.ts deleted"
    else
      fail "yamlOpenRouting.ts still present"
    fi

    if grep -rq "yamlOpenRouting\|maybeForceSourceForYaml" src/ --include="*.ts" --include="*.tsx" 2>/dev/null; then
      fail "lingering yamlOpenRouting / maybeForceSourceForYaml references"
    else
      ok "no production code references yamlOpenRouting"
    fi

    if [[ ! -f src/plugins/codemirror/sourceGhaWorkflowPreview.ts ]]; then
      ok "sourceGhaWorkflowPreview plugin deleted"
    else
      fail "sourceGhaWorkflowPreview plugin still present"
    fi

    if grep -q "registerJsonFormat\|registerYamlFormat\|registerTomlFormat" src/lib/formats/index.ts; then
      ok "bootstrap registers Phase 2 adapters"
    else
      fail "bootstrap doesn't include Phase 2 adapters"
    fi
    ;;

  3)
    echo "Phase 3 — Visual-render formats"

    [[ -f src/lib/formats/adapters/mermaid.tsx ]] && ok "mermaid adapter present" || fail "mermaid adapter missing"
    [[ -f src/lib/formats/adapters/svg.tsx ]] && ok "svg adapter present" || fail "svg adapter missing"
    [[ -f src/lib/formats/adapters/html.tsx ]] && ok "html adapter present" || fail "html adapter missing"
    [[ -f dev-docs/grills/multi-format/security-review-html.md ]] && ok "HTML security review document present" || fail "security-review-html.md missing"

    if grep -q 'sandbox=""' src/lib/formats/adapters/html.tsx; then
      ok "HTML preview uses iframe sandbox=\"\" (ADR-4)"
    else
      fail "HTML preview missing empty sandbox attribute"
    fi
    if grep -q "DOMPurify.sanitize" src/lib/formats/adapters/html.tsx; then
      ok "HTML preview applies DOMPurify defense-in-depth"
    else
      fail "HTML preview missing DOMPurify"
    fi

    if grep -q "registerMermaidFormat\|registerSvgFormat\|registerHtmlFormat" src/lib/formats/index.ts; then
      ok "bootstrap registers Phase 3 adapters"
    else
      fail "bootstrap doesn't include Phase 3 adapters"
    fi

    # WI-3.4 sign-off detection — interactive run pending (informational)
    if grep -q "OWASP top-20" dev-docs/grills/multi-format/security-review-html.md; then
      ok "WI-3.4 procedure documented"
    else
      fail "WI-3.4 procedure missing from security review doc"
    fi
    note "WI-3.4 OWASP run is INTERACTIVE — sign-off block in security-review-html.md must be ticked manually"
    ;;

  4)
    echo "Phase 4 — Code viewing"

    [[ -f src/lib/formats/adapters/code.ts ]] && ok "code adapter present" || fail "code adapter missing"
    [[ -f src/components/Editor/SplitPaneEditor/ReadOnlyBanner.tsx ]] && ok "ReadOnlyBanner present" || fail "ReadOnlyBanner missing"
    [[ -f src-tauri/src/external_editor.rs ]] && ok "external_editor Rust module present" || fail "external_editor.rs missing"

    if grep -q "registerCodeFormats" src/lib/formats/index.ts; then
      ok "bootstrap registers Phase 4 code adapters"
    else
      fail "bootstrap doesn't include Phase 4"
    fi

    if [[ ! -f src/lib/formats/adapters/stubs.ts ]]; then
      ok "stubs.ts deleted (all formats graduated)"
    else
      fail "stubs.ts still present"
    fi

    if grep -q "kind: \"viewer\"" src/lib/formats/adapters/code.ts; then
      ok "code adapters declare kind=\"viewer\" (read-only-default per ADR-3)"
    else
      fail "code adapters missing kind=\"viewer\""
    fi

    if grep -q "open_in_external_editor" src-tauri/src/lib.rs; then
      ok "open_in_external_editor wired into invoke_handler"
    else
      fail "open_in_external_editor not registered"
    fi

    if grep -q "editingEnabled" src/components/Editor/SplitPaneEditor/SplitPaneEditor.tsx; then
      ok "SplitPaneEditor tracks editingEnabled (WI-4.3)"
    else
      fail "SplitPaneEditor missing editingEnabled state"
    fi
    ;;

  5)
    echo "Phase 5 — Additional schema-aware previews"

    [[ -f src/lib/formats/adapters/packageJson.tsx ]] && ok "packageJson schema renderer present" || fail "packageJson renderer missing"
    [[ -f src/lib/formats/adapters/pyprojectToml.tsx ]] && ok "pyprojectToml schema renderer present" || fail "pyprojectToml renderer missing"

    if grep -q "package-json" src/lib/formats/adapters/json.tsx; then
      ok "json adapter wires package-json schemaRenderer"
    else
      fail "json adapter missing package-json wiring"
    fi
    if grep -q "pyproject-toml" src/lib/formats/adapters/toml.tsx; then
      ok "toml adapter wires pyproject-toml schemaRenderer"
    else
      fail "toml adapter missing pyproject-toml wiring"
    fi

    if grep -q "cargoTomlSchemaDetector\|pyprojectTomlSchemaDetector" src/lib/formats/adapters/toml.tsx; then
      ok "toml adapter composes both Cargo + pyproject detectors"
    else
      fail "toml adapter detector composition broken"
    fi

    note "WI-5.3 (OpenAPI / Swagger browser) DEFERRED to Phase 5b per the plan"
    ;;

  6)
    echo "Phase 6 — Rebrand"

    if grep -q "plain-text workspace where humans and AI collaborate" README.md; then
      ok "README.md adopts new tagline"
    else
      fail "README.md still uses old tagline"
    fi
    if grep -q "plain-text workspace where humans and AI collaborate" website/.vitepress/config/shared.ts; then
      ok "website meta description updated"
    else
      fail "website meta description not updated"
    fi
    if grep -q "Plain-Text Workspace" website/index.md; then
      ok "website hero updated"
    else
      fail "website hero not updated"
    fi
    if grep -q "plain-text workspace where humans and AI collaborate" src-tauri/Cargo.toml; then
      ok "src-tauri Cargo.toml description updated (drives macOS About dialog)"
    else
      fail "Cargo.toml description still uses old tagline"
    fi
    if grep -q "plain-text workspace where humans and AI collaborate" package.json; then
      ok "package.json description updated"
    else
      fail "package.json description not updated"
    fi
    if grep -q "plain-text workspace where humans and AI collaborate" vmark-mcp-server/package.json; then
      ok "vmark-mcp-server package.json description updated"
    else
      fail "vmark-mcp-server description not updated"
    fi
    if grep -q "shortDescription" src-tauri/tauri.conf.json; then
      ok "tauri.conf.json bundle description set"
    else
      fail "tauri.conf.json bundle description missing"
    fi

    [[ -f website/guide/formats.md ]] && ok "formats.md present" || fail "formats.md missing"
    [[ -f website/blog/2026-05-multi-format-launch.md ]] && ok "launch blog draft present" || fail "launch blog draft missing"

    if grep -q "plain-text workspace" website/guide/index.md; then
      ok "guide intro restructured"
    else
      fail "guide intro not restructured"
    fi
    if grep -q "Supported Formats" website/.vitepress/config/en.ts; then
      ok "sidebar links to formats.md"
    else
      fail "sidebar missing formats link"
    fi

    note "WI-6.4 screenshot reel is INTERACTIVE — capture 5+ formats open simultaneously in the actual app"
    note "WI-6.5 translation pass — locale strings translated as they were added per-WI (English placeholders for non-en); /translate-docs skill can polish them"
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
