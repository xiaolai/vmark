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
import { shouldBlockMenuAction } from "@/utils/focusGuard";
import { runEditorAction } from "@/services/editor/runEditorAction";
import { disposeEditorActionOwner } from "@/services/editor/editorActionOwner";
import type { MenuActionMapping } from "@/plugins/actions/types";
import { voidAsync } from "@/utils/voidAsync";

/**
 * Dispatch one menu-action mapping through the shared editor executor. This is the
 * exact line the menu listener runs once a menu event passes the window filter +
 * focus gate; it is exported so the bus↔menu differential gate exercises the REAL
 * menu dispatch, not a re-derivation of it. Kept in its own module (separate from
 * `runEditorAction`) so a test can mock `runEditorAction` and still call the real
 * `dispatchMenuAction`.
 */
export function dispatchMenuAction(mapping: MenuActionMapping, windowLabel: string): void {
  runEditorAction(mapping.actionId, { windowLabel, params: mapping.params });
}

/**
 * A menu event routed straight to a CommandBus command via `executeCommand`
 * (the palette availability `when()` applies). The default binding kind.
 */
interface MenuCommandDispatch {
  kind?: "command";
  /** The Tauri menu event id, with or without the "menu:" prefix. */
  menuEvent: string;
  /** CommandBus id to dispatch when the event fires. */
  commandId: string;
}

/**
 * A menu event routed to the editor executor `runEditorAction` — NOT through
 * `executeCommand`. Editor menu actions deliberately use the executor's looser
 * `isActionExecutable` gate (live document + mode capability + format), never the
 * palette's stricter `actionAvailability` `when()`, and they apply the menu-only
 * focus gate (`shouldBlockMenuAction`) that the palette must not (WI-2.1).
 */
interface MenuEditorActionDispatch {
  kind: "editorAction";
  /** The Tauri menu event id, with or without the "menu:" prefix. */
  menuEvent: string;
  /** Editor action mapping (actionId + typed params) run via the shared executor. */
  mapping: MenuActionMapping;
}

export type MenuCommandBinding = MenuCommandDispatch | MenuEditorActionDispatch;

/** Normalize a menu event id to its `menu:`-prefixed form. */
function normalizeMenuEvent(menuEvent: string): string {
  return menuEvent.startsWith("menu:") ? menuEvent : `menu:${menuEvent}`;
}

/**
 * Mount listeners for a set of menu→command bindings on the current
 * window. Returns an unlisten function. Window-payload mismatch is
 * filtered automatically (events targeted at other windows are ignored).
 *
 * PREFLIGHT (WI-2.3): rejects the whole batch at mount time if two bindings
 * claim the same normalized menu event — one `menu:{id}` must have exactly one
 * dispatcher. This closes the ADR-012 hazard where two concurrent dispatchers
 * could both bind an id, silently double-firing.
 */
export async function mountMenuCommands(
  bindings: MenuCommandBinding[],
): Promise<UnlistenFn> {
  const seen = new Set<string>();
  for (const binding of bindings) {
    const event = normalizeMenuEvent(binding.menuEvent);
    if (seen.has(event)) {
      throw new Error(
        `Duplicate menu binding for "${event}" (→ ${bindingTarget(binding)}): ` +
          `one menu event must have exactly one dispatcher.`,
      );
    }
    seen.add(event);
  }

  const currentWindow = getCurrentWebviewWindow();
  const windowLabel = currentWindow.label;
  const unlisteners: UnlistenFn[] = [];
  const hasEditorActions = bindings.some((b) => b.kind === "editorAction");

  for (const binding of bindings) {
    const event = normalizeMenuEvent(binding.menuEvent);
    try {
      // Tauri's EventCallback returns void, so the listener must too. The body
      // below already catches its own failures (#957) — this adapter fixes the
      // CONTRACT, and is a second net if that catch is ever narrowed.
      const off = await currentWindow.listen<string | [unknown, string]>(event, voidAsync(async (e: { payload: string | [unknown, string] }) => {
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
            `Refusing to dispatch ${bindingTarget(binding)}: unexpected payload shape`,
            payload,
          );
          return;
        }
        if (binding.kind === "editorAction") {
          // Editor menu path: the menu-only focus gate (rejects focus inside the
          // palette/find-bar/dialogs) stays HERE, not in the executor — moving it
          // down would make the palette block its own commands (ADR-017 WI-1.2).
          // Then runEditorAction applies the executor gate — deliberately NOT the
          // palette `actionAvailability` when() (WI-2.1).
          if (shouldBlockMenuAction()) return;
          dispatchMenuAction(binding.mapping, windowLabel);
          return;
        }
        try {
          await executeCommand(binding.commandId, payload, { windowLabel });
        } catch (err) {
          menuError(`Command ${binding.commandId} threw:`, err);
        }
      }, (err) => menuError(`Menu listener for ${event} failed:`, err)));
      unlisteners.push(off);
    } catch (err) {
      menuError(`Failed to mount listener for ${event}:`, err);
    }
  }

  return () => {
    safeUnlistenAll(unlisteners);
    // Cancel any queued editor-action retry timers for this window (the executor
    // owns per-window retry state; the dispatcher owns its lifecycle).
    if (hasEditorActions) disposeEditorActionOwner(windowLabel);
  };
}

/** Human-readable dispatch target for error/dedup messages. */
function bindingTarget(binding: MenuCommandBinding): string {
  return binding.kind === "editorAction" ? binding.mapping.actionId : binding.commandId;
}
