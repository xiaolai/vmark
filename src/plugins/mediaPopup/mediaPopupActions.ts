/**
 * Media Popup Actions
 *
 * Purpose: File-system operations for the unified media popup — browse for replacement
 * media file (image, video, or audio), copy to assets folder, and update the node's src.
 *
 * Key decisions:
 *   - Image types use copyImageToAssets (images/ subfolder)
 *   - Video/audio types use copyMediaToAssets (media/ subfolder)
 *   - File dialog filters are media-type-aware
 *
 * @coordinates-with MediaPopupView.ts — triggers these actions from popup button clicks
 * @coordinates-with hooks/useImageOperations.ts — image asset copying logic
 * @coordinates-with hooks/useMediaOperations.ts — video/audio asset copying logic
 * @module plugins/mediaPopup/mediaPopupActions
 */

import type { EditorView } from "@tiptap/pm/view";
import { open, message } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { copyImageToAssets } from "@/hooks/useImageOperations";
import { copyMediaToAssets } from "@/hooks/useMediaOperations";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { mediaPopupError } from "@/utils/debug";
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
} from "@/utils/mediaExtensions";

import type { MediaNodeType } from "@/stores/mediaPopupStore";

/** Check if a media type is an image type. */
function isImageType(type: MediaNodeType): boolean {
  return type === "image" || type === "block_image";
}

export async function browseAndReplaceMedia(
  view: EditorView,
  _mediaNodePos: number,
  mediaNodeType: MediaNodeType
): Promise<boolean> {
  const windowLabel = getWindowLabel();

  const ran = await withReentryGuard(windowLabel, "media-popup:browse", async () => {
    try {
      const isImage = isImageType(mediaNodeType);
      const isVideo = mediaNodeType === "block_video";

      const filters = isImage
        ? [{ name: "Images", extensions: [...IMAGE_EXTENSIONS] }]
        : isVideo
          ? [{ name: "Videos", extensions: [...VIDEO_EXTENSIONS] }]
          : [{ name: "Audio", extensions: [...AUDIO_EXTENSIONS] }];

      const sourcePath = await open({ filters, multiple: false, directory: false });

      if (!sourcePath) {
        return false;
      }

      const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
      const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : undefined;
      const filePath = doc?.filePath;

      if (!filePath) {
        await message(i18n.t("dialog:unsavedDocument.messageLocalMedia"), {
          title: i18n.t("dialog:unsavedDocument.title"),
          kind: "warning",
        });
        return false;
      }

      // Image types use copyImageToAssets (images/ subfolder),
      // video/audio use copyMediaToAssets (media/ subfolder)
      const relativePath = isImage
        ? await copyImageToAssets(sourcePath as string, filePath)
        : await copyMediaToAssets(sourcePath as string, filePath);

      // Re-read position from store — it may have been updated if the popup
      // was reopened on a different node during the async file operation
      const currentPos = useMediaPopupStore.getState().mediaNodePos;
      const node = view.state.doc.nodeAt(currentPos);
      if (!node || node.type.name !== mediaNodeType) {
        return false;
      }

      const tr = view.state.tr.setNodeMarkup(currentPos, null, {
        ...node.attrs,
        src: relativePath,
      });

      view.dispatch(tr);
      useMediaPopupStore.getState().setSrc(relativePath);
      return true;
    } catch (error) {
      mediaPopupError("Browse failed:", error);
      await message(i18n.t("dialog:toast.failedToChangeMedia"), { kind: "error" });
      return false;
    }
  });

  /* v8 ignore start -- @preserve dialog.open() always returns boolean; undefined is defensive */
  return ran ?? false;
  /* v8 ignore stop */
}
