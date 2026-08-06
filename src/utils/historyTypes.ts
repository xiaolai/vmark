/**
 * History Types and Pure Helpers
 *
 * Type definitions, constants, and pure utility functions for document history.
 * Async operations are in services/history/historyOperations and services/history/historyRecovery.
 */

import { getFileName } from "./pathUtils";

// Types

/** A single point-in-time snapshot of a document's content. */
export interface Snapshot {
  id: string; // Timestamp + random suffix (e.g. "1700000000000-a1b2c3")
  timestamp: number;
  type: "manual" | "auto" | "revert";
  size: number;
  preview: string;
}

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
 * Validate that a parsed JSON object is a valid HistoryIndex.
 * Returns null if invalid, the validated object if valid.
 */
export function parseHistoryIndex(raw: unknown): HistoryIndex | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.pathHash !== "string") return null;
  if (!Array.isArray(obj.snapshots)) return null;
  return raw as HistoryIndex;
}

// Pure helper functions

/**
 * Generate a preview from content (first N characters)
 */
export function generatePreview(content: string): string {
  return content.slice(0, PREVIEW_LENGTH).replace(/\n/g, " ").trim();
}

/**
 * Get the document name from a path
 */
export function getDocumentName(documentPath: string): string {
  return getFileName(documentPath) || "Untitled";
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
