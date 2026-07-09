/**
 * Editor context-menu trigger — WYSIWYG surface.
 *
 * ProseMirror `handleDOMEvents.contextmenu` handler behind a Tiptap
 * extension. Precedence (plan ADR-5): more specific menus win — the
 * handler bails when the event was already claimed (`defaultPrevented`,
 * set by the image node views), when the click lands inside a table
 * (tableUI's menu owns tables; extension priority also orders its
 * handler first), or when the target is an image element.
 *
 * Selection rule: right-click inside the current selection preserves it;
 * outside, the caret moves to the click position first (macOS
 * convention) so formatting/paste apply where the user clicked.
 *
 * @coordinates-with snapshot.ts — captures the menu state snapshot
 * @coordinates-with plugins/tableUI/tiptap.ts — table-menu precedence
 * @module plugins/editorContextMenu/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { usePopupStore } from "@/stores/popupStore";
import { buildWysiwygSnapshot } from "./snapshot";

/** True when `pos` sits anywhere inside a table node. */
export function isPosInTable(view: EditorView, pos: number): boolean {
  const $pos = view.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "table") return true;
  }
  return false;
}

/**
 * The contextmenu handler. Returns true when this menu claims the event.
 * Exported for direct unit testing (precedence and selection rules).
 */
export function handleEditorContextMenu(view: EditorView, event: MouseEvent): boolean {
  if (event.defaultPrevented) return false;
  const target = event.target as HTMLElement | null;
  if (target?.closest?.("img")) return false;

  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return false;
  if (isPosInTable(view, coords.pos)) return false;

  event.preventDefault();

  const { from, to, empty } = view.state.selection;
  if (empty || coords.pos < from || coords.pos > to) {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(coords.pos)))
    );
  }

  const snapshot = buildWysiwygSnapshot();
  /* v8 ignore next -- @preserve reason: cursor context is always registered once the editor renders; guard for teardown races */
  if (!snapshot) return true;

  usePopupStore.getState().editorContextOpenMenu({
    position: { x: event.clientX, y: event.clientY },
    snapshot,
  });
  return true;
}

export const editorContextMenuExtension = Extension.create({
  name: "editorContextMenu",
  // Below tableUI (1050): its contextmenu handler must run first so the
  // table menu keeps owning right-clicks inside tables.
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("editorContextMenu"),
        props: {
          handleDOMEvents: {
            contextmenu: (view, event) => handleEditorContextMenu(view, event),
          },
        },
      }),
    ];
  },
});
