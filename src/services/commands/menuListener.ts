/**
 * menuListener — generic menu-event → CommandBus dispatcher (ADR-012).
 *
 * Replaces the per-feature `currentWindow.listen("menu:foo", handlerFoo)`
 * pattern with: register commands at startup, then mount one listener per
 * menu id that dispatches via `executeCommand`.
 *
 * Each hook that used to host inline handlers now just supplies a static
 * `menuId → commandId` map. Reentry guards, window-payload checks, and
 * window-scoped context move into the command run() bodies.
 *
 * @module services/commands/menuListener
 */

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlistenAll } from "@/utils/safeUnlisten";
import { executeCommand } from "./CommandBus";
import { menuError } from "@/utils/debug";

export interface MenuCommandBinding {
  /** The Tauri menu event id, with or without the "menu:" prefix. */
  menuEvent: string;
  /** CommandBus id to dispatch when the event fires. */
  commandId: string;
}

/**
 * Mount listeners for a set of menu→command bindings on the current
 * window. Returns an unlisten function. Window-payload mismatch is
 * filtered automatically (events targeted at other windows are ignored).
 */
export async function mountMenuCommands(
  bindings: MenuCommandBinding[],
): Promise<UnlistenFn> {
  const currentWindow = getCurrentWebviewWindow();
  const windowLabel = currentWindow.label;
  const unlisteners: UnlistenFn[] = [];

  for (const binding of bindings) {
    const event = binding.menuEvent.startsWith("menu:")
      ? binding.menuEvent
      : `menu:${binding.menuEvent}`;
    try {
      const off = await currentWindow.listen<string | [unknown, string]>(event, async (e) => {
        // Window-targeting filter — supports both string payload
        // (single value === windowLabel) and tuple payload (second
        // element is the target window label). Anything else is
        // an unknown payload shape; refuse to dispatch.
        const payload = e.payload;
        if (typeof payload === "string") {
          if (payload !== windowLabel) return;
        } else if (Array.isArray(payload)) {
          if (payload[1] !== windowLabel) return;
        } else {
          menuError(
            `Refusing to dispatch ${binding.commandId}: unexpected payload shape`,
            payload,
          );
          return;
        }
        try {
          await executeCommand(binding.commandId, payload, { windowLabel });
        } catch (err) {
          menuError(`Command ${binding.commandId} threw:`, err);
        }
      });
      unlisteners.push(off);
    } catch (err) {
      menuError(`Failed to mount listener for ${event}:`, err);
    }
  }

  return () => {
    safeUnlistenAll(unlisteners);
  };
}
