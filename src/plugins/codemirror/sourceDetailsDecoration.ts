/**
 * Source Mode Details Block Decoration Plugin
 *
 * Adds visual markers (left border) to collapsible details blocks.
 * Detects both HTML syntax (<details>) and directive syntax (:::details).
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/** Regex to match opening of HTML details block */
const DETAILS_HTML_OPEN = /^<details(?:\s|>|$)/i;

/** Regex to match closing of HTML details block */
const DETAILS_HTML_CLOSE = /^<\/details>/i;

/** Regex to match HTML summary tag */
const SUMMARY_HTML = /<summary>/i;

/** Regex to match directive style opening: :::details */
const DETAILS_DIRECTIVE_OPEN = /^:::details(?:\s|$)/i;

/** Regex to match directive style closing: ::: */
const DIRECTIVE_CLOSE = /^:::\s*$/;

/**
 * Represents a details block found in the document.
 */
interface DetailsBlock {
  startLine: number;
  endLine: number;
  summaryLine?: number;
  isDirective: boolean;
}

/**
 * Find all details blocks in the document.
 */
function findDetailsBlocks(doc: { lines: number; line: (n: number) => { text: string; from: number } }): DetailsBlock[] {
  const blocks: DetailsBlock[] = [];
  let i = 1;

  while (i <= doc.lines) {
    const line = doc.line(i);
    const text = line.text.trimStart();

    // Check for HTML <details> opening
    if (DETAILS_HTML_OPEN.test(text)) {
      const startLine = i;
      let endLine = i;
      let summaryLine: number | undefined;

      // Find closing </details>
      for (let j = i + 1; j <= doc.lines; j++) {
        const nextLine = doc.line(j);
        const nextText = nextLine.text.trimStart();

        // Check for summary tag
        if (!summaryLine && SUMMARY_HTML.test(nextText)) {
          summaryLine = j;
        }

        if (DETAILS_HTML_CLOSE.test(nextText)) {
          endLine = j;
          break;
        }
      }

      // Only add if we found a closing tag
      if (endLine > startLine) {
        blocks.push({
          startLine,
          endLine,
          summaryLine,
          isDirective: false,
        });
        i = endLine + 1;
        continue;
      }
    }

    // Check for directive :::details opening
    if (DETAILS_DIRECTIVE_OPEN.test(text)) {
      const startLine = i;
      let endLine = i;

      // Find closing :::
      for (let j = i + 1; j <= doc.lines; j++) {
        const nextLine = doc.line(j);
        const nextText = nextLine.text.trimStart();

        if (DIRECTIVE_CLOSE.test(nextText)) {
          endLine = j;
          break;
        }
      }

      // Only add if we found a closing directive
      if (endLine > startLine) {
        blocks.push({
          startLine,
          endLine,
          summaryLine: startLine, // Title is on the same line in directive syntax
          isDirective: true,
        });
        i = endLine + 1;
        continue;
      }
    }

    i++;
  }

  return blocks;
}

/**
 * Build decorations for details blocks.
 */
function buildDetailsDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  const detailsBlocks = findDetailsBlocks(doc);

  for (const block of detailsBlocks) {
    for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
      const line = doc.line(lineNum);

      // Determine additional classes
      const classes = ["cm-details-line"];

      if (lineNum === block.startLine) {
        classes.push("cm-details-start");
      }
      if (lineNum === block.endLine) {
        classes.push("cm-details-end");
      }
      if (lineNum === block.summaryLine) {
        classes.push("cm-details-summary");
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
 * ViewPlugin that applies details block decorations.
 */
export function createSourceDetailsDecorationPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDetailsDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDetailsDecorations(update.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * All extensions for source details decoration.
 */
export const sourceDetailsDecorationExtensions = [createSourceDetailsDecorationPlugin()];
