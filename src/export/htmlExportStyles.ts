/**
 * HTML Export Styles — Composition
 *
 * Purpose: Assemble the complete editor content CSS for HTML export by
 * combining base layout/typography, content elements, and extra blocks
 * from the split style modules.
 *
 * @module export/htmlExportStyles
 * @coordinates-with htmlExport.ts — provides getEditorContentCSS()
 * @coordinates-with htmlExportStylesBase.ts — base layout, typography, code, lists
 * @coordinates-with htmlExportStylesContent.ts — blockquotes, tables, images, marks, alerts
 * @coordinates-with htmlExportStylesExtra.ts — details, math, footnotes, syntax, dark theme
 */

import { getBaseStyles } from "./htmlExportStylesBase";
import { getContentStyles } from "./htmlExportStylesContent";
import { getExtraStyles } from "./htmlExportStylesExtra";

/**
 * Get the base editor CSS for styled exports.
 * This includes all styles needed for content rendering.
 *
 * Composed from three sub-modules:
 * - Base: container layout, typography, code blocks, lists, task lists
 * - Content: blockquotes, tables, images, horizontal rules, marks, alerts
 * - Extra: details, math, footnotes, wiki links, CJK, syntax highlighting, dark theme
 */
export function getEditorContentCSS(): string {
  return [getBaseStyles(), getContentStyles(), getExtraStyles()]
    .join("\n")
    .trim();
}
