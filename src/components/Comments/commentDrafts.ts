/**
 * Comment drafts — keeps the comment panel's unsent text (a new comment
 * with its selection, a reply, which thread is being replied to) across the
 * history popover closing and reopening, so Escape or an outside click
 * never throws a draft away.
 *
 * Key decisions:
 *   - The popover unmounts its panels when it closes, so a draft cannot
 *     live in component state; it lives here, keyed by what it belongs to
 *     (the tab, the document, the thread), and a remount reads it back.
 *   - This module sits in the comments chunk, loaded on demand
 *     (`lazyHistoryParts.tsx`), so the status bar's cold-start bundle does
 *     not grow; the history button keeps closing as before.
 *   - Setting a draft back to its empty value forgets it, so a sent or
 *     cancelled draft leaves nothing behind.
 *   - A key change (another tab focused) reads that key's own draft: one
 *     tab's selection is never offered on another tab.
 *   - Every mounted reader of a key is subscribed to it, so a draft set
 *     from a component that has since unmounted (a create that lands
 *     after the popover closed and reopened) reaches the panel open now.
 *
 * Known limitations: a draft of a tab that is closed without cancelling it
 * stays in memory until the window reloads; it is a few strings.
 *
 * @coordinates-with components/Comments/AddComment.tsx — the new comment
 * @coordinates-with components/Comments/CommentsPanel.tsx — the thread being replied to
 * @coordinates-with components/Comments/CommentThreadView.tsx — the reply
 * @module components/Comments/commentDrafts
 */

import { useCallback, useSyncExternalStore } from "react";

const kept = new Map<string, unknown>();
const subscribers = new Set<() => void>();

const subscribe = (onChange: () => void) => {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
};

const notify = () => {
  for (const onChange of [...subscribers]) onChange();
};

/**
 * State under `key` that outlives the component: read back on remount,
 * forgotten when set to `empty` (compared with `===`), and shared by every
 * mounted reader of the key.
 */
export function useCommentDraft<T>(key: string, empty: T): [T, (value: T) => void] {
  const read = () => (kept.has(key) ? (kept.get(key) as T) : empty);
  const current = useSyncExternalStore(subscribe, read, read);

  const set = useCallback(
    (value: T) => {
      if (value === empty) kept.delete(key);
      else kept.set(key, value);
      notify();
    },
    [key, empty],
  );
  return [current, set];
}

/** Forget every draft (tests). */
export function forgetCommentDrafts(): void {
  kept.clear();
  notify();
}
