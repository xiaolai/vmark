/**
 * Source Mode Alert Block Decoration Plugin
 *
 * Adds visual markers (colored left border) to GFM-style alert blocks.
 * Detects syntax like: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

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
 * Find all alert blocks in the document.
 */
function findAlertBlocks(doc: { lines: number; line: (n: number) => { text: string; from: number } }): AlertBlock[] {
  const blocks: AlertBlock[] = [];
  let i = 1;

  while (i <= doc.lines) {
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

        // Find end of this blockquote (continue while lines start with >)
        let endLine = i;
        while (endLine < doc.lines) {
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

  const alertBlocks = findAlertBlocks(doc);

  for (const block of alertBlocks) {
    const typeClass = `cm-alert-${block.type.toLowerCase()}`;

    for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
      const line = doc.line(lineNum);
      const decoration = Decoration.line({
        class: `cm-alert-line ${typeClass}`,
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
