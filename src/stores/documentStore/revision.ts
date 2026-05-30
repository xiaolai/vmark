/**
 * Document revision IDs — optimistic concurrency control for MCP bridge
 * operations. Each meaningful edit bumps the revision so external readers
 * (the MCP server, in particular) can detect changes between reads.
 *
 * Revisions are keyed **per tab** (WI-0.10, C5). A previous global revision
 * meant an MCP `document.write` targeting a non-active tab was validated
 * against the *active* tab's revision — causing false STALE rejections or
 * missed staleness. Each tab now carries its own revision; an unknown tab is
 * lazily initialized on first read so a read→write cycle stays consistent.
 *
 * @module stores/documentStore/revision
 */

import { create } from "zustand";

/** Generate a random alphanumeric string. */
function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** Generate a new revision ID. */
export function generateRevisionId(): string {
  return `rev-${randomString(8)}`;
}

interface RevisionEntry {
  /** Current revision for this tab */
  revision: string;
  /** Timestamp of last revision change */
  lastUpdated: number;
}

interface RevisionState {
  /** Per-tab revision entries, keyed by tab id. */
  revisions: Record<string, RevisionEntry>;
}

interface RevisionActions {
  /** Update a tab's revision after a document change; returns the new id. */
  updateRevision: (tabId: string) => string;
  /** Set a specific revision for a tab (used on document load). */
  setRevision: (tabId: string, revision: string) => void;
  /** Get a tab's current revision, lazily initializing an unknown tab. */
  getRevision: (tabId: string) => string;
  /** Check whether `revision` matches a tab's current revision. */
  isCurrentRevision: (tabId: string, revision: string) => boolean;
  /** Drop a tab's revision entry (called on tab close). */
  clearRevision: (tabId: string) => void;
}

/** Manages per-tab document revision IDs for optimistic concurrency control in MCP operations. Use selectors, not destructuring. */
export const useRevisionStore = create<RevisionState & RevisionActions>(
  (set, get) => ({
    revisions: {},

    updateRevision: (tabId: string) => {
      const newRevision = generateRevisionId();
      set((s) => ({
        revisions: {
          ...s.revisions,
          [tabId]: { revision: newRevision, lastUpdated: Date.now() },
        },
      }));
      return newRevision;
    },

    setRevision: (tabId: string, revision: string) => {
      set((s) => ({
        revisions: {
          ...s.revisions,
          [tabId]: { revision, lastUpdated: Date.now() },
        },
      }));
    },

    getRevision: (tabId: string) => {
      const existing = get().revisions[tabId];
      if (existing) return existing.revision;
      // Lazily initialize so a read→write cycle on a never-edited tab agrees.
      const revision = generateRevisionId();
      set((s) => ({
        revisions: {
          ...s.revisions,
          [tabId]: { revision, lastUpdated: Date.now() },
        },
      }));
      return revision;
    },

    isCurrentRevision: (tabId: string, revision: string) => {
      return get().getRevision(tabId) === revision;
    },

    clearRevision: (tabId: string) => {
      set((s) => {
        if (!(tabId in s.revisions)) return s;
        const { [tabId]: _, ...rest } = s.revisions;
        return { revisions: rest };
      });
    },
  })
);
