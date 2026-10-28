/**
 * Comment focus targets — decides which control in the comments panel a
 * pending focus intent lands on, reading only the DOM the panel rendered.
 *
 * Key decisions:
 *   - Readiness is read from the DOM, never from component state: a target
 *     that is missing or disabled answers "wait", and the intent stays
 *     pending for a later render. A focused button that becomes disabled
 *     loses focus in WebKit, and `focus()` on a disabled one does nothing, so
 *     a target taken while it is disabled would leave focus on the page.
 *   - "First control" counts disabled controls: a disabled one means wait,
 *     never skip ahead to an enabled one further down (past every thread to
 *     the add box while an action runs).
 *   - A recorded thread action waits until the thread shows a newer
 *     generation than the one it was pressed on, so focus does not land on a
 *     button the re-read is about to replace. A missing or older generation
 *     is a wait too, never a pass.
 *   - Only a loaded list that lacks a thread means the thread left. While no
 *     list is loaded (a failed read, or none yet) every thread intent waits,
 *     so a failed read never sends focus to the add box.
 *   - A thread that left goes to its neighbour by its place in the last list
 *     that held it; with no place recorded it waits rather than guess one.
 *   - Focus that was on the Deleted comment line's Dismiss goes, when a
 *     loaded list no longer shows the line, to the reply box of the thread
 *     being replied to if that thread is listed again (waiting until the box
 *     renders), else to the add box's first enabled control; while no list
 *     is loaded it waits, like every thread intent.
 *
 * DOM contract: the panel carries `data-list="loaded"` while a list is
 * loaded; threads are `li[data-comment]` carrying `data-comment-gen`; the
 * add box is `.comments-panel__add`; focusable controls carry `data-focus`
 * (Dismiss is `dismiss`, a reply box `replyBox`); thread action buttons
 * carry `data-action`.
 *
 * @module components/Comments/commentFocusTargets
 */

/** A pending wish to put focus somewhere in the panel. */
export type FocusIntent =
  /** A control by name in the add box (`scope: "add"`), on the Deleted comment line (`scope: "line"`) or in a thread (`scope`: its comment id). */
  | { kind: "control"; scope: string; name: string; index: number; afterGen: string | null }
  /** The thread `comment` is gone (deleted here or elsewhere). */
  | { kind: "leave"; comment: string }
  /** The Deleted comment line was dismissed. */
  | { kind: "line" };

export interface TargetContext {
  /** The panel element. */
  root: HTMLElement;
  /** The thread being replied to, whose Deleted comment line replaces it. */
  replyingTo: string | null;
  /** Each thread's place in the last list that held it. */
  seen: ReadonlyMap<string, number>;
}

const CONTROL = "button, textarea";
const LINE_SCOPE = "line";

const firstControl = (el: Element | null | undefined) => el?.querySelector<HTMLElement>(CONTROL) ?? null;
const named = (el: Element, name: string) => el.querySelector<HTMLElement>(`[data-focus="${name}"]`);
const threads = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>("li[data-comment]"));
const threadOf = (root: HTMLElement, comment: string) => threads(root).find((li) => li.dataset.comment === comment) ?? null;
const ready = (target: HTMLElement | null): HTMLElement | "wait" => (target === null || target.matches(":disabled") ? "wait" : target);

function addTarget(root: HTMLElement, name: string | null): HTMLElement | null {
  const box = root.querySelector(".comments-panel__add");
  if (!box) return null;
  return (name === null ? null : named(box, name)) ?? firstControl(box);
}

function threadTarget(li: HTMLElement, name: string, index: number): HTMLElement | null {
  const byName = named(li, name);
  if (byName) return byName;
  const actions = li.querySelectorAll<HTMLElement>("button[data-action]");
  return actions.length > 0 ? actions[Math.min(index, actions.length - 1)] : firstControl(li);
}

/** Whether the thread `gen` renders is past `afterGen`; a missing generation is not. */
const pastGen = (gen: string | undefined, afterGen: string) => gen !== undefined && BigInt(gen) > BigInt(afterGen);

function leaveTarget(comment: string, { root, replyingTo, seen }: TargetContext): HTMLElement | "wait" {
  if (threadOf(root, comment)) return "wait";
  const dismiss = comment === replyingTo ? named(root, "dismiss") : null;
  if (dismiss) return ready(dismiss);
  const at = seen.get(comment);
  if (at === undefined) return "wait";
  const items = threads(root);
  return ready(firstControl(items[at]) ?? firstControl(items[at - 1]) ?? addTarget(root, null));
}

function lineTarget({ root, replyingTo }: TargetContext): HTMLElement | "wait" {
  const dismiss = named(root, "dismiss");
  if (dismiss) return ready(dismiss);
  const relisted = replyingTo === null ? null : threadOf(root, replyingTo);
  if (relisted) return ready(named(relisted, "replyBox"));
  return root.querySelector<HTMLElement>(`.comments-panel__add :is(${CONTROL}):not(:disabled)`) ?? "wait";
}

/** The control `intent` lands on now, or "wait" when it is not ready yet. */
export function targetFor(intent: FocusIntent, context: TargetContext): HTMLElement | "wait" {
  const { root } = context;
  if (intent.kind === "control" && intent.scope === "add") return ready(addTarget(root, intent.name));
  if (root.dataset.list !== "loaded") return "wait";
  if (intent.kind === "control" && intent.scope === LINE_SCOPE) return lineTarget(context);
  if (intent.kind === "line") return ready(firstControl(threads(root)[0]) ?? addTarget(root, null));
  if (intent.kind === "leave") return leaveTarget(intent.comment, context);
  const li = threadOf(root, intent.scope);
  if (!li) return leaveTarget(intent.scope, context);
  if (intent.afterGen !== null && !pastGen(li.dataset.commentGen, intent.afterGen)) return "wait";
  return ready(threadTarget(li, intent.name, intent.index));
}
