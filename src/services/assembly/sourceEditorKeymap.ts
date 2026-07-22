/**
 * Source-editor keymap — extracted from sourceEditorExtensions.ts.
 *
 * Purpose: hold the ~90-line CodeMirror keymap that dominated the composition
 * root, so that file can carry explicit extension ids without exceeding its
 * frozen size baseline.
 *
 * Order is load-bearing: CodeMirror resolves keybindings in array order, and
 * several entries exist specifically to shadow `defaultKeymap` (visual-line
 * navigation, list continuation, tab indent). Do not sort this list.
 *
 * @coordinates-with sourceEditorExtensions.ts — the sole consumer
 * @module services/assembly/sourceEditorKeymap
 */
import { keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { performUnifiedUndo, performUnifiedRedo } from "@/services/history/unifiedHistory";
import { closeBracketsKeymap } from "@codemirror/autocomplete";
import { selectNextOccurrenceSource, selectAllOccurrencesSource } from "@/plugins/codemirror/sourceSelectOccurrence";
import { useUIStore } from "@/stores/uiStore";
import { markdownPairBackspace, tabEscapeKeymap, tabIndentFallbackKeymap, shiftTabIndentFallbackKeymap, listContinuationKeymap, tableTabKeymap, tableShiftTabKeymap, tableModEnterKeymap, tableModShiftEnterKeymap, tableArrowUpKeymap, tableArrowDownKeymap, visualLineUpKeymap, visualLineDownKeymap, visualLineUpSelectKeymap, visualLineDownSelectKeymap, smartHomeKeymap, smartHomeSelectKeymap, structuralBackspaceKeymap, structuralDeleteKeymap, listSmartIndentKeymap, listSmartOutdentKeymap } from "@/plugins/codemirror";
import { toggleTaskList } from "@/plugins/sourceContextDetection/taskListActions";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { isMacPlatform } from "@/utils/shortcutMatch";

/** The source editor's keybindings, in precedence order. */
export function buildSourceKeymapEntries(): Parameters<typeof keymap.of>[0] {
  return [
      // Visual line navigation (must be before default keymap to override)
      visualLineUpKeymap,
      visualLineDownKeymap,
      visualLineUpSelectKeymap,
      visualLineDownSelectKeymap,
      // Smart Home key (toggles between first non-whitespace and line start)
      smartHomeKeymap,
      smartHomeSelectKeymap,
      // Structural character protection (table pipes, list markers, blockquote markers)
      structuralBackspaceKeymap,
      structuralDeleteKeymap,
      // Smart list continuation (must be before default keymap)
      listContinuationKeymap,
      // Table Tab navigation (must be before tabEscape)
      tableTabKeymap,
      tableShiftTabKeymap,
      // List smart indent/outdent (must be before tabEscape to take priority on list lines)
      listSmartIndentKeymap,
      listSmartOutdentKeymap,
      // Table arrow escape (first/last block handling)
      tableArrowUpKeymap,
      tableArrowDownKeymap,
      // Table Mod-Enter shortcuts (must be before task list toggle)
      tableModEnterKeymap,
      tableModShiftEnterKeymap,
      // Tab to jump over closing brackets (must be before default keymap)
      tabEscapeKeymap,
      // Backspace to delete both halves of markdown pairs
      markdownPairBackspace,
      // Mod+Shift+Enter: toggle task list checkbox
      guardCodeMirrorKeyBinding({
        key: "Mod-Shift-Enter",
        run: (view) => toggleTaskList(view),
        preventDefault: true,
      }),
      // Cmd+D: select next occurrence (custom — CJK-aware, code fence boundary-aware)
      guardCodeMirrorKeyBinding({
        key: "Mod-d",
        run: (view) => {
          const spec = selectNextOccurrenceSource(view.state);
          if (!spec) return false;
          view.dispatch(spec);
          return true;
        },
        preventDefault: true,
      }),
      // Cmd+Shift+L: select all occurrences (custom — code fence boundary-aware)
      guardCodeMirrorKeyBinding({
        key: "Mod-Shift-l",
        run: (view) => {
          const spec = selectAllOccurrencesSource(view.state);
          if (!spec) return false;
          view.dispatch(spec);
          return true;
        },
        preventDefault: true,
      }),
      // Cmd+Option+W: toggle word wrap
      guardCodeMirrorKeyBinding({
        key: "Mod-Alt-w",
        run: () => {
          useUIStore.getState().toggleWordWrap();
          return true;
        },
        preventDefault: true,
      }),
      ...closeBracketsKeymap,
      ...defaultKeymap,
      // Unified undo/redo that works across mode switches
      guardCodeMirrorKeyBinding({
        key: "Mod-z",
        run: () => performUnifiedUndo(getCurrentWindowLabel()),
        preventDefault: true,
      }),
      guardCodeMirrorKeyBinding({
        key: "Mod-Shift-z",
        run: () => performUnifiedRedo(getCurrentWindowLabel()),
        preventDefault: true,
      }),
      // Windows/Linux convention: Ctrl+Y for redo (skip on macOS where Cmd+Y = AI Genies)
      /* v8 ignore next 7 -- @preserve reason: isMacPlatform() compile-time constant; only one branch is taken per test run */
      ...(isMacPlatform() ? [] : [
        guardCodeMirrorKeyBinding({
          key: "Mod-y",
          run: () => performUnifiedRedo(getCurrentWindowLabel()),
          preventDefault: true,
        }),
      ]),
      // Fallback Tab handlers: insert spaces if Tab/Shift-Tab not handled above
      tabIndentFallbackKeymap,
      shiftTabIndentFallbackKeymap,
  ];
}
