/**
 * persistedSectionMerge — read-merge-write for an OBJECT blob persisted to a
 * shared localStorage key by per-window store instances.
 *
 * Purpose: the object-shaped sibling of persistedListMerge. zustand's `persist`
 * serializes the WHOLE state on every `set()`, so in a multi-window app any
 * write from window A pushes A's entire snapshot over the key — including the
 * sections A never touched, and whose values another window changed since A
 * last read. That is silent data loss, and it needs no simultaneity: any write
 * at all (a view toggle, a background update-check timestamp) is enough.
 *
 * This wrapper makes a write carry only what THIS window actually changed:
 *
 *   1. `getItem` (hydration) records the on-disk state as the baseline.
 *   2. `setItem` diffs the outgoing state against that baseline to find the
 *      sections this window changed, re-reads the key, applies only those
 *      sections on top, and writes the result. The baseline then advances.
 *   3. A section whose outgoing value already equals what is on disk is
 *      dropped — that is this window echoing a value the cross-window sync
 *      handler just applied, and rewriting it would fire a pointless storage
 *      event in every other window.
 *   4. If nothing survives, no physical write happens at all.
 *
 * Tradeoff (deliberate, same as persistedListMerge): if two windows change the
 * SAME section between reads, the later write wins that section. Resolving that
 * needs per-field causality this app has no use for; what matters is that
 * independent sections no longer destroy each other.
 *
 * @coordinates-with settingsStore.ts — wraps its persist storage
 * @coordinates-with useSettingsSync.ts — the inbound half of the same problem
 * @module stores/persistedSectionMerge
 */

import type { StateStorage } from "zustand/middleware";

/** A zustand-persist envelope: `{"state": {...}, "version": n}`. */
interface PersistEnvelope {
  state?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Parse an envelope, returning null when absent or unparseable. */
function parseEnvelope(raw: string | null | undefined): PersistEnvelope | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as PersistEnvelope;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The `state` object of an envelope, or an empty object. */
function stateOf(envelope: PersistEnvelope | null): Record<string, unknown> {
  const state = envelope?.state;
  return state && typeof state === "object" ? state : {};
}

/**
 * Structural equality via JSON. NOT canonical — JSON.stringify is key-order
 * sensitive. This is sufficient here because both operands are produced by the
 * same build from the same defaults through the same deepMerge, so key order is
 * stable; a false "changed" would at worst cause one redundant write, never
 * data loss. It is deliberately not a deep order-independent comparator, which
 * would cost more on every settings write for no real-world benefit.
 */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Wrap a SYNCHRONOUS StateStorage so each write persists only the top-level
 * sections this window changed, merged onto the key's current contents.
 */
export function createSectionMergingStorage(base: StateStorage): StateStorage {
  /**
   * State as of this window's last read or write. `null` = never read, so we
   * cannot tell what we changed — fail open and write in full, matching the
   * behaviour of an unwrapped storage.
   */
  let baseline: Record<string, unknown> | null = null;

  return {
    getItem: (name) => {
      const raw = base.getItem(name) as string | null;
      baseline = stateOf(parseEnvelope(raw));
      return raw;
    },

    // Known limitation: the baseline advances after every `base.setItem`,
    // whether or not it physically persisted. The underlying safe storage
    // swallows failures (e.g. an origin-wide quota exception — possible even
    // for this small blob if other origin data is large), so a failed write is
    // not observable here, and a later unrelated write won't re-include the
    // unsaved section. This matches the sibling createFieldChangeGatedStorage;
    // detecting it would require a read-back on every write.
    setItem: (name, value) => {
      const outgoing = parseEnvelope(value);
      // Unparseable outgoing value: not ours to reason about, pass it through.
      if (!outgoing || baseline === null) {
        base.setItem(name, value);
        if (outgoing) baseline = stateOf(outgoing);
        return;
      }

      const outgoingState = stateOf(outgoing);
      const onDisk = parseEnvelope(base.getItem(name) as string | null);
      // Corrupt or missing disk value — nothing to merge onto; write in full so
      // the key is repaired rather than left broken.
      if (!onDisk) {
        base.setItem(name, value);
        baseline = outgoingState;
        return;
      }

      const diskState = stateOf(onDisk);
      const changed = Object.keys(outgoingState).filter(
        (key) =>
          !sameValue(outgoingState[key], baseline?.[key]) &&
          !sameValue(outgoingState[key], diskState[key]),
      );

      if (changed.length === 0) {
        // Nothing of ours to contribute. Advance the baseline to what we now
        // hold so a later genuine change is still detected.
        baseline = outgoingState;
        return;
      }

      const merged: Record<string, unknown> = { ...diskState };
      for (const key of changed) merged[key] = outgoingState[key];

      base.setItem(name, JSON.stringify({ ...outgoing, state: merged }));
      // Baseline is what THIS window holds in memory — outgoingState — NOT the
      // merged disk result. Recording `merged` would fold in other windows'
      // sections (which this window has not adopted into memory), so this
      // window's still-stale value for such a section would read as "changed"
      // on the next write and clobber the peer's value (audit High-1).
      baseline = outgoingState;
    },

    removeItem: (name) => {
      base.removeItem(name);
      baseline = null;
    },
  };
}
