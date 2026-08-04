/**
 * Purpose: carry a document's FILE convention across a window transfer, and
 * apply it on the other side.
 *
 * A transfer payload's `content` and `savedContent` are canonical editor text
 * — LF, BOM-free — so the file's own line ending and BOM are unrecoverable
 * from them. Before this existed, a CRLF+BOM file moved between windows was
 * rewritten LF and BOM-less on its first save there, under `preserve`: the
 * setting whose whole promise is that it does not do that.
 *
 * Key decisions:
 *   - Every field is optional on the wire. A payload from an older build has
 *     none, and `applyTransferLineMetadata` then leaves the receiver to derive
 *     what it can — exactly the behaviour every payload got before.
 *   - `hardBreakStyle` is included even though it SURVIVES canonicalisation
 *     (`detectHardBreakStyle` normalises EOLs before scanning, so the receiver
 *     could re-derive it). Sending it keeps one rule — "the sender states the
 *     file's convention" — instead of a per-field split a reader has to know.
 *   - `lastDiskContent` travels raw. External-change detection in the
 *     destination compares against what is on disk; handing it canonical text
 *     makes the first watcher event report a change that never happened.
 *
 * @coordinates-with types/tabTransfer.ts — TabTransferPayload
 * @coordinates-with services/workspaces/workspaceTabCollection.ts — the workspace payload
 * @module utils/transferLineMetadata
 */
import type { HardBreakStyle, LineEnding } from "@/utils/linebreakDetection";

/** The file-convention fields a transfer payload carries. */
export interface TransferLineMetadata {
  lineEnding?: LineEnding;
  hardBreakStyle?: HardBreakStyle;
  hasBom?: boolean;
  lastDiskContent?: string;
}

/** The document fields this module reads. Structural, so both stores fit. */
interface ConventionSource {
  lineEnding: LineEnding;
  hardBreakStyle: HardBreakStyle;
  hasBom: boolean;
  lastDiskContent: string;
}

/**
 * Extract the sending document's file convention.
 *
 * `unknown` values are omitted rather than sent: on the wire, absent and
 * "unknown" mean the same thing to the receiver, and omitting keeps payloads
 * from older and newer builds indistinguishable when there is nothing to say.
 */
export function collectTransferLineMetadata(doc: ConventionSource): TransferLineMetadata {
  return {
    ...(doc.lineEnding !== "unknown" ? { lineEnding: doc.lineEnding } : {}),
    ...(doc.hardBreakStyle !== "unknown" ? { hardBreakStyle: doc.hardBreakStyle } : {}),
    ...(doc.hasBom ? { hasBom: true } : {}),
    ...(doc.lastDiskContent ? { lastDiskContent: doc.lastDiskContent } : {}),
  };
}

/**
 * Re-select the convention fields a received payload actually carries.
 *
 * The receiving sites forward these into `initDocument`'s
 * `DocumentRestoreState`. Listing them by hand there re-created the exact drift
 * hazard `buildTransferDocumentFields` exists to prevent, and it also copied a
 * key the sender had deliberately omitted back in holding `undefined` —
 * re-asserting "unknown" as a stated value on a bag whose whole contract is
 * that silence means silence. Selecting here keeps absent absent.
 */
export function pickTransferLineMetadata(meta: TransferLineMetadata): TransferLineMetadata {
  return {
    ...(meta.lineEnding !== undefined ? { lineEnding: meta.lineEnding } : {}),
    ...(meta.hardBreakStyle !== undefined ? { hardBreakStyle: meta.hardBreakStyle } : {}),
    ...(meta.hasBom !== undefined ? { hasBom: meta.hasBom } : {}),
    ...(meta.lastDiskContent !== undefined ? { lastDiskContent: meta.lastDiskContent } : {}),
  };
}

/** The document fields a tab-transfer payload copies verbatim. */
interface TransferableDocument extends ConventionSource {
  content: string;
  savedContent: string;
  isDirty: boolean;
}

/**
 * The document half of a tab-transfer payload: content, dirty flag, and the
 * file convention canonical text cannot carry.
 *
 * Both send sites (tab context menu, drag-out) built this by hand and were
 * free to diverge — which is how the line metadata came to be missing from
 * both at once.
 */
export function buildTransferDocumentFields(doc: TransferableDocument) {
  return {
    content: doc.content,
    savedContent: doc.savedContent,
    isDirty: doc.isDirty,
    ...collectTransferLineMetadata(doc),
  };
}

/** The receiving side's document patch. Empty when the payload carries nothing. */
export function applyTransferLineMetadata(
  meta: TransferLineMetadata | undefined
): Partial<ConventionSource> {
  if (!meta) return {};
  return {
    ...(meta.lineEnding ? { lineEnding: meta.lineEnding } : {}),
    ...(meta.hardBreakStyle ? { hardBreakStyle: meta.hardBreakStyle } : {}),
    ...(meta.hasBom !== undefined ? { hasBom: meta.hasBom } : {}),
    ...(meta.lastDiskContent !== undefined
      ? { lastDiskContent: meta.lastDiskContent }
      : {}),
  };
}
