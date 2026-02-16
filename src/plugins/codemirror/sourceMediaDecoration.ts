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
 *   - Each media type gets a distinct CSS class for type-specific colors
 *   - Rebuilds decorations on doc change (simple approach; media tags are infrequent)
 *
 * @coordinates-with blockVideo/tiptap.ts — WYSIWYG counterpart for video
 * @coordinates-with blockAudio/tiptap.ts — WYSIWYG counterpart for audio
 * @coordinates-with videoEmbed/tiptap.ts — WYSIWYG counterpart for video embeds
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

type MediaType = "video" | "audio" | "youtube" | "vimeo" | "bilibili";

interface MediaBlock {
  type: MediaType;
  startLine: number;
  endLine: number;
}

/** Match opening <video or <audio tags at line start (possibly indented) */
const VIDEO_OPEN_REGEX = /^\s*<video[\s>]/i;
const AUDIO_OPEN_REGEX = /^\s*<audio[\s>]/i;
const IFRAME_YOUTUBE_REGEX = /^\s*<iframe[^>]*src=["'][^"']*youtube(?:-nocookie)?\.com[^"']*["'][^>]*>/i;
const IFRAME_VIMEO_REGEX = /^\s*<iframe[^>]*src=["'][^"']*player\.vimeo\.com[^"']*["'][^>]*>/i;
const IFRAME_BILIBILI_REGEX = /^\s*<iframe[^>]*src=["'][^"']*player\.bilibili\.com[^"']*["'][^>]*>/i;

const VIDEO_CLOSE_REGEX = /<\/video>/i;
const AUDIO_CLOSE_REGEX = /<\/audio>/i;
const IFRAME_CLOSE_REGEX = /<\/iframe>/i;

/** Check if a line contains a self-closing pattern (ends with />) */
const SELF_CLOSING_REGEX = /\/>\s*$/;

/**
 * Find all media blocks in the document.
 */
function findMediaBlocks(doc: { lines: number; line: (n: number) => { text: string; from: number } }): MediaBlock[] {
  const blocks: MediaBlock[] = [];
  let i = 1;

  while (i <= doc.lines) {
    const line = doc.line(i);
    const text = line.text;

    let type: MediaType | null = null;
    let closeRegex: RegExp | null = null;

    if (VIDEO_OPEN_REGEX.test(text)) {
      type = "video";
      closeRegex = VIDEO_CLOSE_REGEX;
    } else if (AUDIO_OPEN_REGEX.test(text)) {
      type = "audio";
      closeRegex = AUDIO_CLOSE_REGEX;
    } else if (IFRAME_YOUTUBE_REGEX.test(text)) {
      type = "youtube";
      closeRegex = IFRAME_CLOSE_REGEX;
    } else if (IFRAME_VIMEO_REGEX.test(text)) {
      type = "vimeo";
      closeRegex = IFRAME_CLOSE_REGEX;
    } else if (IFRAME_BILIBILI_REGEX.test(text)) {
      type = "bilibili";
      closeRegex = IFRAME_CLOSE_REGEX;
    }

    if (type && closeRegex) {
      const startLine = i;

      // Check if self-closing or close tag on same line
      if (SELF_CLOSING_REGEX.test(text) || closeRegex.test(text)) {
        blocks.push({ type, startLine, endLine: i });
        i++;
        continue;
      }

      // Find the closing tag on subsequent lines
      let endLine = i;
      let foundClose = false;
      while (endLine < doc.lines) {
        endLine++;
        const nextLine = doc.line(endLine);
        if (closeRegex.test(nextLine.text)) {
          foundClose = true;
          break;
        }
      }

      // Only decorate if we found the closing tag (or reached last line with it)
      if (!foundClose && endLine >= doc.lines) {
        // No close tag found — treat as single-line open tag only
        blocks.push({ type, startLine, endLine: startLine });
      } else {
        blocks.push({ type, startLine, endLine });
      }
      i = endLine + 1;
      continue;
    }

    i++;
  }

  return blocks;
}

/**
 * Build decorations for media blocks.
 */
function buildMediaDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  const mediaBlocks = findMediaBlocks(doc);

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
