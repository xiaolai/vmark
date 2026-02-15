/**
 * Media Popup Actions
 *
 * Purpose: File-system operations for the media popup — browse for replacement
 * media file, copy to assets folder, and update the media node's src attribute.
 *
 * @coordinates-with MediaPopupView.ts — triggers these actions from popup button clicks
 * @coordinates-with hooks/useMediaOperations.ts — shared media asset copying logic
 * @module plugins/mediaPopup/mediaPopupActions
 */

import type { EditorView } from "@tiptap/pm/view";
import { open, message } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { copyMediaToAssets } from "@/hooks/useMediaOperations";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getWindowLabel } from "@/hooks/useWindowFocus";

import type { MediaNodeType } from "@/stores/mediaPopupStore";

const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv"];
const AUDIO_EXTENSIONS = ["mp3", "m4a", "ogg", "wav", "flac", "aac", "opus"];

export async function browseAndReplaceMedia(
  view: EditorView,
  mediaNodePos: number,
  mediaNodeType: MediaNodeType
): Promise<boolean> {
  const windowLabel = getWindowLabel();

  const ran = await withReentryGuard(windowLabel, "media-popup:browse", async () => {
    try {
      const isVideo = mediaNodeType === "block_video";
      const filters = isVideo
        ? [{ name: "Videos", extensions: VIDEO_EXTENSIONS }]
        : [{ name: "Audio", extensions: AUDIO_EXTENSIONS }];

      const sourcePath = await open({ filters });

      if (!sourcePath) {
        return false;
      }

      const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
      const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : undefined;
      const filePath = doc?.filePath;

      if (!filePath) {
        await message("Please save the document first to use local media files.", {
          title: "Unsaved Document",
          kind: "warning",
        });
        return false;
      }

      const relativePath = await copyMediaToAssets(sourcePath as string, filePath);

      const node = view.state.doc.nodeAt(mediaNodePos);
      if (!node || (node.type.name !== "block_video" && node.type.name !== "block_audio")) {
        return false;
      }

      const tr = view.state.tr.setNodeMarkup(mediaNodePos, null, {
        ...node.attrs,
        src: relativePath,
      });

      view.dispatch(tr);
      useMediaPopupStore.getState().setSrc(relativePath);
      return true;
    } catch (error) {
      console.error("[MediaPopup] Browse failed:", error);
      await message("Failed to change media file.", { kind: "error" });
      return false;
    }
  });

  return ran ?? false;
}
