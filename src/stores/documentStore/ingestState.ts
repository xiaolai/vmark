/**
 * How EXTERNAL text becomes document state.
 *
 * Split from `documentState.ts` (which keeps the shape, the keyed-update
 * helper, the dev-only canonical assertion and the save contract) so both stay
 * under the 300-line gate. Everything here is leaf-pure: it computes a state
 * PATCH and never touches the store.
 *
 * The three functions are the external half of the field contract documented
 * in `documentState.ts`:
 *   - `adoptDiskConvention` — the file changed shape, not content (WI-1.6)
 *   - `buildIngestState`    — an origin-governed ingest (WI-1.2/1.3)
 *
 * There used to be a third, `buildLoadState`, backing a separate `loadContent`
 * action. It duplicated the baseline branch above and had already drifted from
 * it: where this derives the file's convention, that one RETAINED the
 * document's existing metadata whenever no explicit `meta` was passed — which
 * was every production caller. A reload of a file whose line endings had
 * changed on disk therefore kept the stale convention and wrote it back on the
 * next `preserve` save: the WI-1.6 defect again, at a different door. Both
 * callers now use `ingestExternalContent(..., "disk-open")` and the duplicate
 * is gone rather than resynchronised.
 *
 * @coordinates-with documentState.ts — the shape and the save contract
 * @coordinates-with utils/ingestOrigin.ts — the two policy tables
 * @module stores/documentStore/ingestState
 */

import { ingestExternalText } from "@/utils/editorText";
import {
  INGEST_ORIGIN_SNAPSHOT,
  resolveIngestMetadata,
  type IngestOrigin,
  type LineMetadata,
} from "@/utils/ingestOrigin";
import type { DocumentState } from "./documentState";

/**
 * Adopt a benign external rewrite of the SAME content: the new disk bytes plus
 * the convention they carry.
 *
 * Refreshing `lastDiskContent` alone left `lineEnding`/`hasBom` describing the
 * bytes the file no longer has, so a later `preserve` save wrote the OLD
 * convention back and the editor and the sync engine flipped the file between
 * them indefinitely. Content, dirty state and UI flags stay untouched — this
 * says only "the file on disk now looks like THIS" (WI-1.6).
 */
export function adoptDiskConvention(diskContent: string): Partial<DocumentState> {
  const { lineEnding, hardBreakStyle, hasBom } = ingestExternalText(diskContent);
  return { lastDiskContent: diskContent, lineEnding, hardBreakStyle, hasBom };
}

/** Routing options for one external ingest. */
export interface IngestOptions {
  /**
   * File path to adopt; `undefined` keeps the document's current one.
   * Explicitly `| undefined` — "keep the current path" is a STATED choice
   * callers make by passing the value they computed, not an omission.
   */
  filePath?: string | null | undefined;
  /** Metadata stored alongside a snapshot, where the origin has one. */
  persisted?: Partial<LineMetadata> | undefined;
  /**
   * Text to DETECT the file's convention, BOM and disk snapshot from, when it
   * differs from the ingested text. Hot-exit loads the canonical SAVED body as
   * content while the file's truth lives in the raw `last_disk_content` —
   * deriving from the body would answer "lf" for every file.
   */
  deriveFrom?: string;
}

/**
 * Compute the state change for one EXTERNAL ingest: canonicalise the text, and
 * let the origin decide both the metadata and whether this is a new saved
 * baseline or an unsaved edit. The axes are separate on purpose — disk-load
 * semantics on an AI's tool write marks unsaved work clean (auto-save skips
 * it, closing prompts for nothing), bumps `documentId` (remounting the editor
 * destroys undo history per write), and leaves `lastDiskContent` holding a
 * string never on disk, so the watcher reports the untouched file as changed.
 * Pure so both rules are testable without a store.
 */
export function buildIngestState(
  doc: DocumentState,
  rawDiskText: string,
  origin: IngestOrigin,
  opts: IngestOptions | undefined
): Partial<DocumentState> {
  const { canonicalEditorText } = ingestExternalText(rawDiskText);
  // The DISK truth — what convention, BOM and snapshot describe the file —
  // comes from `deriveFrom` when the ingested text is not the disk bytes.
  const diskText = opts?.deriveFrom ?? rawDiskText;
  const { lineEnding, hardBreakStyle, hasBom } = ingestExternalText(diskText);

  const metadata = resolveIngestMetadata({
    origin,
    derived: { lineEnding, hardBreakStyle },
    existing: { lineEnding: doc.lineEnding, hardBreakStyle: doc.hardBreakStyle },
    persisted: opts?.persisted,
  });

  if (INGEST_ORIGIN_SNAPSHOT[origin] === "edit") {
    return {
      content: canonicalEditorText,
      // Dirty against the SAVED text, in the same domain — not against disk.
      isDirty: canonicalEditorText !== doc.savedContent,
      // savedContent, lastDiskContent, documentId, filePath and hasBom all
      // describe the FILE. An edit says nothing about the file, so none move.
      ...metadata,
    };
  }

  return {
    content: canonicalEditorText,
    savedContent: canonicalEditorText,
    // The RAW bytes, deliberately: external-change detection compares against
    // what is actually on disk, and `preserve` needs the exact convention back.
    lastDiskContent: diskText,
    filePath: opts?.filePath === undefined ? doc.filePath : opts.filePath,
    isDirty: false,
    isDivergent: false,
    documentId: doc.documentId + 1,
    selectedText: "",
    hasBom,
    ...metadata,
  };
}
