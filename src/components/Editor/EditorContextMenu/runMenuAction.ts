/**
 * Editor context-menu action routing.
 *
 * Purpose: maps an activated menu item's `run` entry to its executor —
 * toolbar-adapter dispatch (shared `dispatchEditorAction`, ADR-2), the
 * native clipboard bridge (ADR-3), or the link commands (copy target,
 * unlink, open the existing link popup). One switch, so the renderer
 * stays a dumb view.
 *
 * @coordinates-with menuModel.ts — produces the run entries
 * @coordinates-with clipboardBridge.ts — clipboard + focus contract
 * @module components/Editor/EditorContextMenu/runMenuAction
 */

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { EditorView as TiptapEditorView } from "@tiptap/pm/view";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { dispatchEditorAction } from "@/plugins/toolbarActions/dispatch";
import { useEditorStore } from "@/stores/editorStore";
import { usePopupStore } from "@/stores/popupStore";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";
import { focusEditorSurface, runClipboardCommand } from "./clipboardBridge";
import type { EditorMenuRun } from "./menuModel";

/**
 * True when [from, to) is still ONE continuous link with `href` in the
 * live doc. `rangeHasMark` is not enough — it matches when the mark
 * occurs anywhere in the range, which would let a partially stale range
 * through to the link popup (which rewrites the whole range on save).
 */
function rangeIsSameLink(
  view: TiptapEditorView,
  from: number,
  to: number,
  href: string
): boolean {
  const linkType = view.state.schema.marks.link;
  if (!linkType) return false;
  let covered = 0;
  let matches = true;
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const mark = linkType.isInSet(node.marks);
    if (!mark || (mark.attrs.href ?? "") !== href) {
      matches = false;
      return false;
    }
    covered += Math.min(to, pos + node.nodeSize) - Math.max(from, pos);
    return true;
  });
  return matches && covered === to - from;
}

async function runLinkCommand(
  command: "editLink" | "copyLink" | "removeLink",
  snapshot: EditorContextMenuSnapshot
): Promise<void> {
  const link = snapshot.link;
  switch (command) {
    case "copyLink": {
      if (!link?.href) return;
      await writeText(link.href);
      focusEditorSurface(snapshot.surface);
      return;
    }
    case "removeLink": {
      // Same IME-safe path as regular adapter actions (WI-3.2).
      dispatchAdapterAction("unlink", snapshot);
      return;
    }
    case "editLink": {
      // WYSIWYG-only (the model omits it in source mode); needs the link
      // range to anchor the existing link popup.
      const view = useEditorStore.getState().tiptap.editorView;
      if (!view || !link || link.href === null || link.from == null || link.to == null) return;
      // The range was captured at right-click; the doc can change while
      // the menu is open (MCP edits, external reload). Re-validate
      // against the live state so a stale range is never handed to the
      // link popup, which would rewrite whatever now occupies it.
      const docSize = view.state.doc.content.size;
      if (link.from < 0 || link.to > docSize || link.from >= link.to) return;
      if (!rangeIsSameLink(view, link.from, link.to, link.href)) return;
      const coords = view.coordsAtPos(link.from);
      usePopupStore.getState().linkOpenPopup({
        href: link.href,
        linkFrom: link.from,
        linkTo: link.to,
        anchorRect: {
          top: coords.top,
          bottom: coords.bottom,
          left: coords.left,
          right: coords.left + 10,
        },
      });
    }
  }
}

/** Dispatch an adapter action on the snapshot surface, IME-safe for the
 *  source editor (WI-3.2): mid-composition activations queue until the
 *  composition ends instead of mutating the doc under the IME. */
function dispatchAdapterAction(action: string, snapshot: EditorContextMenuSnapshot): void {
  if (snapshot.surface === "source") {
    const view = useEditorStore.getState().source.editorView;
    if (view) {
      runOrQueueCodeMirrorAction(view, () => {
        dispatchEditorAction(action, "source");
        focusEditorSurface("source");
      });
      return;
    }
  }
  dispatchEditorAction(action, snapshot.surface);
  focusEditorSurface(snapshot.surface);
}

/** Execute an activated menu item against the snapshot's surface. */
export async function runEditorMenuItem(
  run: EditorMenuRun,
  snapshot: EditorContextMenuSnapshot
): Promise<void> {
  switch (run.type) {
    case "adapter":
      dispatchAdapterAction(run.action, snapshot);
      return;
    case "clipboard":
      await runClipboardCommand(run.command, snapshot.surface);
      return;
    case "link":
      await runLinkCommand(run.command, snapshot);
  }
}
