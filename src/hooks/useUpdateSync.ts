/**
 * Update Sync Hook
 *
 * Purpose: Synchronizes update state across windows — every mounting window
 *   broadcasts local store changes and listens for remote changes from peers.
 *
 * Pipeline: useUpdateBroadcast watches the local store; any change is emitted
 *   to all other windows as a full snapshot. useUpdateListener applies remote
 *   snapshots to the local store, recording the applied snapshot so the very
 *   next broadcast pass recognises "I already saw this from a peer" and skips
 *   the echo.
 *
 * Key decisions:
 *   - Symmetric: both Main and Settings mount Broadcast AND Listener, because
 *     either window can originate a check/download.
 *   - Echo-suppression via module-level `lastAppliedSnapshot`: when the
 *     listener applies a remote payload, it stores the JSON of that payload
 *     in a window-scoped module ref. useUpdateBroadcast's effect compares
 *     the next observed state to this ref; if they match, no emit. This
 *     breaks the cross-window A↔B feedback loop that previously hit the
 *     store thousands of times per second whenever two windows held
 *     contradictory pending states (manual check in Settings while Main
 *     was at error from its own startup auto-check, etc).
 *   - The previous `prevState` per-hook ref couldn't break the loop because
 *     each window genuinely transitioned through the broadcast states; the
 *     JSON-diff said "yes this is new, emit" on every hop.
 *
 * @coordinates-with useUpdateOperations.ts — triggers state changes
 * @coordinates-with updateStore.ts — reads/writes update state
 * @module hooks/useUpdateSync
 */

import { useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { useMcpStore, type UpdateStatus, type UpdateInfo, type DownloadProgress } from "@/stores/mcpStore";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";
import { updateSyncWarn } from "@/utils/debug";

const UPDATE_STATE_EVENT = "update:state-changed";
const REQUEST_STATE_EVENT = "update:request-state";

interface UpdateStatePayload {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  downloadProgress: DownloadProgress | null;
  error: string | null;
}

// Window-scoped: the JSON of the last snapshot this window applied from a
// remote broadcast. When the broadcaster sees its observed state already
// matches this snapshot, it suppresses the outgoing emit — that state came
// from a peer and re-emitting it would echo back into an infinite loop.
// Reset to null after any local-origin emit so subsequent local changes
// still propagate.
let lastAppliedSnapshot: string | null = null;

function snapshotJson(state: UpdateStatePayload): string {
  return JSON.stringify(state);
}

/**
 * Broadcasts update state changes to other windows.
 * Skips emits that originated from an incoming remote snapshot.
 */
export function useUpdateBroadcast() {
  const status = useMcpStore((state) => state.update.status);
  const updateInfo = useMcpStore((state) => state.update.updateInfo);
  const downloadProgress = useMcpStore((state) => state.update.downloadProgress);
  const error = useMcpStore((state) => state.update.error);

  const prevState = useRef<UpdateStatePayload | null>(null);

  useEffect(() => {
    const currentState: UpdateStatePayload = {
      status,
      updateInfo,
      downloadProgress,
      error,
    };

    const currentJson = snapshotJson(currentState);

    // Skip emit if this state was just applied from a remote broadcast —
    // re-broadcasting it would echo into the peer that sent it and create
    // the cross-window A↔B feedback loop documented in Key decisions.
    if (lastAppliedSnapshot !== null && lastAppliedSnapshot === currentJson) {
      lastAppliedSnapshot = null;
      prevState.current = currentState;
      return;
    }

    // No-op de-dup: state hasn't actually changed since the last emit
    // (e.g., a setX call with the same value).
    const prevJson = prevState.current ? snapshotJson(prevState.current) : null;
    if (prevJson === currentJson) return;

    prevState.current = currentState;
    lastAppliedSnapshot = null;
    emit(UPDATE_STATE_EVENT, currentState).catch((e) => { updateSyncWarn("emit failed:", e); });
  }, [status, updateInfo, downloadProgress, error]);
}

/**
 * Listens for update state changes from other windows and applies them
 * to the local store. Marks the applied snapshot so useUpdateBroadcast's
 * next pass knows not to echo this change back.
 */
export function useUpdateListener() {
  const hasRequestedState = useRef(false);

  // Listen for state broadcasts
  useEffect(() => {
    const unlistenPromise = listen<UpdateStatePayload>(UPDATE_STATE_EVENT, (event) => {
      const { status, updateInfo, downloadProgress, error } = event.payload;

      // Record what we're about to apply. The broadcast effect runs after
      // React renders the resulting state change; it will see lastAppliedSnapshot
      // matches the observed state and skip re-emitting. React 18 auto-batches
      // the three setX calls below into a single render, so the broadcast
      // effect runs exactly once.
      lastAppliedSnapshot = snapshotJson({ status, updateInfo, downloadProgress, error });

      const { setUpdateStatus: setStatus, setUpdateInfo, setDownloadProgress, setUpdateError: setError } = useMcpStore.getState();

      // Order matters: set info/progress first, then status (which may clear error)
      setUpdateInfo(updateInfo);
      setDownloadProgress(downloadProgress);

      if (error) {
        setError(error);
      } else {
        setStatus(status);
      }
    });

    return () => {
      safeUnlistenAsync(unlistenPromise);
    };
  }, []);

  // Request initial state from main window on mount
  useEffect(() => {
    if (hasRequestedState.current) return;
    hasRequestedState.current = true;

    // Small delay to ensure listeners are set up
    const timer = setTimeout(() => {
      emit(REQUEST_STATE_EVENT).catch((e) => { updateSyncWarn("request state failed:", e); });
    }, 100);

    return () => clearTimeout(timer);
  }, []);
}

// Test-only: reset the module-level echo-suppression state between cases.
export function __resetUpdateSyncStateForTests() {
  lastAppliedSnapshot = null;
}
