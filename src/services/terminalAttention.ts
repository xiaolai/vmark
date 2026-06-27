/**
 * Terminal attention notifications.
 *
 * Purpose: post an OS notification (iTerm-style) when a terminal in an
 *   *unfocused* VMark window rings the bell — Claude Code and most TUIs ring
 *   the bell when a turn finishes / input is needed, so this is the
 *   "this window wants you" signal across multiple windows. Reuses the
 *   existing `onBell` hook in useTerminalSessions.
 *
 * Permission is requested lazily on the first eligible bell (a single shared
 * in-flight request, so simultaneous bells don't double-prompt). Only an
 * explicit denial is cached; a dismissed ("default") prompt is retried later.
 * Notifications are per-window throttled so a chatty terminal can't spam.
 *
 * @coordinates-with components/Terminal/useTerminalSessions.ts — called from onBell
 * @coordinates-with stores/settingsStore.ts — gated by `terminal.notifyOnBell` + `bellMode`
 * @module services/terminalAttention
 */
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import i18n from "@/i18n";
import { useSettingsStore, type TerminalBellMode } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";

/** Min gap between notifications for the same window, so a chatty terminal can't spam. */
const NOTIFY_THROTTLE_MS = 5000;

/**
 * Should a bell raise an OS notification? Pure so it can be unit-tested without
 * the plugin. Notify only when the feature is on, the bell isn't muted
 * (`bellMode === "off"` means "ignore the bell" — including notifications), AND
 * this window isn't focused (if you're looking at VMark the in-window
 * beep/activity flag already covers it and a toast would be noise).
 */
export function shouldNotifyOnBell(
  enabled: boolean,
  windowFocused: boolean,
  bellMode: TerminalBellMode,
): boolean {
  return enabled && bellMode !== "off" && !windowFocused;
}

type PermissionState = "unknown" | "granted" | "denied";
let permissionState: PermissionState = "unknown";
let permissionInFlight: Promise<boolean> | null = null;
const lastNotifiedAt = new Map<string, number>();

/** Reset cached permission + throttle — test-only seam. */
export function _resetNotificationState(): void {
  permissionState = "unknown";
  permissionInFlight = null;
  lastNotifiedAt.clear();
}

/**
 * Resolve notification permission, requesting once if needed. A single shared
 * promise dedupes concurrent callers. Only an explicit "denied" is cached
 * (so it never re-prompts); a dismissed "default" stays unknown and is retried.
 */
async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionState === "granted") return true;
  if (permissionState === "denied") return false;
  if (permissionInFlight) return permissionInFlight;
  permissionInFlight = (async () => {
    try {
      if (await isPermissionGranted()) {
        permissionState = "granted";
        return true;
      }
      const result = await requestPermission();
      if (result === "granted") permissionState = "granted";
      else if (result === "denied") permissionState = "denied"; // "default" stays unknown → retry later
      return result === "granted";
    } finally {
      permissionInFlight = null;
    }
  })();
  return permissionInFlight;
}

/**
 * Post the "needs attention" notification, naming the window (`label`, e.g. the
 * active document) so the user knows which one to switch to. Per-window
 * throttled and best-effort — swallows all errors so it can never throw into
 * the terminal data path.
 */
export async function notifyTerminalAttention(label: string): Promise<void> {
  try {
    const now = Date.now();
    if (now - (lastNotifiedAt.get(label) ?? 0) < NOTIFY_THROTTLE_MS) return;
    lastNotifiedAt.set(label, now);
    if (!(await ensureNotificationPermission())) return;
    sendNotification({
      title: "VMark",
      body: i18n.t("statusbar:terminal.notify.attention", { name: label }),
    });
  } catch {
    /* notifications are best-effort — never disrupt the terminal */
  }
}

/**
 * Bell-handler entry point: if notifications are enabled, the bell isn't muted,
 * and this window is unfocused, post a notification naming the window's active
 * document. Thin glue over the tested `shouldNotifyOnBell` +
 * `notifyTerminalAttention`.
 */
/**
 * Flag this window as "needs attention" in the cross-window registry (#1057)
 * when a terminal rings the bell while the window is unfocused. Independent of
 * the OS-notification setting — the Window-Status panel should reflect the bell
 * even if notifications are disabled. The flag is cleared when the window gains
 * focus (see useWindowStatus). Best-effort; never throws into the bell path.
 */
export function flagWindowAttentionOnBell(): void {
  if (document.hasFocus()) return;
  void invoke("set_window_attention").catch(() => {
    /* registry is best-effort */
  });
}

export function maybeNotifyTerminalBell(): void {
  const terminal = useSettingsStore.getState().terminal;
  const enabled = terminal?.notifyOnBell ?? true;
  const bellMode = terminal?.bellMode ?? "visual";
  if (!shouldNotifyOnBell(enabled, document.hasFocus(), bellMode)) return;
  const docName =
    useTabStore.getState().getActiveTab(getCurrentWindowLabel())?.title ||
    i18n.t("statusbar:terminal.ariaLabel");
  void notifyTerminalAttention(docName);
}
