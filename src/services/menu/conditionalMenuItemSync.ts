/**
 * conditionalMenuItemSync — keep every native menu item whose feature ships off
 * in step with the setting that decides it (#1425; generalized from WI-S0.5's
 * browser-only sync).
 *
 * Purpose: these items exist NATIVELY, not as DOM shortcuts, because once a
 * `WKWebView` is first responder it consumes key events while AppKit dispatches
 * menu accelerators regardless of focus. They are HIDDEN rather than greyed when
 * their feature is off: a permanently-dead menu item is worse than no item, and
 * both of today's entries were reported as bugs in that state — "New Browser
 * Tab" first, then Knowledge Base (#1425, filed as a Linux packaging fault when
 * in fact no packaged build carries the content server at all).
 *
 * The predicate per item is the SAME one the palette command's `when` uses, so
 * the menu bar and the palette can never disagree about whether a feature is
 * reachable.
 *
 * Key decisions:
 *   - **Recompute on any settings change, push only on a difference.** Watching
 *     named keys means a predicate that grows a second input silently stops
 *     being watched; recomputing is cheap and cannot go stale. The last pushed
 *     value is remembered so a keystroke in an unrelated settings field does not
 *     put an IPC call on the main thread for an item that is not moving.
 *   - **Serialized, latest-wins, retried.** Two rapid toggles used to be fired
 *     concurrently and the older could land last, leaving the native item out of
 *     step with the setting. A failure is retried with backoff (until the window
 *     disposes the sync) rather than dropped, and every failed attempt is logged
 *     — a retry loop nobody can see is a silent failure.
 *   - The item ids are Rust's (`menu::conditional_items::CONDITIONAL_ITEMS`);
 *     nothing joins the two languages at compile time, so a test does.
 *
 * `serializedPusher` lives under `services/browser/` because that is where it was
 * first needed; it is a general mechanism (grants, AI policy, browser bounds) and
 * is imported here as one.
 *
 * @coordinates-with src-tauri/src/menu/conditional_items.rs — the item table and the command
 * @coordinates-with services/commands/browserCommands — `browserAvailableHere`
 * @coordinates-with services/contentServer/availability — `knowledgeBaseAvailableHere`
 * @module services/menu/conditionalMenuItemSync
 */
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { browserAvailableHere } from "@/services/commands/browserCommands";
import { knowledgeBaseAvailableHere } from "@/services/contentServer/availability";
import { makeSerializedPusher } from "@/services/browser/serializedPusher";
import { menuWarn } from "@/utils/debug";

/** A native menu item that is present only while its feature is reachable. */
export interface ConditionalMenuItem {
  /** The menu id — must match an entry in Rust's `CONDITIONAL_ITEMS`. */
  readonly itemId: string;
  /** Should the item be in the menu bar right now? */
  readonly visible: () => boolean;
}

export const CONDITIONAL_MENU_ITEMS: readonly ConditionalMenuItem[] = [
  // The embedded browser: off-platform or off by setting (WI-S0.5, audit X-04).
  { itemId: "new-browser-tab", visible: browserAvailableHere },
  // The Knowledge Base: Developer Mode only, because no packaged build carries
  // the content server runtime (#1425).
  { itemId: "knowledge-base", visible: knowledgeBaseAvailableHere },
];

/** Start syncing every conditional item; returns a disposer. */
export function startConditionalMenuItemSync(): () => void {
  const syncs = CONDITIONAL_MENU_ITEMS.map((item) => {
    const pusher = makeSerializedPusher<boolean>(
      (visible) => invoke("set_menu_item_visible", { itemId: item.itemId, visible }),
      (error, attempt) => {
        // The menu may not exist yet (early boot), or a platform branch may not
        // build the item; the pusher retries with backoff until the window
        // disposes it. Giving up would leave the item wrong for the session.
        menuWarn(`menu item "${item.itemId}" sync failed (attempt ${attempt}); retrying`, error);
      },
    );
    let pushed: boolean | null = null;
    const push = () => {
      const visible = item.visible();
      if (visible === pushed) return;
      pushed = visible;
      pusher.push(visible);
    };
    push();
    return { push, dispose: () => pusher.dispose() };
  });

  const unsubscribe = useSettingsStore.subscribe(() => {
    for (const sync of syncs) sync.push();
  });

  return () => {
    unsubscribe();
    for (const sync of syncs) sync.dispose();
  };
}
