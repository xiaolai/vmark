/**
 * useQuitFeedback — React hook that shows the press-again-to-quit hint for a
 * short time after the first quit keypress.
 *
 * @module components/StatusBar/useQuitFeedback
 */

import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";

/** Duration to show the quit feedback message (matches Rust CONFIRM_QUIT_WINDOW). */
const FEEDBACK_DURATION_MS = 2000;

/**
 * Listens for `app:quit-first-press` on the current window and manages
 * a transient boolean for showing "Press Cmd+Q again to quit".
 *
 * StatusBar stays mounted while the hint shows, even when hidden (#1528): the
 * first press only arms the confirm-quit gate, so without the hint quit looks dead.
 *
 * Uses window-scoped listening (consistent with useWindowClose).
 */
export function useQuitFeedback(): boolean {
  const [visible, setVisible] = useState(false);

  // Listen for the first-press event from Rust
  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();
    const unlisten = currentWindow.listen("app:quit-first-press", () => {
      setVisible(true);
    });
    return () => { safeUnlistenAsync(unlisten); };
  }, []);

  // Auto-hide after timeout
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), FEEDBACK_DURATION_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  return visible;
}
