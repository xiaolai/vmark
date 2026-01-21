/**
 * Source Image Popup Actions
 *
 * Actions for image editing in Source mode (CodeMirror 6).
 * Handles browse, copy, remove, and save operations.
 */

import type { EditorView } from "@codemirror/view";
import { open, message } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useImagePopupStore } from "@/stores/imagePopupStore";
import { copyImageToAssets } from "@/hooks/useImageOperations";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";

/**
 * Build image markdown syntax.
 */
function buildImageMarkdown(alt: string, src: string): string {
  return `![${alt}](${src})`;
}

/**
 * Find image markdown range at a given position.
 */
function findImageAtPos(
  view: EditorView,
  pos: number
): { from: number; to: number } | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  const imageRegex = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s"]+))(?:\s+"[^"]*")?\)/g;

  let match;
  while ((match = imageRegex.exec(lineText)) !== null) {
    const matchStart = lineStart + match.index;
    const matchEnd = matchStart + match[0].length;
    if (pos >= matchStart && pos <= matchEnd) {
      return { from: matchStart, to: matchEnd };
    }
  }

  return null;
}

function getImageRange(view: EditorView): { from: number; to: number } | null {
  const { imageNodePos } = useImagePopupStore.getState();
  if (imageNodePos < 0) return null;
  return findImageAtPos(view, imageNodePos);
}

/**
 * Save image changes to the document.
 * Replaces the current image markdown with updated values.
 */
export function saveImageChanges(view: EditorView): void {
  const state = useImagePopupStore.getState();
  const { imageSrc, imageAlt } = state;
  const range = getImageRange(view);
  if (!range) {
    return;
  }

  const newMarkdown = buildImageMarkdown(imageAlt, imageSrc);

  runOrQueueCodeMirrorAction(view, () => {
    view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
        insert: newMarkdown,
      },
    });
  });
}

/**
 * Browse and replace image with a local file.
 */
export async function browseImage(view: EditorView): Promise<boolean> {
  const windowLabel = getWindowLabel();

  const ran = await withReentryGuard(windowLabel, "source-image-popup:browse", async () => {
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

      // Update store with new path
      useImagePopupStore.getState().setSrc(relativePath);

      // Save immediately
      saveImageChanges(view);

      return true;
    } catch (error) {
      console.error("[SourceImagePopup] Browse failed:", error);
      await message("Failed to change image.", { kind: "error" });
      return false;
    }
  });

  return ran ?? false;
}

/**
 * Copy image path to clipboard.
 */
export async function copyImagePath(): Promise<void> {
  const { imageSrc } = useImagePopupStore.getState();

  if (!imageSrc) {
    return;
  }

  try {
    await writeText(imageSrc);
  } catch (error) {
    console.error("[SourceImagePopup] Copy failed:", error);
  }
}

/**
 * Remove image from the document.
 * Deletes the entire image markdown syntax.
 */
export function removeImage(view: EditorView): void {
  const range = getImageRange(view);
  if (!range) {
    return;
  }

  runOrQueueCodeMirrorAction(view, () => {
    view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
        insert: "",
      },
    });
  });
}
