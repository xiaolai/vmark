/**
 * Editor context-menu trigger — Source (CodeMirror) surfaces.
 *
 * Two variants:
 *   - `sourceEditorContextMenuExtension` — the markdown Source mode
 *     trigger: full snapshot from the source cursor context. Registered
 *     after the source-table menu; bails when that menu claimed the
 *     event (`defaultPrevented`) and re-checks table ownership after
 *     moving the cursor (belt-and-braces, plan ADR-5).
 *   - `reducedEditorContextMenuExtension` — for SplitPaneEditor source
 *     panes (non-markdown formats), which run their own minimal
 *     CodeMirror instances outside editorStore. Emits a restricted
 *     snapshot (clipboard + Select All only) and registers the pane's
 *     view as the clipboard bridge's focus/paste target.
 *
 * Both are `ViewPlugin`s so `destroy()` clears any view registration on
 * mode switches (listener-leak class, issue #283).
 *
 * @coordinates-with plugins/editorContextMenu/snapshot.ts — full snapshot
 * @coordinates-with components/Editor/EditorContextMenu/clipboardBridge.ts — view override
 * @module plugins/codemirror/editorContextMenu
 */

import { EditorView, ViewPlugin } from "@codemirror/view";
import { getSourceTableInfo } from "@/plugins/sourceContextDetection/tableDetection";
import { usePopupStore } from "@/stores/popupStore";
import { buildSourceSnapshot } from "@/plugins/editorContextMenu/snapshot";
import {
  clearContextMenuSourceView,
  setContextMenuSourceView,
} from "@/components/Editor/EditorContextMenu/clipboardBridge";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";

/** Restricted snapshot for panes without markdown context detection. */
export function buildReducedSourceSnapshot(view: EditorView): EditorContextMenuSnapshot {
  return {
    surface: "source",
    selectionEmpty: view.state.selection.ranges.every((range) => range.empty),
    inCodeBlock: false,
    headingLevel: null,
    listType: null,
    inBlockquote: false,
    link: null,
    formatPolicy: { paragraphFormatting: false, insertBlockActions: false },
    activeActions: [],
    disabledActions: [],
  };
}

/**
 * Shared contextmenu handler. Returns true when the menu claims the
 * event. Exported for direct unit testing.
 */
export function handleSourceContextMenu(
  view: EditorView,
  event: MouseEvent,
  options: { reduced: boolean }
): boolean {
  if (event.defaultPrevented) return false;

  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return false;

  event.preventDefault();

  // Selection rule: clicks inside ANY selected range (multi-cursor
  // included) preserve the selection; outside, the caret moves to the
  // click position first.
  const insideSelection = view.state.selection.ranges.some(
    (range) => !range.empty && pos >= range.from && pos <= range.to
  );
  if (!insideSelection) {
    view.dispatch({ selection: { anchor: pos } });
  }

  // The source-table menu owns table regions. Return false (not true) so
  // this stays order-robust: if the generic handler ever runs before the
  // table handler, the event continues to it — that handler repeats the
  // cursor move and preventDefault itself.
  if (!options.reduced && getSourceTableInfo(view)) return false;

  setContextMenuSourceView(view);
  const snapshot = options.reduced ? buildReducedSourceSnapshot(view) : buildSourceSnapshot();
  /* v8 ignore next -- @preserve reason: source cursor context is registered while the editor is mounted; guard for teardown races */
  if (!snapshot) return true;

  usePopupStore.getState().editorContextOpenMenu({
    position: { x: event.clientX, y: event.clientY },
    snapshot,
  });
  return true;
}

function createContextMenuViewPlugin(reduced: boolean) {
  return ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {}
      destroy() {
        // Never leave a destroyed pane registered as the paste target.
        clearContextMenuSourceView(this.view);
      }
    },
    {
      eventHandlers: {
        contextmenu(event: MouseEvent, view: EditorView): boolean {
          return handleSourceContextMenu(view, event, { reduced });
        },
      },
    }
  );
}

/** Markdown Source-mode trigger (full snapshot). */
export const sourceEditorContextMenuExtension = createContextMenuViewPlugin(false);

/** SplitPaneEditor source-pane trigger (clipboard + Select All only). */
export const reducedEditorContextMenuExtension = createContextMenuViewPlugin(true);
