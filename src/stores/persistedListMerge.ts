/**
 * persistedListMerge — read-merge-write helpers for lists persisted to a
 * SHARED localStorage key by per-window store instances.
 *
 * Purpose: every window holds its own in-memory copy of a persisted list
 * (recent files/workspaces, prompt history, genie recents/favorites) but all
 * windows write to one localStorage key. A blind write from window A persists
 * A's stale snapshot and erases whatever window B added since A hydrated.
 * Each write therefore re-reads the persisted list and merges with it BEFORE
 * setting state — zustand's persist middleware then writes the merged result.
 *
 * Tradeoff (deliberate — no tombstones): a removal in one window wins its own
 * write (merge first, then filter), but can be resurrected by a later merge in
 * another window that still holds the entry. Acceptable for recency/history
 * lists; see bookmarkStore.ts for the origin of the pattern.
 *
 * @coordinates-with workspaceStore.ts — recent files / recent workspaces
 * @coordinates-with aiStore/promptHistory.ts — prompt history entries
 * @coordinates-with aiStore/genies.ts — genie recents and favorites
 * @module stores/persistedListMerge
 */

import type { StateStorage } from "zustand/middleware";

/**
 * Read an array field out of a zustand-persist envelope
 * (`{"state": {...}, "version": n}`) in localStorage.
 *
 * Read straight from storage rather than from store state: state is a
 * snapshot from whenever this window last hydrated, and the whole problem is
 * what other windows persisted since. Returns [] when the key is missing,
 * unreadable, or the field is not an array — unreadable storage is not a
 * reason to lose what is in memory.
 */
export function readPersistedList<T>(storageKey: string, field: string): T[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
    const value = parsed.state?.[field];
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Union by key with the newest timestamp winning per key (`mine` wins ties),
 * ordered newest-first and capped. For timestamped entries such as
 * RecentFile / RecentWorkspace.
 */
export function mergeNewestFirst<T>(
  mine: T[],
  theirs: T[],
  keyOf: (item: T) => string,
  timeOf: (item: T) => number,
  cap: number,
): T[] {
  const byKey = new Map<string, T>();
  for (const item of [...theirs, ...mine]) {
    const existing = byKey.get(keyOf(item));
    if (!existing || timeOf(item) >= timeOf(existing)) byKey.set(keyOf(item), item);
  }
  return [...byKey.values()]
    .sort((a, b) => timeOf(b) - timeOf(a))
    .slice(0, cap);
}

/**
 * Union for untimestamped MRU string lists: `mine` keeps its order (its head
 * is this window's newest write), then `theirs` entries not already present,
 * capped. Without timestamps cross-window recency is approximate — other
 * windows' entries sort after this window's, which is the best available
 * order.
 */
export function mergeMruList(
  mine: string[],
  theirs: string[],
  cap: number = Number.POSITIVE_INFINITY,
): string[] {
  const seen = new Set(mine);
  const merged = [...mine];
  for (const item of theirs) {
    if (!seen.has(item)) {
      seen.add(item);
      merged.push(item);
    }
  }
  return merged.slice(0, cap);
}

/**
 * Wrap a SYNCHRONOUS StateStorage so writes that change none of the guarded
 * list `fields` are skipped entirely.
 *
 * zustand's persist middleware serializes the partialized state on EVERY
 * set() — including sets that touch nothing persisted (loading flags,
 * definition reloads). In a multi-window app such a write pushes this
 * window's stale snapshot over what another window just persisted,
 * bypassing the read-merge-write in the mutation actions. Gating the
 * physical write on "did a guarded field change since this window last read
 * or wrote the key" limits persistence to real mutations; those still go
 * through the actions' merge, so nothing is lost.
 */
export function createFieldChangeGatedStorage(
  base: StateStorage,
  fields: string[],
): StateStorage {
  /** Canonical serialization of the guarded fields in a persist envelope. */
  const fingerprint = (raw: string | null | undefined): string => {
    let state: Record<string, unknown> = {};
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
        if (parsed.state && typeof parsed.state === "object") state = parsed.state;
      } catch {
        // Corrupt disk value — same as empty; a real mutation still writes.
      }
    }
    return JSON.stringify(
      fields.map((f) => (Array.isArray(state[f]) ? state[f] : [])),
    );
  };
  // Guarded fields as of this window's last read or write of the key.
  // null = never hydrated: fail open (write) until the first getItem.
  let lastSeen: string | null = null;
  return {
    getItem: (name) => {
      const raw = base.getItem(name) as string | null;
      lastSeen = fingerprint(raw);
      return raw;
    },
    setItem: (name, value) => {
      const incoming = fingerprint(value);
      if (lastSeen !== null && incoming === lastSeen) return;
      base.setItem(name, value);
      lastSeen = incoming;
    },
    removeItem: (name) => {
      base.removeItem(name);
      lastSeen = fingerprint(null);
    },
  };
}
