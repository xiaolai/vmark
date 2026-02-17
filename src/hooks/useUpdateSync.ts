/**
 * Update Sync Hook
 *
 * Purpose: Synchronizes update state across windows — main window broadcasts
 *   status/progress changes via Tauri events, other windows listen and
 *   update their local updateStore to stay consistent.
 *
 * Key decisions:
 *   - Two hooks: useUpdateStateBroadcaster (main window) and useUpdateStateListener (others)
 *   - Listener also handles request-state event for late-joining windows
 *   - Payload includes full state snapshot (status, info, progress, error)
 *
 * @coordinates-with useUpdateOperations.ts — triggers state changes
 * @coordinates-with updateStore.ts — reads/writes update state
 * @module hooks/useUpdateSync
 */

import { useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { useUpdateStore, type UpdateStatus, type UpdateInfo, type DownloadProgress } from "@/stores/updateStore";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";

const UPDATE_STATE_EVENT = "update:state-changed";
const REQUEST_STATE_EVENT = "update:request-state";

interface UpdateStatePayload {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  downloadProgress: DownloadProgress | null;
  error: string | null;
}

/**
 * Broadcasts update state changes to other windows.
 * Should be used in the main window only.
 */
export function useUpdateBroadcast() {
  const status = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.updateInfo);
  const downloadProgress = useUpdateStore((state) => state.downloadProgress);
  const error = useUpdateStore((state) => state.error);

  const prevState = useRef<UpdateStatePayload | null>(null);

  useEffect(() => {
    const currentState: UpdateStatePayload = {
      status,
      updateInfo,
      downloadProgress,
      error,
    };

    // Only broadcast if state actually changed
    const prevJson = prevState.current ? JSON.stringify(prevState.current) : null;
    const currentJson = JSON.stringify(currentState);

    if (prevJson !== currentJson) {
      prevState.current = currentState;
      emit(UPDATE_STATE_EVENT, currentState);
    }
  }, [status, updateInfo, downloadProgress, error]);
}

/**
 * Listens for update state changes from other windows.
 * Also requests initial state on mount.
 * Should be used in non-main windows (e.g., Settings).
 */
export function useUpdateListener() {
  const hasRequestedState = useRef(false);

  // Listen for state broadcasts
  useEffect(() => {
    const unlistenPromise = listen<UpdateStatePayload>(UPDATE_STATE_EVENT, (event) => {
      const { status, updateInfo, downloadProgress, error } = event.payload;
      const { setStatus, setUpdateInfo, setDownloadProgress, setError } = useUpdateStore.getState();

      // Update store with received state
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
      emit(REQUEST_STATE_EVENT);
    }, 100);

    return () => clearTimeout(timer);
  }, []);
}
