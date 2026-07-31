/**
 * WHERE external text came from, and what that implies for the document's
 * line-ending metadata.
 *
 * Purpose: `lineEndingsOnSave: "preserve"` writes back the convention the
 * document is believed to use. That belief has to come from somewhere, and the
 * right source is NOT the same for every ingress. Deriving it from whatever
 * string is being written is correct for a disk read and wrong for the other
 * four cases — most visibly for hot-exit restore, where the persisted body was
 * already canonicalised to LF, so re-deriving answers "lf" and the next save
 * silently rewrites a CRLF user's file.
 *
 * Before this module the rule lived at each call site, which is to say nowhere:
 * the plan review found four ingress paths that each derived from their own
 * argument, and a fifth that did not set metadata at all.
 *
 * Key decisions:
 *   - The origin is a REQUIRED argument with no default. A default is how a new
 *     ingress silently inherits a rule nobody chose for it.
 *   - `prefer-persisted` resolves PER FIELD. A snapshot can carry a known
 *     `lineEnding` and an unknown `hardBreakStyle`; treating the record as one
 *     unit throws away the known half or resurrects the unknown one.
 *   - `keep-existing` returns the document's CURRENT metadata rather than
 *     `unknown`. A tool write or a paste is not a statement about what
 *     convention the file on disk uses.
 *   - An unrecognised origin THROWS. Falling back to `derive` would make the
 *     exhaustiveness gate decorative — the bug it exists to catch would still
 *     ship, just quietly.
 *
 * @coordinates-with utils/editorText.ts — supplies the derived metadata
 * @coordinates-with stores/documentStore/document.ts — ingestExternalContent
 * @module utils/ingestOrigin
 */

import type { HardBreakStyle, LineEnding } from "./linebreakDetection";

/**
 * Every ingress that can put external text into a document.
 *
 * Declared as a runtime list so the policy table can be checked against it in
 * both directions; the type is derived from the list rather than written twice.
 */
export const INGEST_ORIGINS = [
  "disk-open",
  "hot-exit-restore",
  "crash-recovery",
  "mcp-write",
  "paste",
] as const;

/** Where a piece of external text came from. */
export type IngestOrigin = (typeof INGEST_ORIGINS)[number];

/**
 * Whether an ingest establishes a new saved/disk baseline, or merely changes
 * the buffer.
 *
 * A disk read IS the saved truth. A tool write or a paste is an EDIT — the
 * buffer now differs from the file. Treating them alike marks unsaved work
 * clean, and the tab then closes with no prompt and the work is gone.
 */
export type SnapshotPolicy =
  /** The text is the file: move savedContent/lastDiskContent, clear dirty. */
  | "baseline"
  /** The text is an unsaved change: leave the snapshots, recompute dirty. */
  | "edit";

/** Which origins speak for the file on disk, and which are just edits. */
export const INGEST_ORIGIN_SNAPSHOT: Record<IngestOrigin, SnapshotPolicy> = {
  "disk-open": "baseline",
  // Restores the SAVED half of a hot-exit snapshot; the dirty half is applied
  // afterwards as an editor-domain write.
  "hot-exit-restore": "baseline",
  // NOT a baseline, however much it resembles the line above. A crash snapshot
  // IS unsaved work — `_crashRecoveryStartup.ts` passes `savedContent: ""` with
  // the comment "makes it dirty" for exactly this reason. Calling it a baseline
  // marks the recovered buffer clean, so auto-save skips it and closing prompts
  // for nothing: the recovery loses the work it exists to rescue.
  "crash-recovery": "edit",
  "mcp-write": "edit",
  paste: "edit",
};

/** How an origin decides the document's line metadata. */
export type MetadataPolicy =
  /** The text IS the disk truth — derive from it. */
  | "derive"
  /** A snapshot carries its own metadata; derive only where it says nothing. */
  | "prefer-persisted"
  /** Not a statement about the file's convention — leave the document's alone. */
  | "keep-existing";

/**
 * The precedence table.
 *
 * `Record<IngestOrigin, …>` makes an unhandled origin a compile error; the
 * companion test makes it a test failure too, because a type error alone is
 * invisible to anyone reading the table.
 */
export const INGEST_ORIGIN_POLICY: Record<IngestOrigin, MetadataPolicy> = {
  "disk-open": "derive",
  "hot-exit-restore": "prefer-persisted",
  "crash-recovery": "derive",
  "mcp-write": "keep-existing",
  paste: "keep-existing",
};

/** The line-convention metadata a document carries. */
export interface LineMetadata {
  lineEnding: LineEnding;
  hardBreakStyle: HardBreakStyle;
}

export interface ResolveIngestMetadataInput {
  origin: IngestOrigin;
  /** Detected from the raw text being ingested. */
  derived: LineMetadata;
  /** What the document holds right now. */
  existing: LineMetadata;
  /** Metadata stored alongside a snapshot, where the origin has one. */
  persisted?: Partial<LineMetadata>;
}

/** A persisted field counts only when it is present AND actually decided. */
function preferPersisted(persisted: LineEnding | undefined, derived: LineEnding): LineEnding {
  return persisted !== undefined && persisted !== "unknown" ? persisted : derived;
}

/**
 * Decide the document's line metadata for one ingest, per its origin.
 */
export function resolveIngestMetadata({
  origin,
  derived,
  existing,
  persisted,
}: ResolveIngestMetadataInput): LineMetadata {
  const policy = INGEST_ORIGIN_POLICY[origin];

  switch (policy) {
    case "derive":
      return derived;

    case "prefer-persisted":
      return {
        // Canonicalisation ERASES the line ending: a restored body is LF
        // whatever the file was, so deriving from it answers "lf" for every
        // document and the persisted value is the only surviving record.
        lineEnding: preferPersisted(persisted?.lineEnding, derived.lineEnding),
        // The hard-break convention SURVIVES canonicalisation —
        // `detectHardBreakStyle` normalises EOLs before it scans — so the body
        // is always at least as accurate as the snapshot, and is more accurate
        // whenever the dirty half changed the breaks. Preferring the persisted
        // value here could only reintroduce staleness: a snapshot saying
        // "mixed" over a body that is now backslash-only resolves to
        // "twoSpaces" on the next `preserve` save and rewrites every break.
        hardBreakStyle: derived.hardBreakStyle,
      };

    case "keep-existing":
      return existing;

    default:
      throw new Error(
        `Unknown ingest origin "${origin}". Every ingress declares its origin, and ` +
          `every origin has a rule in INGEST_ORIGIN_POLICY — add one rather than ` +
          `letting this path pick a default.`,
      );
  }
}
