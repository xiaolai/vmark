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
 * Key decisions:
 *   - Every listener is requested at once. Each `listen()` is an IPC round
 *     trip, and the window's readiness waits on the whole mount: ~155 of them
 *     in series outlasted the 5 s budget on a loaded machine.
 *   - So cancellation is an AbortSignal, not a check between registrations:
 *     it removes what has landed at once, and each later registration as it
 *     lands. A listener also checks its pass is live when it DISPATCHES —
 *     an event can arrive while its unlisten is still in flight.
 *   - Only a window's latest mount disposes that window's editor-action
 *     owner, so a replaced pass torn down late cannot cancel the retries its
 *     replacement queued.
 *
 * @module services/commands/menuListener
 */

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten, safeUnlistenAll } from "@/utils/safeUnlisten";
import { executeCommand, hasCommand } from "./CommandBus";
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
 * focus gate (`shouldBlockMenuAction`) that the palette must not.
 */
interface MenuEditorActionDispatch {
  kind: "editorAction";
  /** The Tauri menu event id, with or without the "menu:" prefix. */
  menuEvent: string;
  /** Editor action mapping (actionId + typed params) run via the shared executor. */
  mapping: MenuActionMapping;
}

export type MenuCommandBinding = MenuCommandDispatch | MenuEditorActionDispatch;

/** What a mount produced: its teardown, and how complete it is. */
export interface MenuMountResult {
  /** Unlisten everything this mount installed (and dispose the retry owner). */
  off: UnlistenFn;
  /**
   * Normalized menu events that will not route — EMPTY on a complete mount.
   * Two causes: a `listen` the runtime refused, and a binding
   * whose CommandBus target does not exist, which `executeCommand` reports
   * only as a `false` nobody could distinguish from an ordinary `when()`
   * rejection. The caller decides what an incomplete menu means; it must not
   * have to infer it from a resolved promise.
   */
  failed: string[];
}

/** Options for {@link mountMenuCommands}. */
export interface MountMenuCommandsOptions {
  /**
   * Aborting tears the mount down: every listener that has landed is removed
   * at once, each one still in flight is removed as it lands, and none of them
   * dispatches again. A StrictMode-cancelled or unmounted pass otherwise keeps
   * ITS listeners live beside the replay pass, double-dispatching every menu
   * event bound in that window.
   */
  signal?: AbortSignal;
}

/** The latest editor-action mount per window — the one that may dispose its owner. */
const latestEditorActionMount = new Map<string, symbol>();

type MenuPayload = string | [unknown, string];

/** Normalize a menu event id to its `menu:`-prefixed form. */
function normalizeMenuEvent(menuEvent: string): string {
  return menuEvent.startsWith("menu:") ? menuEvent : `menu:${menuEvent}`;
}

/** What a menu event's payload says this window should do with it. */
export type MenuPayloadDecision =
  /** Ours: dispatch, with `args` decoded out of the routing envelope. */
  | { kind: "dispatch"; args: unknown }
  /** Targeted at a different window — ignore it, silently. */
  | { kind: "other-window" }
  /** A shape this protocol does not define — refuse, loudly. */
  | { kind: "unknown" };

/**
 * Decode a menu event's payload: window targeting AND the argument envelope.
 *
 * PURE, and extracted from inside the listener closure because it
 * is the one rule in this module that has already been wrong in production. The
 * payload is the TRANSPORT: a bare string IS the target window
 * label and carries no argument at all, while a tuple is `[data, windowLabel]`.
 * Forwarding it verbatim handed `file.openRecent` the literal window label as
 * its path in the string case, and the whole envelope — label included — in the
 * tuple case. Buried three closures deep inside an `await currentWindow.listen`
 * callback, that rule had no test of its own; here it has one.
 */
export function decodeMenuPayload(payload: unknown, windowLabel: string): MenuPayloadDecision {
  if (typeof payload === "string") {
    return payload === windowLabel ? { kind: "dispatch", args: undefined } : { kind: "other-window" };
  }
  if (Array.isArray(payload)) {
    return payload[1] === windowLabel
      ? { kind: "dispatch", args: payload[0] }
      : { kind: "other-window" };
  }
  return { kind: "unknown" };
}

/**
 * Mount listeners for a set of menu→command bindings on the current
 * window. Returns an unlisten function. Window-payload mismatch is
 * filtered automatically (events targeted at other windows are ignored).
 *
 * PREFLIGHT: rejects the whole batch at mount time if two bindings
 * claim the same normalized menu event — one `menu:{id}` must have exactly one
 * dispatcher. This closes the ADR-012 hazard where two concurrent dispatchers
 * could both bind an id, silently double-firing. That is a programming error
 * in a STATIC binding list, not a runtime condition, which is why it is the
 * one thing here that still rejects.
 *
 * BEST-EFFORT, WITH A COMPLETENESS RESULT: a `listen` that rejects
 * is logged, recorded in `failed`, and SKIPPED; every other binding still
 * mounts. The original defect was never the partial menu — it was the
 * bootstrap reporting a complete one. Round 2 made the batch all-or-nothing
 * instead, which turned one bad registration (an event name the runtime
 * refuses is deterministic, and per-event) into a window with no menu at all:
 * strictly worse than the mostly-working menu it replaced. The caller now
 * learns exactly what did not mount and signals readiness accordingly.
 */
export async function mountMenuCommands(
  bindings: MenuCommandBinding[],
  options: MountMenuCommandsOptions = {},
): Promise<MenuMountResult> {
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

  const { signal } = options;
  if (signal?.aborted) return { off: () => {}, failed: [] };

  const currentWindow = getCurrentWebviewWindow();
  const windowLabel = currentWindow.label;
  const unlisteners: UnlistenFn[] = [];
  const hasEditorActions = bindings.some((b) => b.kind === "editorAction");
  const mount = Symbol(windowLabel);
  if (hasEditorActions) latestEditorActionMount.set(windowLabel, mount);

  let tornDown = false;
  const isLive = () => !tornDown;
  const teardown = () => {
    // Idempotent: an aborted mount tears itself down and still hands the caller
    // an `off` it is entitled to call.
    if (tornDown) return;
    tornDown = true;
    signal?.removeEventListener("abort", teardown);
    safeUnlistenAll(unlisteners);
    // Cancel any queued editor-action retry timers for this window (the executor
    // owns per-window retry state; the dispatcher owns its lifecycle) — unless a
    // newer mount for this window already owns them.
    if (hasEditorActions && latestEditorActionMount.get(windowLabel) === mount) {
      latestEditorActionMount.delete(windowLabel);
      disposeEditorActionOwner(windowLabel);
    }
  };
  signal?.addEventListener("abort", teardown, { once: true });

  // One task per binding, all started now; each settles to the event it could
  // not mount, or null. Read back in binding order, so `failed` does not depend
  // on which registration the runtime answers first.
  const outcomes = await Promise.all(bindings.map(async (binding): Promise<string | null> => {
    const event = normalizeMenuEvent(binding.menuEvent);
    // A binding whose command does not exist is a DEAD menu item:
    // `executeCommand` returns the same `false` for "no such command" as for
    // "`when()` said no", so the runtime cannot tell them apart and the item
    // silently does nothing. Preflighted per binding rather than thrown for the
    // batch — the rule is that one bad binding must cost its own item and
    // nothing else — and recorded in `failed` so readiness reports the truth.
    if (binding.kind !== "editorAction" && !hasCommand(binding.commandId)) {
      menuError(`No command registered for ${event} (→ ${binding.commandId}); not mounting it.`);
      return event;
    }
    try {
      const off = await currentWindow.listen<MenuPayload>(event, menuEventHandler(binding, event, windowLabel, isLive));
      // Landed after the teardown, which could not see it: remove it here.
      if (tornDown) safeUnlisten(off);
      else unlisteners.push(off);
      return null;
    } catch (err) {
      // Skip this one, keep the rest. The caller is told which
      // events are dead through `failed`, so a partial menu can never be
      // reported as a whole one.
      menuError(`Failed to mount listener for ${event}:`, err);
      return event;
    }
  }));

  return { off: teardown, failed: outcomes.filter((event): event is string => event !== null) };
}

/** The listener for one binding. It dispatches only while its mount is live. */
function menuEventHandler(
  binding: MenuCommandBinding,
  event: string,
  windowLabel: string,
  isLive: () => boolean,
): (e: { payload: MenuPayload }) => void {
  // Tauri's EventCallback returns void, so the listener must too. The body
  // below already catches its own failures — this adapter fixes the
  // CONTRACT, and is a second net if that catch is ever narrowed.
  return voidAsync(async (e: { payload: MenuPayload }) => {
    if (!isLive()) return;
    const decoded = decodeMenuPayload(e.payload, windowLabel);
    if (decoded.kind === "other-window") return;
    if (decoded.kind === "unknown") {
      menuError(
        `Refusing to dispatch ${bindingTarget(binding)}: unexpected payload shape`,
        e.payload,
      );
      return;
    }
    if (binding.kind === "editorAction") {
      // Editor menu path: the menu-only focus gate (rejects focus inside the
      // palette/find-bar/dialogs) stays HERE, not in the executor — moving it
      // down would make the palette block its own commands (ADR-017).
      // Then runEditorAction applies the executor gate — deliberately NOT the
      // palette `actionAvailability` when().
      if (shouldBlockMenuAction()) return;
      dispatchMenuAction(binding.mapping, windowLabel);
      return;
    }
    try {
      await executeCommand(binding.commandId, decoded.args, { windowLabel });
    } catch (err) {
      menuError(`Command ${binding.commandId} threw:`, err);
    }
  }, (err) => menuError(`Menu listener for ${event} failed:`, err));
}

/** Human-readable dispatch target for error/dedup messages. */
function bindingTarget(binding: MenuCommandBinding): string {
  return binding.kind === "editorAction" ? binding.mapping.actionId : binding.commandId;
}
