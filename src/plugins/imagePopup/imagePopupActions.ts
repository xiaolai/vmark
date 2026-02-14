/**
 * Image Popup Actions
 *
 * Purpose: File-system operations for the image popup — browse for replacement image,
 * copy to assets folder, and update the image node's src attribute.
 *
 * @coordinates-with ImagePopupView.ts — triggers these actions from popup button clicks
 * @coordinates-with hooks/useImageOperations.ts — shared image asset copying logic
 * @module plugins/imagePopup/imagePopupActions
 */

import type { EditorView } from "@tiptap/pm/view";
import { open, message } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useImagePopupStore } from "@/stores/imagePopupStore";
import { copyImageToAssets } from "@/hooks/useImageOperations";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getWindowLabel } from "@/hooks/useWindowFocus";

export async function browseAndReplaceImage(view: EditorView, imageNodePos: number): Promise<boolean> {
  const windowLabel = getWindowLabel();

  const ran = await withReentryGuard(windowLabel, "image-popup:browse", async () => {
    try {
      const sourcePath = await open({
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
          },
        ],
      });

      if (!sourcePath) {
        return false;
      }

      const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
      const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : undefined;
      const filePath = doc?.filePath;

      if (!filePath) {
        await message("Please save the document first to use local images.", {
          title: "Unsaved Document",
          kind: "warning",
        });
        return false;
      }

      const relativePath = await copyImageToAssets(sourcePath as string, filePath);

      const node = view.state.doc.nodeAt(imageNodePos);
      if (!node || (node.type.name !== "image" && node.type.name !== "block_image")) {
        return false;
      }

      const tr = view.state.tr.setNodeMarkup(imageNodePos, null, {
        ...node.attrs,
        src: relativePath,
      });

      view.dispatch(tr);
      useImagePopupStore.getState().setSrc(relativePath);
      return true;
    } catch (error) {
      console.error("[ImagePopup] Browse failed:", error);
      await message("Failed to change image.", { kind: "error" });
      return false;
    }
  });

  return ran ?? false;
}

