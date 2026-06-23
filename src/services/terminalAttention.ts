/**
 * Terminal attention notifications.
 *
 * Purpose: post an OS notification (iTerm-style) when a terminal in an
 *   *unfocused* VMark window rings the bell — Claude Code and most TUIs ring
 *   the bell when a turn finishes / input is needed, so this is the
 *   "this window wants you" signal across multiple windows. Reuses the
 *   existing `onBell` hook in useTerminalSessions.
 *
 * Permission is requested lazily on the first eligible bell and the result is
 * cached, so a denied prompt is never re-asked and the data path never blocks.
 *
 * @coordinates-with components/Terminal/useTerminalSessions.ts — called from onBell
 * @coordinates-with stores/settingsStore.ts — gated by `terminal.notifyOnBell`
 * @module services/terminalAttention
 */
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import i18n from "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";

/**
 * Should a bell raise an OS notification? Pure so it can be unit-tested without
 * the plugin. Notify only when the feature is on AND this window isn't focused
 * — if you're looking at VMark, the in-window beep/activity flag already
 * covers it, and a toast would be noise.
 */
export function shouldNotifyOnBell(enabled: boolean, windowFocused: boolean): boolean {
  return enabled && !windowFocused;
}

type PermissionState = "unknown" | "granted" | "denied";
let permissionState: PermissionState = "unknown";

/** Reset cached permission — test-only seam. */
export function _resetNotificationPermissionCache(): void {
  permissionState = "unknown";
}

/**
 * Post the "needs attention" notification, naming the window (`label`, e.g. the
 * active document) so the user knows which one to switch to. Best-effort:
 * swallows all errors so it can never throw into the terminal data path.
 */
/**
 * Bell-handler entry point: if notifications are enabled and this window is
 * unfocused, post a notification naming the window's active document. Thin
 * glue over the tested `shouldNotifyOnBell` + `notifyTerminalAttention`.
 */
export function maybeNotifyTerminalBell(): void {
  const enabled = useSettingsStore.getState().terminal?.notifyOnBell ?? true;
  if (!shouldNotifyOnBell(enabled, document.hasFocus())) return;
  const docName = useTabStore.getState().getActiveTab(getCurrentWindowLabel())?.title;
  void notifyTerminalAttention(docName || "Terminal");
}

export async function notifyTerminalAttention(label: string): Promise<void> {
  try {
    if (permissionState === "denied") return;
    let granted = permissionState === "granted" || (await isPermissionGranted());
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    permissionState = granted ? "granted" : "denied";
    if (!granted) return;
    sendNotification({
      title: "VMark",
      body: i18n.t("statusbar:terminal.notify.attention", { name: label }),
    });
  } catch {
    /* notifications are best-effort — never disrupt the terminal */
  }
}
