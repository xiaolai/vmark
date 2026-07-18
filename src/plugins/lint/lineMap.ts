/**
 * Line-to-Block Mapping for WYSIWYG Lint Decorations
 *
 * Purpose: Maps 1-based source-markdown line numbers (as reported by the lint
 * engine) to top-level ProseMirror blocks by re-serializing the document with
 * the same markdown pipeline that produced the linted source.
 *
 * Key decisions:
 *   - Diagnostic line numbers refer to the serialized markdown that
 *     runActiveLint feeds the lint engine (serializeMarkdown of the live doc),
 *     NOT to block textContent. Blank separator lines, code-fence lines, and
 *     per-item list lines only exist in that serialization, so the map is
 *     computed from it — counting textContent newlines mislocates almost
 *     every diagnostic in a real document.
 *   - Each top-level block is serialized standalone and located in the full
 *     serialization by exact substring search from a moving cursor. If a
 *     block's standalone serialization ever diverges from its in-context form
 *     (rare context-dependent constructs), mapping stops rather than risk
 *     decorating the wrong block — unmapped diagnostics simply don't render.
 *   - Cost is roughly two full serializations per call. buildDecorations only
 *     runs when lint results arrive (on demand, not per keystroke), so this
 *     stays cheap in practice.
 *
 * @coordinates-with tiptap.ts — consumes the map in buildDecorations
 * @coordinates-with services/lint/runActiveLint.ts — produces the source text whose lines are mirrored here
 * @module plugins/lint/lineMap
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { Fragment } from "@tiptap/pm/model";
import { serializeMarkdown } from "@/utils/markdownPipeline";

export interface BlockEntry {
  pos: number;
  node: PMNode;
}

/** Build a map from 1-based source-markdown line numbers to top-level blocks. */
export function buildLineToBlockMap(doc: PMNode): Map<number, BlockEntry> {
  const map = new Map<number, BlockEntry>();

  let fullText: string;
  try {
    fullText = serializeMarkdown(doc.type.schema, doc);
  } catch {
    // Fail safe: no decorations rather than wrong ones.
    return map;
  }
  if (!fullText) return map;

  // Char offset where each line starts; lineStarts[i] is line i + 1 (1-based).
  const lineStarts: number[] = [0];
  for (let i = 0; i < fullText.length; i++) {
    if (fullText.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1);
  }
  // Greatest line whose start offset is <= offset (binary search).
  const lineAt = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  let cursor = 0;
  let stopped = false;
  doc.forEach((node, pos) => {
    if (stopped) return;

    let blockText: string;
    try {
      blockText = serializeMarkdown(doc.type.schema, doc.copy(Fragment.from(node)));
    } catch {
      stopped = true;
      return;
    }
    // Nothing to locate (e.g. an empty paragraph serializes to nothing).
    if (!blockText) return;

    const idx = fullText.indexOf(blockText, cursor);
    if (idx === -1) {
      // Standalone serialization diverged from the in-context text — stop
      // instead of guessing (later blocks could map onto the wrong lines).
      stopped = true;
      return;
    }

    const entry: BlockEntry = { pos, node };
    const startLine = lineAt(idx);
    const endLine = lineAt(idx + blockText.length - 1);
    for (let line = startLine; line <= endLine; line++) {
      map.set(line, entry);
    }
    cursor = idx + blockText.length;
  });

  return map;
}
