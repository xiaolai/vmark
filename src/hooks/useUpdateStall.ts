/**
 * Update stall detection.
 *
 * Purpose: report whether the update flow has stopped making observable
 *   progress, so the StatusBar indicator can offer a way out of a state that
 *   is otherwise permanent.
 *
 * Key decisions:
 *   - Detected per window and held in local refs, NOT in the store. The
 *     cross-window snapshot in `useUpdateSync` is compared by JSON for echo
 *     suppression; a timestamp changes on every tick, so putting one in the
 *     broadcast payload would defeat that suppression and reintroduce the
 *     A↔B feedback loop documented there.
 *   - Only `checking`, `downloading` and `installing` can stall. Every other
 *     state is either terminal or already clickable.
 *   - "Progress" means any observable change — status OR download progress.
 *     A healthy download writes progress regularly (throttled by
 *     `shouldWriteProgress`), so a live transfer keeps resetting the clock.
 *
 * Thresholds are deliberately generous, because a false positive offers the
 * user a reset button during a slow-but-working download. `installing` shares
 * the transfer threshold: it emits no progress events at all, so it can sit
 * quiet for a while legitimately.
 *
 * @coordinates-with useUpdateOperations.ts — recoverFromStall is the action
 * @coordinates-with UpdateIndicator.tsx — renders the escape hatch
 * @module hooks/useUpdateStall
 */

import { useEffect, useRef, useState } from "react";
import { useMcpStore, type UpdateStatus, type DownloadProgress } from "@/stores/mcpStore";

/** A bounded `check()` should settle well inside this; it carries a 30s timeout. */
export const CHECK_STALL_MS = 60_000;

/** Download and install are unbounded by design — give them real room. */
export const TRANSFER_STALL_MS = 180_000;

/** How often to re-evaluate. Coarse: this drives a tooltip, not an animation. */
const TICK_MS = 5_000;

const STALLABLE: readonly UpdateStatus[] = ["checking", "downloading", "installing"];

/** Threshold for a status, or null when that status cannot stall. */
export function stallThresholdFor(status: UpdateStatus): number | null {
  if (status === "checking") return CHECK_STALL_MS;
  if (status === "downloading" || status === "installing") return TRANSFER_STALL_MS;
  return null;
}

/** Serialise the observable progress signal for change detection. */
function progressKey(status: UpdateStatus, progress: DownloadProgress | null): string {
  return `${status}:${progress?.downloaded ?? -1}:${progress?.total ?? -1}`;
}

/**
 * True when the update flow has sat in a stallable state without any
 * observable change for longer than its threshold.
 */
export function useUpdateStall(): boolean {
  const status = useMcpStore((state) => state.update.status);
  const downloadProgress = useMcpStore((state) => state.update.downloadProgress);

  const [stalled, setStalled] = useState(false);
  // Null until the first effect runs. `Date.now()` is impure, so it cannot be
  // called during render — including as a `useRef` initialiser, which runs on
  // every render even though only the first value is kept.
  const changedAtRef = useRef<number | null>(null);
  const lastKeyRef = useRef<string | null>(null);

  // Pure during render; the effect below reacts to it changing.
  const key = progressKey(status, downloadProgress);

  // Restart the clock whenever anything observable moves. Touches refs only —
  // no setState here, so an observed change cannot cascade a render.
  useEffect(() => {
    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key;
      changedAtRef.current = Date.now();
    }
  }, [key]);

  useEffect(() => {
    const threshold = stallThresholdFor(status);
    if (threshold === null) return;

    // Evaluated only on the interval, never synchronously on mount: a
    // synchronous setState in an effect cascades renders, and with thresholds
    // measured in minutes a first verdict one tick late costs nothing.
    const timer = setInterval(() => {
      const since = changedAtRef.current;
      setStalled(since !== null && Date.now() - since >= threshold);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [status, key]);

  // Derived, not stored: leaving a stallable state clears the verdict
  // immediately rather than waiting for the next tick to correct it.
  return stalled && STALLABLE.includes(status);
}
