/**
 * Live-Docs Responder Hook (WI-9)
 *
 * Purpose: answer another window's `live-docs:request` with this window's
 * live image-reference keys. Mounted once per document window (via
 * useWindowLifecycle) — a window that does not answer makes the requester's
 * collection INCOMPLETE, and the requester then deletes nothing.
 *
 * @coordinates-with services/media/crossWindowRefs.ts — key extraction
 * @coordinates-with src-tauri/src/live_docs.rs — request/response relay
 * @module hooks/useLiveDocsResponder
 */

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { localLiveRefKeys } from "@/services/media/crossWindowRefs";
import { safeUnlisten } from "@/utils/safeUnlisten";
import { orphanCleanupError, appError } from "@/utils/debug";
import { voidAsync } from "@/utils/voidAsync";

export function useLiveDocsResponder(): void {
  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const webview = getCurrentWebviewWindow();

    webview
      .listen<string>("live-docs:request", voidAsync(async (event) => {
        try {
          // The label identifies WHICH window answered: Rust counts answers
          // by distinct expected label, so a duplicate listener (Strict Mode)
          // or a stray echo can never stand in for a window that stayed
          // silent — completeness would otherwise lie.
          await invoke("live_docs_response", {
            requestId: event.payload,
            label: webview.label,
            refs: localLiveRefKeys(),
          });
        } catch (error) {
          // Not answering makes the requester fail closed — log why.
          orphanCleanupError(" live-docs response failed:", error);
        }
      }, (err) => appError("Live-docs request handler failed:", err)))
      .then((unlisten) => {
        if (disposed) safeUnlisten(unlisten);
        else unlisteners.push(unlisten);
      })
      .catch((error) => {
        orphanCleanupError(" live-docs responder setup failed:", error);
      });

    return () => {
      disposed = true;
      unlisteners.forEach(safeUnlisten);
    };
  }, []);
}
