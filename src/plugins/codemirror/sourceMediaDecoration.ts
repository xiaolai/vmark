/**
 * Source Mode Media Tag Decoration Plugin
 *
 * Purpose: Adds visual markers (colored left border + icon) to media HTML tags
 * in Source mode so users can identify <video>, <audio>, and video embed <iframe>
 * blocks at a glance without switching to WYSIWYG.
 *
 * Key decisions:
 *   - Detects opening tags (<video, <audio, <iframe with YouTube/Vimeo/Bilibili src)
 *     and decorates all lines through the closing tag
 *   - Uses a single combined regex per line instead of 5 separate tests
 *   - Closing-tag lookahead is bounded to 200 lines to prevent O(n) scans on unclosed tags
 *   - Each media type gets a distinct CSS class for type-specific colors
 *   - Rebuilds on doc/viewport change, scanning only the viewport window
 *     (viewportScanWindow) so cost is O(viewport), not O(document). The window
 *     margin equals MAX_LOOKAHEAD, so any block intersecting the viewport has
 *     its opening tag inside the window — viewport scanning is complete here.
 *
 * @coordinates-with blockVideo/tiptap.ts — WYSIWYG counterpart for video
 * @coordinates-with blockAudio/tiptap.ts — WYSIWYG counterpart for audio
 * @coordinates-with videoEmbed/tiptap.ts — WYSIWYG counterpart for video embeds
 * @coordinates-with viewportScan.ts — bounds the scan to the visible line window
 * @module plugins/codemirror/sourceMediaDecoration
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { viewportScanWindow } from "./viewportScan";

export type MediaType = "video" | "audio" | "youtube" | "vimeo" | "bilibili";

export interface MediaBlock {
  type: MediaType;
  startLine: number;
  endLine: number;
}

/** Minimal CodeMirror doc surface the pure scanning helpers need. */
export interface MediaDocLike {
  lines: number;
  line(n: number): { text: string; from: number };
}

/** Maximum lines to scan forward looking for a closing tag */
const MAX_LOOKAHEAD = 200;

/** Combined opening tag regex — single pass per line instead of 5 separate tests */
const MEDIA_OPEN_REGEX = /^\s*<(video|audio|iframe)([\s>])/i;

/** Identify iframe media type by src attribute */
const IFRAME_SRC_YOUTUBE = /youtube(?:-nocookie)?\.com/i;
const IFRAME_SRC_VIMEO = /player\.vimeo\.com/i;
const IFRAME_SRC_BILIBILI = /player\.bilibili\.com/i;

const CLOSE_REGEXES: Record<string, RegExp> = {
  video: /<\/video>/i,
  audio: /<\/audio>/i,
  iframe: /<\/iframe>/i,
};

/** Check if a line contains a self-closing pattern (ends with />) */
const SELF_CLOSING_REGEX = /\/>\s*$/;

/**
 * Classify an iframe line by its src attribute.
 * Returns null if the iframe doesn't match any known video platform.
 */
export function classifyIframe(text: string): MediaType | null {
  if (IFRAME_SRC_YOUTUBE.test(text)) return "youtube";
  if (IFRAME_SRC_VIMEO.test(text)) return "vimeo";
  if (IFRAME_SRC_BILIBILI.test(text)) return "bilibili";
  return null;
}

/**
 * Match a line against the media opening-tag pattern and classify it.
 * Returns the raw tag (for close-tag matching) and the media type,
 * or null when the line doesn't open a recognized media block.
 */
export function matchMediaOpenTag(text: string): { tag: string; type: MediaType } | null {
  const openMatch = MEDIA_OPEN_REGEX.exec(text);
  if (!openMatch) return null;

  const tag = openMatch[1].toLowerCase(); // "video", "audio", or "iframe"
  const type = tag === "video" || tag === "audio" ? tag : classifyIframe(text);
  if (!type) return null;

  return { tag, type };
}

/** Whether the opening line also completes the block (self-closing or same-line close). */
export function isSingleLineMediaBlock(text: string, tag: string): boolean {
  return SELF_CLOSING_REGEX.test(text) || CLOSE_REGEXES[tag].test(text);
}

/**
 * Find the line carrying the closing tag for a block opened at `startLine`.
 * Lookahead is bounded to MAX_LOOKAHEAD lines; returns null when no close
 * tag is found within the bound (caller treats the block as single-line).
 */
export function findMediaCloseLine(doc: MediaDocLike, tag: string, startLine: number): number | null {
  const closeRegex = CLOSE_REGEXES[tag];
  let endLine = startLine;
  while (endLine < doc.lines && endLine - startLine < MAX_LOOKAHEAD) {
    endLine++;
    if (closeRegex.test(doc.line(endLine).text)) {
      return endLine;
    }
  }
  return null;
}

/**
 * Find all media blocks whose opening tag falls in [fromLine, toLine].
 * Bounds default to the whole document. Uses a single combined regex per line
 * and bounded lookahead for closing tags.
 */
export function findMediaBlocks(
  doc: MediaDocLike,
  fromLine: number = 1,
  toLine: number = doc.lines,
): MediaBlock[] {
  const blocks: MediaBlock[] = [];
  let i = fromLine;

  while (i <= toLine) {
    const text = doc.line(i).text;

    const open = matchMediaOpenTag(text);
    if (!open) {
      i++;
      continue;
    }

    const startLine = i;

    if (isSingleLineMediaBlock(text, open.tag)) {
      blocks.push({ type: open.type, startLine, endLine: startLine });
      i++;
      continue;
    }

    const closeLine = findMediaCloseLine(doc, open.tag, startLine);
    if (closeLine !== null) {
      blocks.push({ type: open.type, startLine, endLine: closeLine });
      i = closeLine + 1;
    } else {
      // No close tag within lookahead — treat as single-line
      blocks.push({ type: open.type, startLine, endLine: startLine });
      i = startLine + 1;
    }
  }

  return blocks;
}

/**
 * Build decorations for media blocks.
 */
function buildMediaDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  // Margin = MAX_LOOKAHEAD bounds block length, so any block intersecting the
  // viewport has its opening tag inside the window — the scan stays complete.
  const { startLine, endLine } = viewportScanWindow(view, MAX_LOOKAHEAD);
  const mediaBlocks = findMediaBlocks(doc, startLine, endLine);

  for (const block of mediaBlocks) {
    const typeClass = `cm-media-${block.type}`;

    for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
      const line = doc.line(lineNum);
      const classes = ["cm-media-tag", typeClass];

      if (lineNum === block.startLine) {
        classes.push("cm-media-first");
      }

      const decoration = Decoration.line({
        class: classes.join(" "),
      });
      builder.add(line.from, line.from, decoration);
    }
  }

  return builder.finish();
}

/**
 * ViewPlugin that applies media tag decorations.
 */
export function createSourceMediaDecorationPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildMediaDecorations(view);
      }

      update(update: ViewUpdate) {
        /* v8 ignore next 3 -- @preserve viewportChanged branch and else path not covered in tests */
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildMediaDecorations(update.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * All extensions for source media decoration.
 */
export const sourceMediaDecorationExtensions = [createSourceMediaDecorationPlugin()];
