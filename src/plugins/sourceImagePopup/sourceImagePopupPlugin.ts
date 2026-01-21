/**
 * Source Image Popup Plugin
 *
 * CodeMirror 6 plugin for editing images in Source mode.
 * Shows a popup when cursor is inside image markdown syntax.
 */

import type { EditorView } from "@codemirror/view";
import { createSourcePopupPlugin } from "@/plugins/sourcePopup";
import { useImagePopupStore } from "@/stores/imagePopupStore";
import { SourceImagePopupView } from "./SourceImagePopupView";

/**
 * Image range result from detection.
 */
interface ImageRange {
  from: number;
  to: number;
  path: string;
  alt: string;
}

/**
 * Find image markdown at cursor position.
 * Detects: ![alt](path) or ![alt](path "title") or ![alt](<path with spaces>)
 */
function findImageAtPos(view: EditorView, pos: number): ImageRange | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  // Regex to match image syntax:
  // - ![alt](path) or ![alt](path "title")
  // - ![alt](<path with spaces>) - angle bracket syntax
  // Captures: [1] = alt, [2] = angle bracket path, [3] = regular path
  const imageRegex = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s"]+))(?:\s+"[^"]*")?\)/g;

  let match;
  while ((match = imageRegex.exec(lineText)) !== null) {
    const matchStart = lineStart + match.index;
    const matchEnd = matchStart + match[0].length;

    // Check if cursor is inside this image markdown
    if (pos >= matchStart && pos <= matchEnd) {
      const alt = match[1];
      // Group 2 is angle-bracket path, Group 3 is regular path
      const path = match[2] || match[3];

      // For popup, we want to edit all images (not just image extensions)
      // Unlike preview which only shows for actual images
      return {
        from: matchStart,
        to: matchEnd,
        path,
        alt,
      };
    }
  }

  return null;
}

/**
 * Detect trigger for image popup.
 * Returns the image range if cursor is inside an image, null otherwise.
 */
function detectImageTrigger(view: EditorView): { from: number; to: number } | null {
  const { from, to } = view.state.selection.main;
  if (from !== to) return null;
  const image = findImageAtPos(view, from);
  if (!image) {
    return null;
  }
  return { from: image.from, to: image.to };
}

/**
 * Extract image data for the popup.
 */
function extractImageData(
  view: EditorView,
  range: { from: number; to: number }
): { imageSrc: string; imageAlt: string; imageNodePos: number; imageNodeType: "image" } {
  // Re-run detection to get full data
  const image = findImageAtPos(view, range.from);
  if (!image) {
    return {
      imageSrc: "",
      imageAlt: "",
      imageNodePos: range.from,
      imageNodeType: "image",
    };
  }

  return {
    imageSrc: image.path,
    imageAlt: image.alt,
    imageNodePos: image.from,
    imageNodeType: "image",
  };
}

/**
 * Create the Source image popup plugin.
 */
export function createSourceImagePopupPlugin() {
  return createSourcePopupPlugin({
    store: useImagePopupStore,
    createView: (view, store) => new SourceImagePopupView(view, store),
    detectTrigger: detectImageTrigger,
    detectTriggerAtPos: (view, pos) => {
      const image = findImageAtPos(view, pos);
      if (!image) return null;
      return { from: image.from, to: image.to };
    },
    extractData: extractImageData,
    triggerOnClick: true,
    triggerOnHover: false,
  });
}
