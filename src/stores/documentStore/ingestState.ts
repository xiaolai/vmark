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
 *   - `buildLoadState`      — a disk load with an explicit path and metadata
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
  /** File path to adopt; `undefined` keeps the document's current one. */
  filePath?: string | null;
  /** Metadata stored alongside a snapshot, where the origin has one. */
  persisted?: Partial<LineMetadata>;
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

/**
 * Compute the state change for a disk LOAD or reload.
 *
 * Same domain split as `buildIngestState` — canonical for the editor, raw for
 * the disk snapshot — but keeps `loadContent`'s explicit `filePath` and `meta`
 * arguments, which the origin-driven ingest path does not carry.
 *
 * All three constructors (`createInitialDocument`, this, `buildIngestState`)
 * now converge on `ingestExternalText`: LF canonicalisation AND the BOM strip.
 * The strip was deliberately withheld until `saveToPath` re-emitted the mark
 * (decision D1) — before that, converging would have made every BOM'd file
 * lose its BOM on first save.
 */
export function buildLoadState(
  doc: DocumentState,
  content: string,
  filePath: string | null | undefined,
  meta: Partial<LineMetadata> | undefined
): Partial<DocumentState> {
  const { canonicalEditorText, hasBom } = ingestExternalText(content);
  return {
    content: canonicalEditorText,
    savedContent: canonicalEditorText,
    lastDiskContent: content,
    filePath: filePath === undefined ? doc.filePath : filePath,
    isDirty: false,
    isDivergent: false, // Reload from disk clears divergent state
    documentId: doc.documentId + 1,
    selectedText: "",
    hasBom,
    lineEnding: meta?.lineEnding ?? doc.lineEnding,
    hardBreakStyle: meta?.hardBreakStyle ?? doc.hardBreakStyle,
  };
}
