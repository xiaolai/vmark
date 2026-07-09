#!/usr/bin/env bash
# Machine-checkable Definition of Done per phase of the editor context-menu
# plan (dev-docs/plans/20260709-editor-context-menu.md). Modeled on
# check-gha-phase.sh. Usage: bash scripts/check-context-menu-phase.sh <N>
set -euo pipefail
cd "$(dirname "$0")/.."

phase="${1:?usage: check-context-menu-phase.sh <phase-number>}"
fail() { echo "❌ $1" >&2; exit 1; }
ok() { echo "✅ $1"; }

require_file() { [[ -f "$1" ]] || fail "missing file: $1"; ok "exists: $1"; }
require_grep() { grep -q "$2" "$1" || fail "$1 lacks: $2"; ok "$1 contains: $2"; }

case "$phase" in
  0)
    require_file dev-docs/grills/editor-context-menu/phase0-clipboard-spike.md
    require_grep dev-docs/grills/editor-context-menu/phase0-clipboard-spike.md "PASS"
    require_file src-tauri/src/webview_edit.rs
    require_file src-tauri/src/webview_edit.test.rs
    ;;
  1)
    require_file src/types/editorContextMenu.ts
    require_file src/components/Editor/EditorContextMenu/menuModel.ts
    require_file src/components/Editor/EditorContextMenu/menuModel.test.ts
    require_file src/components/Editor/EditorContextMenu/EditorContextMenu.tsx
    require_file src/components/Editor/EditorContextMenu/EditorContextMenu.test.tsx
    require_file src/components/Editor/EditorContextMenu/clipboardBridge.ts
    require_file src/components/Editor/EditorContextMenu/runMenuAction.ts
    require_file src/plugins/toolbarActions/dispatch.ts
    require_file src/plugins/toolbarActions/dispatch.test.ts
    require_grep src/stores/popupStore/slices.ts "EditorContextMenuSlice"
    require_grep src/components/Editor/UniversalToolbar/UniversalToolbar.tsx "dispatchEditorAction"
    pnpm vitest run src/components/Editor/EditorContextMenu/ src/plugins/toolbarActions/dispatch.test.ts src/stores/__tests__/editorContextMenuSlice.test.ts >/dev/null 2>&1 \
      || fail "phase 1 test suites red"
    ok "phase 1 test suites green"
    ;;
  2)
    require_file src/plugins/editorContextMenu/tiptap.ts
    require_grep src-tauri/src/lib.rs "webview_edit::trigger_webview_edit"
    pnpm vitest run src/plugins/editorContextMenu/ >/dev/null 2>&1 || fail "phase 2 test suites red"
    ok "phase 2 test suites green"
    ;;
  3)
    require_file src/plugins/codemirror/editorContextMenu.ts
    pnpm vitest run src/plugins/codemirror/editorContextMenu.test.ts >/dev/null 2>&1 \
      || fail "phase 3 test suites red"
    ok "phase 3 test suites green"
    ;;
  4)
    require_grep src/locales/en/editor.json "contextMenu.cut"
    for lang in zh-CN zh-TW ja ko fr de es it pt-BR; do
      grep -q "contextMenu.cut" "src/locales/$lang/editor.json" \
        || fail "missing contextMenu keys in locale $lang"
    done
    ok "all locales carry contextMenu keys"
    require_grep website/guide/features.md "[Cc]ontext [Mm]enu"
    ;;
  *) fail "unknown phase: $phase" ;;
esac

echo "Phase $phase DoD: all checks passed."
