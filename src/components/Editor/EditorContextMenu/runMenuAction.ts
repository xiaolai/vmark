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
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { dispatchEditorAction } from "@/plugins/toolbarActions/dispatch";
import { useEditorStore } from "@/stores/editorStore";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";
import { focusEditorSurface, runClipboardCommand } from "./clipboardBridge";
import type { EditorMenuRun } from "./menuModel";
import { linkRangeIsIntact } from "@/plugins/linkPopup/linkRange";

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
      // link popup, which would rewrite whatever now occupies it. The shared
      // guard checks bounds too, and the same one the popup's save uses.
      if (!linkRangeIsIntact(view.state, link.from, link.to, link.href)) return;
      const coords = view.coordsAtPos(link.from);
      useLinkPopupStore.getState().openPopup({
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
