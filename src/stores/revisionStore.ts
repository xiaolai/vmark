/**
 * Revision Store
 *
 * Manages document revision tracking for optimistic concurrency control.
 * Each document change generates a new revision ID.
 *
 * Revision format: "rev-" + random(8)
 */

import { create } from "zustand";

/**
 * Generate a random alphanumeric string.
 */
function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a new revision ID.
 */
export function generateRevisionId(): string {
  return `rev-${randomString(8)}`;
}

interface RevisionState {
  /** Current document revision */
  currentRevision: string;
  /** Timestamp of last revision change */
  lastUpdated: number;
}

interface RevisionActions {
  /** Update revision after a document change */
  updateRevision: () => string;
  /** Set a specific revision (used on document load) */
  setRevision: (revision: string) => void;
  /** Get the current revision */
  getRevision: () => string;
  /** Check if a revision matches current */
  isCurrentRevision: (revision: string) => boolean;
}

const initialRevision = generateRevisionId();

export const useRevisionStore = create<RevisionState & RevisionActions>(
  (set, get) => ({
    currentRevision: initialRevision,
    lastUpdated: Date.now(),

    updateRevision: () => {
      const newRevision = generateRevisionId();
      set({
        currentRevision: newRevision,
        lastUpdated: Date.now(),
      });
      return newRevision;
    },

    setRevision: (revision: string) => {
      set({
        currentRevision: revision,
        lastUpdated: Date.now(),
      });
    },

    getRevision: () => {
      return get().currentRevision;
    },

    isCurrentRevision: (revision: string) => {
      return get().currentRevision === revision;
    },
  })
);
