/**
 * Comment focus — the comments panel's one place that moves keyboard focus:
 * controls record where focus should go after what they did (an intent),
 * and every commit resolves the pending intent against the rendered DOM.
 *
 * Key decisions:
 *   - One slot. A newer intent replaces the older; an intent whose
 *     interaction is stale is ignored: every action takes a token from
 *     `begin()` before it awaits, and any later `begin()`, pointer press or
 *     Tab makes it stale and cancels whatever was pending, so a later
 *     interaction always wins and a click on blank space is never undone.
 *   - Readiness is read from the DOM of the commit (`commentFocusTargets.ts`),
 *     never from component state; a target not ready yet keeps the intent
 *     waiting for a later commit. `intend()` also forces a commit, since the
 *     action's own commit (the lock released) may already be past.
 *   - Focus is placed only when it has fallen to the page; a ready intent
 *     with focus elsewhere is dropped. Ready with the target still focused,
 *     the slot is held two frames: a control disabled and re-enabled within
 *     one frame may still lose focus at the next rendering update, and then
 *     it is focused again.
 *   - Focus that falls while inside the panel (the focused thread deleted or
 *     changed elsewhere) is followed by an intent synthesized from the
 *     control it was last in, unless one is pending or this panel's own
 *     action is under way. That record is cleared only by the person: focus
 *     moving to another element (also after it fell, which fires no panel
 *     blur), a blur that follows a pointer press or Tab (counted in `moves`),
 *     or a press or Tab once focus has already fallen;
 *     a blur the engine causes (a control disabled, an element removed, a
 *     native dialog) has no related target, follows no press, and keeps it.
 *   - Each thread's place is recorded after every commit, so a thread that
 *     left is found a neighbour by where it last was.
 *
 * @coordinates-with components/Comments/commentFocusTargets.ts — where an intent lands
 * @coordinates-with components/Comments/CommentsPanel.tsx — owns it
 * @module components/Comments/useCommentFocus
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { targetFor, type FocusIntent } from "./commentFocusTargets";

/** What a control records: `begin()` before an action awaits, `intend(token, …)` once it knows where focus goes. */
export interface CommentFocusIntents {
  begin: () => number;
  intend: (token: number, intent: FocusIntent) => void;
  /** Resolve the pending intent against the DOM; called from layout effects. */
  settle: () => void;
}

/** The panel's side: the section's ref and focus handlers, and the intents its controls record. */
export interface CommentFocus {
  intents: CommentFocusIntents;
  sectionRef: React.RefObject<HTMLElement | null>;
  onFocus: (e: React.FocusEvent) => void;
  onBlur: (e: React.FocusEvent) => void;
}

/** The control focus was last in: its scope (`add`, `line` or a comment id), name and action index. */
interface Within {
  scope: string;
  name: string;
  index: number;
  moves: number;
}

const fallen = () => document.activeElement === null || document.activeElement === document.body;

function whereIs(el: Element): Omit<Within, "moves"> {
  const name = el.getAttribute("data-focus") ?? "";
  const li = el.closest<HTMLElement>("li[data-comment]");
  if (li?.dataset.comment !== undefined) {
    const actions = Array.from(li.querySelectorAll("button[data-action]"));
    return { scope: li.dataset.comment, name, index: Math.max(0, actions.indexOf(el)) };
  }
  return { scope: el.closest(".comments-panel__add") ? "add" : "line", name, index: 0 };
}

export function useCommentFocus(replyingTo: string | null): CommentFocus {
  const sectionRef = useRef<HTMLElement>(null);
  const [, bump] = useState(0);
  const slot = useRef<FocusIntent | null>(null);
  const confirming = useRef<number | null>(null);
  const seq = useRef(0);
  const awaited = useRef<number | null>(null);
  const moves = useRef(0);
  const within = useRef<Within | null>(null);
  const seen = useRef(new Map<string, number>());

  const clear = useCallback(() => {
    slot.current = null;
    if (confirming.current !== null) cancelAnimationFrame(confirming.current);
    confirming.current = null;
  }, []);

  const begin = useCallback(() => {
    clear();
    awaited.current = ++seq.current;
    return seq.current;
  }, [clear]);

  const intend = useCallback(
    (token: number, intent: FocusIntent) => {
      if (token !== seq.current) return;
      awaited.current = null;
      clear();
      slot.current = intent;
      bump((n) => n + 1);
    },
    [clear],
  );

  const settle = useCallback(() => {
    const root = sectionRef.current;
    if (!root) return;
    const w = within.current;
    if (slot.current === null && w !== null && awaited.current !== seq.current && fallen()) {
      slot.current = { kind: "control", scope: w.scope, name: w.name, index: w.index, afterGen: null };
    }
    const intent = slot.current;
    if (intent !== null && confirming.current === null) {
      const target = targetFor(intent, { root, replyingTo, seen: seen.current });
      if (target !== "wait" && document.activeElement === target) {
        confirming.current = requestAnimationFrame(() => {
          confirming.current = requestAnimationFrame(() => {
            confirming.current = null;
            slot.current = null;
            if (fallen()) target.focus();
          });
        });
      } else if (target !== "wait") {
        slot.current = null;
        if (fallen()) target.focus();
      }
    }
    root.querySelectorAll<HTMLElement>("li[data-comment]").forEach((li, i) => seen.current.set(li.dataset.comment ?? "", i));
  }, [replyingTo]);

  useLayoutEffect(settle);

  useEffect(() => {
    const interacted = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Tab") return;
      seq.current++;
      moves.current++;
      // Focus already fell (an engine blur): this press or Tab is the person moving on from it.
      if (fallen()) within.current = null;
      clear();
    };
    // Focus taken outside the panel after it fell (a shortcut focusing the editor) fires no panel blur.
    const elsewhere = (e: FocusEvent) => {
      if (!(e.target instanceof Node && sectionRef.current?.contains(e.target))) within.current = null;
    };
    document.addEventListener("pointerdown", interacted, true);
    document.addEventListener("keydown", interacted, true);
    document.addEventListener("focusin", elsewhere, true);
    return () => {
      document.removeEventListener("pointerdown", interacted, true);
      document.removeEventListener("keydown", interacted, true);
      document.removeEventListener("focusin", elsewhere, true);
      clear();
    };
  }, [clear]);

  const onFocus = useCallback((e: React.FocusEvent) => {
    within.current = { ...whereIs(e.target), moves: moves.current };
  }, []);
  const onBlur = useCallback((e: React.FocusEvent) => {
    if (e.relatedTarget !== null || within.current?.moves !== moves.current) within.current = null;
  }, []);

  const intents = useMemo(() => ({ begin, intend, settle }), [begin, intend, settle]);
  return { intents, sectionRef, onFocus, onBlur };
}
