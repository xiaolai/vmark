/**
 * browserMenuSync — keep the native "New Browser Tab" menu item in step with the
 * browser setting AND the platform (WI-S0.5, audit X-04).
 *
 * Purpose: the item exists natively so its accelerator survives the browser taking
 * keyboard focus; it starts disabled because the feature is off by default, and a
 * permanently-dead menu item is worse than no item. Off macOS the surface is a stub,
 * so the item stays disabled there whatever the setting says.
 *
 * Pushes go through the serialized, latest-wins pusher: two rapid toggles used to be
 * fired concurrently and the older could land last, leaving the native item out of
 * step with the setting; a failure is retried (with backoff, until the window
 * disposes the sync) rather than dropped, and every failed attempt is logged.
 *
 * @coordinates-with hooks/useCommandBootstrap — starts and stops this with the window
 * (lives in services/, the store-aware tier: it is a wiring, not a React adapter)
 * @coordinates-with services/commands/browserCommands — `browserAvailableHere`
 * @module services/browser/browserMenuSync
 */
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { browserAvailableHere } from "@/services/commands/browserCommands";
import { makeSerializedPusher } from "./serializedPusher";
import { browserWarn } from "@/utils/debug";

/** Start syncing; returns a disposer. */
export function startBrowserMenuSync(): () => void {
  const pusher = makeSerializedPusher<boolean>(
    (enabled) => invoke("set_browser_menu_enabled", { enabled }),
    (error, attempt) => {
      // The menu may not exist yet (early boot) or on a platform branch without the
      // item; the pusher retries with backoff until the window disposes it. Every
      // failed attempt is LOGGED (round 3, #212): a retry loop nobody can see is a
      // silent failure, and giving up would leave the item wrong for the session.
      browserWarn(`browser menu sync failed (attempt ${attempt}); retrying`, error);
    },
  );
  pusher.push(browserAvailableHere());
  const unsubscribe = useSettingsStore.subscribe((state, prev) => {
    if (state.browser.enabled !== prev.browser.enabled) pusher.push(browserAvailableHere());
  });
  return () => {
    unsubscribe();
    pusher.dispose();
  };
}
