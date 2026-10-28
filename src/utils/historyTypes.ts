/**
 * History Types and Pure Helpers
 *
 * Type definitions, constants, and pure utility functions for document history.
 * Async operations are in services/history/historyOperations and services/history/historyRecovery.
 *
 * Key decisions:
 *   - `parseHistoryIndex` checks every field of an index read from disk: an
 *     invalid index is refused, an invalid snapshot entry is dropped (and
 *     reported) so one bad entry never costs the rest of the history, and a
 *     snapshot id must be in the generated alphabet before it can name a file,
 *     and name only one entry.
 *   - Retention settings read from an index are held to the settings page's
 *     ranges: they decide which files the next prune deletes.
 *
 * @module utils/historyTypes
 */

import { getFileName } from "./pathUtils";
import { truncateToLength } from "./truncateText";
import { historyWarn } from "./debug";

// Types

interface SnapshotBase {
  id: string; // Timestamp + random suffix (e.g. "1700000000000-a1b2c3")
  timestamp: number;
  size: number;
  preview: string;
}

/**
 * A single point-in-time snapshot of a document's content. `type` says who
 * made it: a manual save, an autosave, a revert, or an AI client saving
 * through the MCP bridge. Only `auto` snapshots are merged or size-skipped.
 */
export type Snapshot =
  | (SnapshotBase & {
      type: "mcp";
      /**
       * The agent edit journal revision holding this snapshot's text — set
       * when the journal recorded the save. Absent otherwise, and on every
       * snapshot written before the link existed.
       */
      journalRevision?: string;
    })
  | (SnapshotBase & { type: "manual" | "auto" | "revert"; journalRevision?: never });

/** Per-document history metadata including snapshots and settings. */
export interface HistoryIndex {
  documentPath: string;
  documentName: string;
  pathHash: string;
  status: "active" | "deleted" | "orphaned";
  deletedAt: number | null;
  snapshots: Snapshot[];
  settings: HistorySettings;
}

/** Configuration for snapshot retention, merge windows, and file size limits. */
export interface HistorySettings {
  maxSnapshots: number;
  maxAgeDays: number;
  mergeWindowSeconds: number; // Consecutive auto-saves within this window overwrite (0 = disabled)
  maxFileSizeKB: number; // Skip snapshot for files larger than this (0 = unlimited)
}

// Constants

/** Folder name for storing document history snapshots. */
export const HISTORY_FOLDER = "history";
/** Filename for the per-document history index JSON. */
export const INDEX_FILE = "index.json";
/** Maximum character length for snapshot preview text. */
export const PREVIEW_LENGTH = 200;
/** Custom event name dispatched when history is cleared. */
export const HISTORY_CLEARED_EVENT = "vmark:history-cleared";

/** Dispatch the history-cleared CustomEvent on the current window */
export function emitHistoryCleared(): void {
  window.dispatchEvent(new CustomEvent(HISTORY_CLEARED_EVENT));
}

/**
 * A snapshot id in the alphabet VMark generates it from (a millisecond
 * timestamp, `-`, a base-36 suffix; older versions wrote the bare
 * timestamp): lowercase ASCII letters, digits and `-`, starting with a letter
 * or digit, at most 64 characters. The id later names its file, so nothing
 * else — no separator, dot, `..` or NUL — is accepted: an id read from disk
 * can never name a path outside the document's history folder.
 */
const SNAPSHOT_ID = /^[0-9a-z][0-9a-z-]{0,63}$/;
const SNAPSHOT_TYPES = new Set(["manual", "auto", "revert", "mcp"]);
const INDEX_STATUSES = new Set(["active", "deleted", "orphaned"]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One stored snapshot, or null when any field is not one VMark writes. */
function parseSnapshot(raw: unknown): Snapshot | null {
  if (!isRecord(raw)) return null;
  const { id, timestamp, type, size, preview, journalRevision } = raw;
  if (typeof id !== "string" || !SNAPSHOT_ID.test(id)) return null;
  if (!isFiniteNumber(timestamp) || !isFiniteNumber(size) || size < 0) return null;
  if (typeof preview !== "string" || typeof type !== "string" || !SNAPSHOT_TYPES.has(type)) return null;
  const base = { id, timestamp, size, preview };
  if (type !== "mcp") {
    // @edge-case A journal link on anything but an agent save breaks the union.
    return journalRevision === undefined ? { ...base, type: type as "manual" | "auto" | "revert" } : null;
  }
  if (journalRevision === undefined) return { ...base, type };
  return typeof journalRevision === "string" ? { ...base, type, journalRevision } : null;
}

/**
 * The range each retention setting can take — the settings page's own bounds
 * (`CLAMP_RANGES.general` in stores/settingsStore/clamp.ts, which this leaf
 * module cannot import; stores/settingsStore/__tests__/historyTypes.integrity.test.ts holds the two equal).
 * A prune trusts these values to decide which files to delete: a negative age
 * limit would put the cutoff in the future and delete every snapshot.
 */
const SETTING_RANGES: Record<keyof HistorySettings, readonly [number, number]> = {
  maxSnapshots: [1, 1000],
  maxAgeDays: [1, 3650],
  mergeWindowSeconds: [0, 3600],
  maxFileSizeKB: [0, 1_048_576],
};

const inRange = (key: keyof HistorySettings, value: number): number => {
  const [min, max] = SETTING_RANGES[key];
  return Math.min(Math.max(Math.trunc(value), min), max);
};

/**
 * Index settings. The merge window and the size limit came after the first
 * indexes were written; absent, they read as off (0), which is what an index
 * without them behaved as. A present value must be a finite number; one
 * outside its range is brought into it (and truncated to a whole number), so
 * the index — and its history — is kept rather than refused.
 */
function parseSettings(raw: unknown): HistorySettings | null {
  if (!isRecord(raw)) return null;
  const { maxSnapshots, maxAgeDays, mergeWindowSeconds = 0, maxFileSizeKB = 0 } = raw;
  if (![maxSnapshots, maxAgeDays, mergeWindowSeconds, maxFileSizeKB].every(isFiniteNumber)) return null;
  return {
    maxSnapshots: inRange("maxSnapshots", maxSnapshots as number),
    maxAgeDays: inRange("maxAgeDays", maxAgeDays as number),
    mergeWindowSeconds: inRange("mergeWindowSeconds", mergeWindowSeconds as number),
    maxFileSizeKB: inRange("maxFileSizeKB", maxFileSizeKB as number),
  };
}

/**
 * Validate a parsed index file. Null when an index-level field is not one
 * VMark writes. A snapshot entry that is invalid — an unknown type, a
 * journal link on a non-agent save, an id that is not the generated
 * basename (which later names its file), or an id an earlier entry already
 * holds — is dropped and reported, and the rest of the history is kept:
 * rejecting the whole index would make the next save start a fresh one over it.
 */
export function parseHistoryIndex(raw: unknown): HistoryIndex | null {
  if (!isRecord(raw)) return null;
  const { pathHash, documentPath, documentName, status, deletedAt, snapshots } = raw;
  if (typeof pathHash !== "string" || typeof documentPath !== "string" || typeof documentName !== "string") return null;
  if (typeof status !== "string" || !INDEX_STATUSES.has(status)) return null;
  if (deletedAt !== null && !isFiniteNumber(deletedAt)) return null;
  if (!Array.isArray(snapshots)) return null;
  const settings = parseSettings(raw.settings);
  if (settings === null) return null;

  const kept: Snapshot[] = [];
  const seen = new Set<string>();
  for (const entry of snapshots) {
    const parsed = parseSnapshot(entry);
    if (!parsed) {
      historyWarn("Dropping an invalid snapshot entry from the history index of", documentPath);
    } else if (seen.has(parsed.id)) {
      // @edge-case Two entries for one id share one file: deleting either
      // would leave the other naming a file that is gone. Keep the first.
      historyWarn("Dropping a duplicate snapshot id from the history index of", documentPath);
    } else {
      seen.add(parsed.id);
      kept.push(parsed);
    }
  }
  return {
    ...raw,
    pathHash,
    documentPath,
    documentName,
    status: status as HistoryIndex["status"],
    deletedAt,
    snapshots: kept,
    settings,
  };
}

// Pure helper functions

/**
 * Generate a preview from content: its first PREVIEW_LENGTH code units, cut on
 * a character boundary so the stored preview is never a lone surrogate.
 */
export function generatePreview(content: string): string {
  return truncateToLength(content, PREVIEW_LENGTH).replace(/\n/g, " ").trim();
}

/**
 * The document name stored in a history index: the path's file name, or
 * `untitledName` when the path has none. The caller supplies the translated
 * "Untitled" — this module is leaf-pure and cannot reach i18n.
 */
export function getDocumentName(documentPath: string, untitledName: string): string {
  return getFileName(documentPath) || untitledName;
}

/**
 * A new, empty, active history index for `documentPath`. `untitledName` is the
 * caller's translated "Untitled", stored when the path has no file name.
 */
export function createHistoryIndex(
  documentPath: string,
  pathHash: string,
  settings: HistorySettings,
  untitledName: string
): HistoryIndex {
  return {
    documentPath,
    documentName: getDocumentName(documentPath, untitledName),
    pathHash,
    status: "active",
    deletedAt: null,
    snapshots: [],
    settings,
  };
}

/**
 * Get the UTF-8 byte size of a string
 */
export function getByteSize(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

/**
 * Build HistorySettings from GeneralSettings fields.
 * Centralizes the mapping to avoid duplication across callers.
 */
export function buildHistorySettings(general: {
  historyMaxSnapshots: number;
  historyMaxAgeDays: number;
  historyMergeWindow: number;
  historyMaxFileSize: number;
}): HistorySettings {
  return {
    maxSnapshots: general.historyMaxSnapshots,
    maxAgeDays: general.historyMaxAgeDays,
    mergeWindowSeconds: general.historyMergeWindow,
    maxFileSizeKB: general.historyMaxFileSize,
  };
}

/**
 * Generate a 16-character hex hash from a document path
 * Uses Web Crypto API (standard, not Tauri-specific)
 */
export async function hashPath(documentPath: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(documentPath);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
