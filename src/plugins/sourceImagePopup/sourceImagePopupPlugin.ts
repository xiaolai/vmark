/**
 * Source Image Popup Plugin
 *
 * CodeMirror 6 plugin for editing images in Source mode.
 * Shows a popup when cursor is inside image markdown syntax.
 */

import type { EditorView } from "@codemirror/view";
import { createSourcePopupPlugin } from "@/plugins/sourcePopup";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { hideImagePreview } from "@/plugins/imagePreview/ImagePreviewView";
import { SourceImagePopupView } from "./SourceImagePopupView";

/**
 * Image range result from detection.
 */
interface MediaRange {
  from: number;
  to: number;
  path: string;
  alt: string;
  mediaType: "image" | "block_image" | "block_video" | "block_audio";
}

/**
 * Find image markdown at cursor position.
 * Detects: ![alt](path) or ![alt](path "title") or ![alt](<path with spaces>)
 */
function findImageAtPos(view: EditorView, pos: number): MediaRange | null {
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
        mediaType: "image" as const,
      };
    }
  }

  return null;
}

/**
 * Find HTML media tag at cursor position.
 * Detects: <video>, <audio>, and <iframe> embeds (single-line).
 *
 * RW-5 (L17) — iframe parity in Source media popup: an `<iframe>` video
 * embed is treated as `block_video` so it edits its `src` like other media,
 * mirroring the existing video/audio regex+store pattern (no new MediaNodeType).
 */
function findHtmlMediaAtPos(view: EditorView, pos: number): MediaRange | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  const mediaPatterns: Array<{ regex: RegExp; type: "block_video" | "block_audio" }> = [
    { regex: /<video\b[^>]*>.*?<\/video>/gi, type: "block_video" },
    { regex: /<audio\b[^>]*>.*?<\/audio>/gi, type: "block_audio" },
    { regex: /<iframe\b[^>]*>.*?<\/iframe>/gi, type: "block_video" },
    { regex: /<video\b[^>]*\/?>/gi, type: "block_video" },
    { regex: /<audio\b[^>]*\/?>/gi, type: "block_audio" },
    { regex: /<iframe\b[^>]*\/?>/gi, type: "block_video" },
  ];

  for (const { regex, type } of mediaPatterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(lineText)) !== null) {
      const matchStart = lineStart + match.index;
      const matchEnd = matchStart + match[0].length;
      if (pos >= matchStart && pos <= matchEnd) {
        const srcMatch = match[0].match(/src=["']([^"']+)["']/);
        const src = srcMatch?.[1] ?? "";
        return { from: matchStart, to: matchEnd, path: src, alt: "", mediaType: type };
      }
    }
  }

  return null;
}

/**
 * Find any media element at cursor position (image markdown or HTML media tag).
 */
function findMediaAtPos(view: EditorView, pos: number): MediaRange | null {
  return findImageAtPos(view, pos) ?? findHtmlMediaAtPos(view, pos);
}

/**
 * Detect trigger for media popup.
 * Returns the media range if cursor is inside any media, null otherwise.
 */
function detectImageTrigger(view: EditorView): { from: number; to: number } | null {
  const { from, to } = view.state.selection.main;
  if (from !== to) return null;
  const media = findMediaAtPos(view, from);
  if (!media) return null;
  return { from: media.from, to: media.to };
}

/**
 * Extract media data for the popup.
 */
function extractImageData(
  view: EditorView,
  range: { from: number; to: number }
): { mediaSrc: string; mediaAlt: string; mediaNodePos: number; mediaNodeType: "image" | "block_image" | "block_video" | "block_audio" } {
  const media = findMediaAtPos(view, range.from);
  if (!media) {
    return {
      mediaSrc: "",
      mediaAlt: "",
      mediaNodePos: range.from,
      mediaNodeType: "image",
    };
  }

  return {
    mediaSrc: media.path,
    mediaAlt: media.alt,
    mediaNodePos: media.from,
    mediaNodeType: media.mediaType,
  };
}

/**
 * Create the Source image popup plugin.
 */
export function createSourceImagePopupPlugin() {
  return createSourcePopupPlugin({
    store: useMediaPopupStore,
    /* v8 ignore start -- @preserve createView callback only runs inside live CodeMirror; not exercised in unit tests */
    createView: (view, store) => new SourceImagePopupView(view, store),
    /* v8 ignore stop */
    detectTrigger: detectImageTrigger,
    detectTriggerAtPos: (view, pos) => {
      const media = findMediaAtPos(view, pos);
      if (!media) return null;
      return { from: media.from, to: media.to };
    },
    extractData: extractImageData,
    /* v8 ignore start -- @preserve reason: onOpen callback only fires on live editor click; not exercised in unit tests */
    onOpen: () => {
      hideImagePreview();
    },
    /* v8 ignore stop */
    triggerOnClick: true,
    triggerOnHover: false,
  });
}
