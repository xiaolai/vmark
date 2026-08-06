/**
 * The boundary where external text becomes EDITOR text.
 *
 * Purpose: VMark models line endings as METADATA — `documentStore` carries
 * `lineEnding`, settings carry `lineEndingsOnSave`, and `saveToPath` applies the
 * convention at write time. CodeMirror honours that invariant for free, because
 * it normalises when constructing its `Text`. ProseMirror does not: parsing
 * `"First para\r\nsecond line"` yields ONE text node containing a literal
 * carriage return. In a CRLF file WYSIWYG therefore sees no line break at all,
 * just a control character — which then flows into word count, search, lint and
 * CJK formatting.
 *
 * Every external ingress passes through here, so the invariant is established
 * once rather than remembered at each call site.
 *
 * Key decisions:
 *   - Metadata is detected from the RAW text BEFORE canonicalising. Reversing
 *     the order destroys the very convention `lineEndingsOnSave: "preserve"`
 *     exists to preserve — the canonical text has no CRLF left to detect.
 *   - A LEADING U+FEFF is stripped into a `hasBom` flag rather than carried in
 *     the content. A BOM living at offset 0 of the editor buffer breaks
 *     offset-0 block detection and renders as an invisible character; round-trip
 *     fidelity is kept by the flag, not by the character. A BOM anywhere else is
 *     ordinary content and is left alone.
 *   - Canonicalisation is NOT markdown-aware. A CR inside a fenced block is
 *     still a control character; making it aware would mean parsing before
 *     canonicalising, which inverts the dependency.
 *   - Detection is delegated to `linebreakDetection`, not reimplemented. This
 *     module owns the boundary, not the heuristics.
 *
 * @coordinates-with utils/linebreakDetection.ts — detectLinebreaks
 * @coordinates-with utils/linebreaks.ts — normalizeLineEndings, the save-side counterpart
 * @coordinates-with stores/documentStore — the consumer that enforces the invariant
 * @module utils/editorText
 */
import { detectLinebreaks, type HardBreakStyle, type LineEnding } from "./linebreakDetection";

/** UTF-8 byte-order mark, as a JS string. */
const BOM = "﻿";

/** External text decoded into the editor's domain, with its source metadata. */
export interface EditorTextIngest {
  /** LF-only, BOM-free. What `documentStore.content` holds. */
  canonicalEditorText: string;
  /** The convention the SOURCE used, for `lineEndingsOnSave: "preserve"`. */
  lineEnding: LineEnding;
  /** The hard-break convention the SOURCE used. */
  hardBreakStyle: HardBreakStyle;
  /** Whether a leading BOM was stripped, so a save can re-emit it. */
  hasBom: boolean;
}

/**
 * Convert every line ending to LF.
 *
 * `\r\n?` handles CRLF and lone CR in one pass, and is ordered so CRLF is
 * consumed whole rather than leaving a stray LF behind.
 */
export function canonicalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Decode external text into the editor domain, capturing what the source looked
 * like on the way in.
 *
 * Detection runs on `rawDiskText` first — see the module note on ordering.
 */
export function ingestExternalText(rawDiskText: string): EditorTextIngest {
  const { lineEnding, hardBreakStyle } = detectLinebreaks(rawDiskText);

  const hasBom = rawDiskText.startsWith(BOM);
  const withoutBom = hasBom ? rawDiskText.slice(BOM.length) : rawDiskText;

  return {
    canonicalEditorText: canonicalizeLineEndings(withoutBom),
    lineEnding,
    hardBreakStyle,
    hasBom,
  };
}
