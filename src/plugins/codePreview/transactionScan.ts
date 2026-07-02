/**
 * Code Preview Transaction Scan Helpers
 *
 * Purpose: Pure helpers that decide whether a code block is previewable and whether
 * a transaction can affect tracked code blocks — the plugin's apply() fast paths use
 * them to skip the full doc.descendants() scan. Split from tiptap.ts for size.
 *
 * Key decisions:
 *   - YAML code fences are previewed only when content has workflow shape
 *     (isWorkflowYaml). Plain YAML blocks (docker-compose, etc.) stay as text.
 *   - changesIntersectRanges works in OLD-position space because the tracked
 *     ranges come from the previous plugin state
 *   - transactionMayAffectCodeBlock conservatively bails on any AttrStep (no slice
 *     to scan) rather than miss a nested block becoming previewable
 *
 * @coordinates-with tiptap.ts — apply() fast paths call these helpers
 * @coordinates-with previewDecorations.ts — decoration builder shares isPreviewable
 * @module plugins/codePreview/transactionScan
 */

import type { Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { AttrStep } from "@tiptap/pm/transform";
import { isWorkflowYaml } from "@/lib/ghaWorkflow/detection";
import type { CodeBlockRange } from "./pluginState";

const PREVIEW_ONLY_LANGUAGES = new Set(["latex", "mermaid", "markmap", "svg", "$$math$$"]);

/**
 * True when this code block should get an inline preview. Either:
 *   - language is in PREVIEW_ONLY_LANGUAGES (latex, mermaid, markmap, svg, $$math$$), OR
 *   - language is yaml/yml AND content has GitHub Actions workflow shape.
 *
 * Content-based gating for yaml means a docker-compose.yml in a fenced
 * code block stays as plain text; only real workflows get the diagram.
 */
export function isPreviewable(language: string, content: string): boolean {
  if (PREVIEW_ONLY_LANGUAGES.has(language)) return true;
  if (language === "yaml" || language === "yml") {
    return isWorkflowYaml(content);
  }
  return false;
}

/**
 * Count previewable code blocks at ANY depth (blockquotes, lists, …) with a
 * block-only walk: descends into block containers but skips textblock content,
 * so it stays O(blocks) — unlike doc.descendants(), which visits every inline
 * node. The decoration builder tracks nested blocks via descendants(), so the
 * apply() fast paths that compare against its ranges must count nested blocks
 * too, or nested inserts/edits slip past without a rebuild.
 */
export function countPreviewableCodeBlocks(doc: PMNode): number {
  let count = 0;
  const visit = (parent: PMNode): void => {
    parent.forEach((node) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        if (isPreviewable((node.attrs.language ?? "").toLowerCase(), node.textContent)) {
          count++;
        }
        return;
      }
      if (node.isBlock && !node.isTextblock) visit(node);
    });
  };
  visit(doc);
  return count;
}

/**
 * Returns true if any step in the transaction's changed ranges (in OLD-position
 * space) overlaps with any of the tracked code block ranges.
 * Uses old positions because `codeBlockRanges` comes from the previous state.
 */
export function changesIntersectRanges(tr: Transaction, ranges: CodeBlockRange[]): boolean {
  if (ranges.length === 0) return false;
  for (let i = 0; i < tr.steps.length; i++) {
    let intersects = false;
    tr.mapping.maps[i].forEach((oldFrom: number, oldTo: number) => {
      if (intersects) return;
      for (const range of ranges) {
        if (oldFrom < range.to && oldTo > range.from) {
          intersects = true;
          return;
        }
      }
    });
    if (intersects) return true;
  }
  return false;
}

/**
 * Returns true if any step in the transaction could introduce or change a
 * code-block node at any depth — used to decide whether the prose-only fast
 * path may safely skip the full document scan (O1 / WI-2.1).
 *
 * Two cases, both cheap (no whole-document walk):
 *  - inserted/markup slices that contain a code-block node (insert, paste,
 *    `setNodeMarkup` via ReplaceAroundStep) — scanned via the step's slice;
 *  - a pure attribute change (`AttrStep`, e.g. a code block's `language`
 *    becoming `mermaid`) which carries NO slice — so we conservatively bail on
 *    any AttrStep rather than miss a nested block becoming previewable.
 */
export function transactionMayAffectCodeBlock(tr: Transaction): boolean {
  for (const step of tr.steps) {
    // Pure attribute change — no slice to scan; could flip a code block's
    // language to a previewable one anywhere in the doc.
    if (step instanceof AttrStep) return true;

    const slice = (step as unknown as { slice?: { content?: { descendants?: unknown } } }).slice;
    const content = slice?.content as
      | { descendants: (fn: (node: { type: { name: string } }) => boolean | void) => void }
      | undefined;
    if (!content?.descendants) continue;
    let found = false;
    content.descendants((node) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        found = true;
        return false;
      }
      return !found;
    });
    if (found) return true;
  }
  return false;
}
