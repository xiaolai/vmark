/**
 * useOpenFileEvent — listens for the custom OPEN_FILE_EVENT (file explorer, wiki
 * links, markdown links) and opens the file in this window.
 *
 * Split out of useFileShortcuts when its keyboard + menu:{id} responsibilities
 * migrated to the keybinding registry / menu dispatcher (Phase 3). This is NOT a
 * shortcut or a menu event — it carries an object payload `{ windowLabel, path }`
 * and Tauri's `window.emit()` BROADCASTS to every window (#1112), so the payload's
 * `windowLabel` is the only scoping.
 *
 * @coordinates-with services/navigation/fileOpen.ts — handleOpenFile
 * @coordinates-with services/navigation/openFragment.ts — `#anchor` after the open
 * @module hooks/useOpenFileEvent
 */

import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useWindowLabel } from "@/contexts/WindowContext";
import { handleOpenFile } from "@/services/navigation/fileOpen";
import { OPEN_FILE_EVENT, type OpenFileEventPayload } from "@/services/navigation/openFileEvent";
import { navigateToFragmentWhenReady } from "@/services/navigation/openFragment";
import { fileOpsError, finderFileOpenError } from "@/utils/debug";
import { voidAsync } from "@/utils/voidAsync";

export function useOpenFileEvent(): void {
  const windowLabel = useWindowLabel();

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    void getCurrentWebviewWindow()
      .listen<OpenFileEventPayload>(OPEN_FILE_EVENT, voidAsync(async (event) => {
        if (event.payload.windowLabel !== windowLabel) return;
        await handleOpenFile(windowLabel, event.payload.path);
        // The file is open; the editor may not have mounted it yet. This
        // returns immediately and lands on the heading when it has.
        if (event.payload.fragment) {
          navigateToFragmentWhenReady(windowLabel, event.payload.fragment);
        }
      }, (err) => finderFileOpenError("Open-file event handler failed:", err)))
      .then((off) => {
        if (cancelled) off();
        else unlisten = off;
      })
      .catch((err) => fileOpsError("Failed to listen for open-file:", err));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [windowLabel]);
}
