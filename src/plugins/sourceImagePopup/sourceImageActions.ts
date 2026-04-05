/**
 * Source Image Popup Actions
 *
 * Actions for image editing in Source mode (CodeMirror 6).
 * Handles browse, copy, remove, and save operations.
 */

import type { EditorView } from "@codemirror/view";
import { open, message } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { dirname, join } from "@tauri-apps/api/path";
import i18n from "@/i18n";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { copyImageToAssets } from "@/hooks/useImageOperations";
import { withReentryGuard } from "@/utils/reentryGuard";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { sourceActionError } from "@/utils/debug";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";

/**
 * Build image markdown syntax.
 */
function buildImageMarkdown(
  alt: string,
  src: string,
  title: string | null,
  useAngleBrackets: boolean,
  width?: string,
): string {
  const shouldUseAngleBrackets = useAngleBrackets || /\s/.test(src);
  const dest = shouldUseAngleBrackets ? `<${src}>` : src;
  const titlePart = title ? ` "${title}"` : "";
  const widthPart = width ? `{width=${width}}` : "";
  const safeAlt = alt.replace(/\]/g, "\\]");
  return `![${safeAlt}](${dest}${titlePart})${widthPart}`;
}

function parseImageMarkdown(
  markdown: string
): { alt: string; src: string; title: string | null; useAngleBrackets: boolean; width: string } | null {
  // Match image with optional {width=N} suffix
  const match = markdown.match(
    /^!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s"]+))(?:\s+"([^"]*)")?\)(?:\{width=(\d+(?:px|%)?)\})?$/
  );
  if (!match) return null;
  return {
    alt: match[1],
    src: match[2] || match[3],
    title: match[4] ?? null,
    useAngleBrackets: Boolean(match[2]),
    width: match[5] ?? "",
  };
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
  const { mediaNodePos: imageNodePos } = useMediaPopupStore.getState();
  if (imageNodePos < 0) return null;
  return findImageAtPos(view, imageNodePos);
}

function getImageMetaFromRange(
  view: EditorView,
  range: { from: number; to: number }
): { title: string | null; useAngleBrackets: boolean; width: string } {
  const markdown = view.state.doc.sliceString(range.from, range.to);
  const parsed = parseImageMarkdown(markdown);
  return {
    title: parsed?.title ?? null,
    useAngleBrackets: parsed?.useAngleBrackets ?? false,
    width: parsed?.width ?? "",
  };
}

/**
 * Save image changes to the document.
 * Replaces the current image markdown with updated values.
 */
export function saveImageChanges(view: EditorView): void {
  const state = useMediaPopupStore.getState();
  const { mediaSrc: imageSrc, mediaAlt: imageAlt } = state;
  const range = getImageRange(view);
  if (!range) {
    return;
  }

  const { title, useAngleBrackets, width } = getImageMetaFromRange(view, range);
  const newMarkdown = buildImageMarkdown(imageAlt, imageSrc, title, useAngleBrackets, width || undefined);

  // Account for potential {width=N} suffix after the image markdown
  const extendedText = view.state.doc.sliceString(range.from, Math.min(range.to + 30, view.state.doc.length));
  const baseImage = extendedText.match(/^!\[[^\]]*\]\([^)]*\)/);
  const afterBase = baseImage ? extendedText.slice(baseImage[0].length) : "";
  const widthSuffix = afterBase.match(/^\{width=\d+(?:px|%)?\}/);
  const actualEnd = widthSuffix ? range.to + widthSuffix[0].length : range.to;

  runOrQueueCodeMirrorAction(view, () => {
    view.dispatch({
      changes: {
        from: range.from,
        to: actualEnd,
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
        await message(i18n.t("dialog:unsavedDocument.messageLocalImages"), {
          title: i18n.t("dialog:unsavedDocument.title"),
          kind: "warning",
        });
        return false;
      }

      const relativePath = await copyImageToAssets(sourcePath as string, filePath);

      // Update store with new path
      useMediaPopupStore.getState().setSrc(relativePath);

      // Save immediately
      saveImageChanges(view);

      return true;
    } catch (error) {
      sourceActionError("Browse failed:", error);
      await message(i18n.t("dialog:toast.failedToChangeImage"), { kind: "error" });
      return false;
    }
  });

  return ran ?? false;
}

/**
 * Copy image path to clipboard.
 * Resolves relative paths to absolute using the current document's directory.
 */
export async function copyImagePath(): Promise<void> {
  const { mediaSrc: imageSrc } = useMediaPopupStore.getState();

  if (!imageSrc) {
    return;
  }

  // Resolve relative paths to absolute
  let pathToCopy = imageSrc;
  if (!imageSrc.startsWith("/") && !imageSrc.startsWith("http")) {
    const windowLabel = getWindowLabel();
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : undefined;
    const filePath = doc?.filePath;
    if (filePath) {
      try {
        const docDir = await dirname(filePath);
        const cleanPath = imageSrc.replace(/^\.\//, "");
        pathToCopy = await join(docDir, cleanPath);
      } catch {
        // Fall back to raw src if resolution fails
      }
    }
  }

  try {
    await writeText(pathToCopy);
  } catch (error) {
    sourceActionError("Copy failed:", error);
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

  // Extend range to include trailing {width=N} suffix if present
  const trailingText = view.state.doc.sliceString(range.to, range.to + 30);
  const widthSuffix = trailingText.match(/^\{width=\d+(?:px|%)?\}/);
  const actualEnd = widthSuffix ? range.to + widthSuffix[0].length : range.to;

  runOrQueueCodeMirrorAction(view, () => {
    view.dispatch({
      changes: {
        from: range.from,
        to: actualEnd,
        insert: "",
      },
    });
  });
}
