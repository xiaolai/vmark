/**
 * History Types and Pure Helpers
 *
 * Type definitions, constants, and pure utility functions for document history.
 * Async operations are in hooks/useHistoryOperations and hooks/useHistoryRecovery.
 */

import { getFileName } from "./pathUtils";

// Types

export interface Snapshot {
  id: string; // Timestamp as string
  timestamp: number;
  type: "manual" | "auto" | "revert";
  size: number;
  preview: string;
}

export interface HistoryIndex {
  documentPath: string;
  documentName: string;
  pathHash: string;
  status: "active" | "deleted" | "orphaned";
  deletedAt: number | null;
  snapshots: Snapshot[];
  settings: {
    maxSnapshots: number;
    maxAgeDays: number;
  };
}

export interface DeletedDocument {
  pathHash: string;
  documentName: string;
  lastPath: string;
  deletedAt: number;
  snapshotCount: number;
  latestPreview: string;
}

export interface HistorySettings {
  maxSnapshots: number;
  maxAgeDays: number;
  mergeWindowSeconds: number; // Consecutive auto-saves within this window overwrite (0 = disabled)
  maxFileSizeKB: number; // Skip snapshot for files larger than this (0 = unlimited)
}

// Constants

export const HISTORY_FOLDER = "history";
export const INDEX_FILE = "index.json";
export const PREVIEW_LENGTH = 200;

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
