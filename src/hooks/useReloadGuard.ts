/**
 * Reload Guard Hook
 *
 * Purpose: Prevents page reload in the webview. Reload is not a valid
 *   desktop app action — it destroys all in-memory state (undo history,
 *   editor instances, store data) even when no documents are dirty.
 *
 * Behavior:
 *   - Production: blocks reload triggers (Cmd+R, Ctrl+R, Ctrl+Shift+R,
 *     beforeunload, and the native webview context menu) UNLESS the
 *     integrated terminal is focused — in which case Ctrl+R passes
 *     through to the shell for reverse-i-search.
 *   - Dev: only warns via beforeunload when documents are dirty,
 *     so developers can still use Cmd+R to refresh during development.
 *
 * Note: F5 is NOT blocked — it is used as the Source Peek shortcut.
 * Tauri's webview does not reload on bare F5 (unlike browsers).
 *
 * @coordinates-with reloadGuard.ts — pure logic for shouldBlockReload (dev mode)
 * @module hooks/useReloadGuard
 */

import { useEffect } from "react";
import { useDocumentStore } from "@/stores/documentStore";
import { shouldBlockReload, getReloadWarningMessage, isReloadShortcut, isTerminalFocused, isCtrlR } from "@/utils/reloadGuard";

/**
 * Production guard: block reload triggers.
 *
 * Blocks keyboard shortcuts (Cmd+R, Ctrl+R), beforeunload, and the
 * native webview context menu (which includes a "Reload" option on macOS).
 * Exception: Ctrl+R passes through when the terminal is focused (shell
 * reverse-i-search). Cmd+R is always blocked.
 */
function useProductionReloadGuard(): void {
  useEffect(() => {
    const blockKeyboard = (e: KeyboardEvent) => {
      // Allow Ctrl+R through to the terminal for shell reverse-i-search,
      // but always block Cmd+R (macOS reload shortcut).
      if (isReloadShortcut(e) && !(isTerminalFocused() && isCtrlR(e))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const blockBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    // Block the native webview context menu (contains "Reload" on macOS).
    // Custom context menus (editor, table, image, tabs, file explorer,
    // terminal) claim their events with preventDefault()/stopPropagation()
    // before this global fallback, so it won't interfere with them.
    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Capture phase to intercept before anything else handles it
    window.addEventListener("keydown", blockKeyboard, true);
    window.addEventListener("beforeunload", blockBeforeUnload);
    window.addEventListener("contextmenu", blockContextMenu);

    return () => {
      window.removeEventListener("keydown", blockKeyboard, true);
      window.removeEventListener("beforeunload", blockBeforeUnload);
      window.removeEventListener("contextmenu", blockContextMenu);
    };
  }, []);
}

/**
 * Dev guard: only warn when documents are dirty (preserves Cmd+R for refresh).
 */
function useDevReloadGuard(): void {
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): string | undefined => {
      const dirtyTabIds = useDocumentStore.getState().getAllDirtyDocuments();
      const result = shouldBlockReload({ dirtyTabIds });

      if (result.shouldBlock) {
        event.preventDefault();
        event.returnValue = "";
        return getReloadWarningMessage(result.count);
      }

      return undefined;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);
}

/**
 * Hook to prevent page reload in the webview.
 *
 * Production: blocks all reload triggers (keyboard shortcuts + beforeunload).
 * Dev: warns only when documents have unsaved changes.
 */
export function useReloadGuard(): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useDevReloadGuard();
  } else {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useProductionReloadGuard();
  }
}
