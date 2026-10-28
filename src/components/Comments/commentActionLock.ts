/**
 * Comment action lock — one comment action at a time per document, held
 * outside any component so it survives the history popover closing and
 * reopening while an action is still under way.
 *
 * Key decisions:
 *   - Module scope, not component state: a panel reopened while the closed
 *     panel's action runs mounts busy, refuses a second action, and enables
 *     its controls when the first action releases the lock.
 *   - Keyed by document: actions on different documents do not wait for
 *     each other. Sending a new comment locks its draft's own key instead
 *     (never a document key), so it excludes only a second send of itself.
 *   - Read through `useSyncExternalStore`, so every mounted panel for the
 *     document re-renders on take and release.
 *
 * @coordinates-with components/Comments/useCommentActions.ts — takes and releases it
 * @coordinates-with components/Comments/AddComment.tsx — locks the draft it sends
 * @module components/Comments/commentActionLock
 */

import { useSyncExternalStore } from "react";

const held = new Set<string>();
const subscribers = new Set<() => void>();

const notify = () => {
  for (const onChange of [...subscribers]) onChange();
};

/** Take the lock for `docKey`; false when an action on it is already under way. */
export function takeCommentAction(docKey: string): boolean {
  if (held.has(docKey)) return false;
  held.add(docKey);
  notify();
  return true;
}

/** Release the lock for `docKey`. */
export function releaseCommentAction(docKey: string): void {
  if (held.delete(docKey)) notify();
}

/** Whether an action on `docKey` is under way. */
export function isCommentActionLocked(docKey: string): boolean {
  return held.has(docKey);
}

/** Called on every take and release; returns the unsubscribe. */
export function subscribeCommentActionLock(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

/** React adapter: whether an action on `docKey` is under way, re-rendering when that changes. */
export function useCommentActionLock(docKey: string): boolean {
  const locked = () => held.has(docKey);
  return useSyncExternalStore(subscribeCommentActionLock, locked, locked);
}
