/**
 * Source Mode Alert Block Decoration Plugin
 *
 * Purpose: Adds visual markers (colored left border) to GFM-style alert blocks
 * in Source mode so users can see alert types at a glance without switching to WYSIWYG.
 *
 * Key decisions:
 *   - Detects the `> [!TYPE]` syntax pattern and decorates all lines of the blockquote
 *   - Each alert type gets a distinct CSS class for colored borders matching WYSIWYG rendering
 *   - Rebuilds decorations on doc/viewport change, scanning only the viewport
 *     window (viewportScanWindow) so cost is O(viewport), not O(document)
 *
 * @coordinates-with alertBlock/tiptap.ts — WYSIWYG counterpart
 * @coordinates-with viewportScan.ts — bounds the scan to the visible line window
 * @module plugins/codemirror/sourceAlertDecoration
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

/** Supported alert types matching WYSIWYG */
const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
type AlertType = (typeof ALERT_TYPES)[number];

/** Regex to match alert type marker: > [!NOTE] or > [!TIP] etc. */
const ALERT_TYPE_REGEX = /^>\s*\[!(\w+)\]\s*$/i;

/** Regex to match a blockquote line */
const BLOCKQUOTE_LINE_REGEX = /^>/;

/**
 * Represents an alert block found in the document.
 */
interface AlertBlock {
  type: AlertType;
  startLine: number;
  endLine: number;
}

/**
 * Find all alert blocks whose marker line falls in [fromLine, toLine].
 * Bounds default to the whole document. A block's downward extent is followed
 * to its true end (bounded by the blockquote run), so a block that begins
 * inside the window but continues below it is still fully described.
 * @internal Exported for testing.
 */
export function findAlertBlocks(
  doc: { lines: number; line: (n: number) => { text: string; from: number } },
  fromLine: number = 1,
  toLine: number = doc.lines,
): AlertBlock[] {
  const blocks: AlertBlock[] = [];
  let i = fromLine;

  while (i <= toLine) {
    const line = doc.line(i);
    const text = line.text;

    // Check if this line is an alert type marker
    const typeMatch = text.match(ALERT_TYPE_REGEX);
    if (typeMatch) {
      const typeName = typeMatch[1].toUpperCase();

      // Validate it's a supported type
      if (ALERT_TYPES.includes(typeName as AlertType)) {
        const alertType = typeName as AlertType;
        const startLine = i;

        // Extend the block while lines start with `>`, but never past `toLine`.
        // Blockquotes are unbounded, so without this cap a long `>`-quoted run
        // beginning with an alert marker would scan + decorate O(document) lines
        // on every keystroke. Lines below the window aren't rendered anyway and
        // are decorated on scroll (viewportChanged rebuilds with a new window).
        let endLine = i;
        while (endLine < toLine) {
          const nextLine = doc.line(endLine + 1);
          if (BLOCKQUOTE_LINE_REGEX.test(nextLine.text)) {
            endLine++;
          } else {
            break;
          }
        }

        blocks.push({
          type: alertType,
          startLine,
          endLine,
        });

        // Skip past this block
        i = endLine + 1;
        continue;
      }
    }

    i++;
  }

  return blocks;
}

/**
 * Build decorations for alert blocks.
 */
function buildAlertDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  const { startLine, endLine } = viewportScanWindow(view);
  const alertBlocks = findAlertBlocks(doc, startLine, endLine);

  for (const block of alertBlocks) {
    const typeClass = `cm-alert-${block.type.toLowerCase()}`;

    for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
      const line = doc.line(lineNum);
      const classes = ["cm-alert-line", typeClass];

      // Add special class for the first line (shows icon)
      if (lineNum === block.startLine) {
        classes.push("cm-alert-first");
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
 * ViewPlugin that applies alert block decorations.
 */
export function createSourceAlertDecorationPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildAlertDecorations(view);
      }

      update(update: ViewUpdate) {
        /* v8 ignore next 3 -- @preserve viewportChanged branch and else path not covered in tests */
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildAlertDecorations(update.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * All extensions for source alert decoration.
 */
export const sourceAlertDecorationExtensions = [createSourceAlertDecorationPlugin()];
