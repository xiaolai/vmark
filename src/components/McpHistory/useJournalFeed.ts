/**
 * useJournalFeed — a history panel's live view of one journal read: the
 * value is read now and again after every journal change in any window.
 *
 * Key decisions:
 *   - Keyed per activation: a value is only returned for the key it was
 *     read for, and is dropped when that key's feed ends, so a panel that
 *     switches documents (or to none) and back never shows a value read
 *     before it left while the new read is in flight.
 *   - `refresh()` restarts the feed for the same key: the old feed's reply
 *     still in flight is dropped, so there is only ever one writer, and the
 *     current value stays shown until the new one arrives.
 *   - `fetch` must be stable (a module function): a new identity restarts
 *     the feed.
 *   - A failed read keeps the last value and sets `failed`; the feed itself
 *     retries (`journalFeed.ts`). `failed` is read health only: a listener
 *     that cannot be registered is the feed's to handle (it polls and retries
 *     the registration), so a good read is never a feed that hears nothing.
 *   - `pollMs` maps the value held for the key to a poll interval (or none);
 *     only the resulting number restarts the feed, so a new function each
 *     render costs nothing and the feed polls exactly while it asks to.
 *
 * @coordinates-with services/agentJournal/journalFeed.ts — listen-then-read, retry and fallback polling
 * @module components/McpHistory/useJournalFeed
 */

import { useCallback, useEffect, useState } from "react";
import { startJournalFeed } from "@/services/agentJournal/journalFeed";
import { journalWarn } from "@/utils/debug";

export interface JournalFeedState<T> {
  value: T | null;
  failed: boolean;
  /** A reply for this key has arrived (value or failure). */
  loaded: boolean;
  /** Read again now, through the feed, without waiting for a journal change. */
  refresh: () => void;
}

interface Held<T> {
  key: string;
  value: T | null;
  failed: boolean;
}

/** Follow `fetch(key)` across journal changes; `key === null` reads nothing. */
export function useJournalFeed<T>(
  key: string | null,
  fetch: (key: string) => Promise<T>,
  pollMs?: (value: T | null) => number | null,
): JournalFeedState<T> {
  const [held, setHeld] = useState<Held<T> | null>(null);
  const [round, setRound] = useState(0);
  const refresh = useCallback(() => setRound((n) => n + 1), []);
  const current = held !== null && held.key === key ? held.value : null;
  const poll = pollMs ? pollMs(current) : null;

  // The key's activation: when it ends (another key, none, or unmount) its value goes with it.
  useEffect(() => {
    if (key === null) return;
    return () => setHeld(null);
  }, [key, fetch]);

  useEffect(() => {
    if (key === null) return;
    const feed = startJournalFeed(
      () => fetch(key),
      (value) => setHeld({ key, value, failed: false }),
      (error) => {
        journalWarn("history view unavailable:", error);
        setHeld((prev) => ({ key, value: prev?.key === key ? prev.value : null, failed: true }));
      },
      poll,
    );
    return () => feed.stop();
  }, [key, fetch, round, poll]);

  if (held === null || held.key !== key) return { value: null, failed: false, loaded: false, refresh };
  return { value: held.value, failed: held.failed, loaded: true, refresh };
}
