/**
 * WebKit focus model — makes jsdom move focus the way WebKit does, so a focus
 * test that would fail in the app fails in jsdom too. jsdom keeps focus on a
 * button that becomes disabled and on whatever was focused when something
 * else is clicked; WebKit drops both to the page.
 *
 * Key decisions:
 *   - The model owns the frame clock: `requestAnimationFrame` callbacks queue
 *     and run in a modelled frame, a timer tick after they were asked for.
 *     The frame ends, after its callbacks and their microtasks, with the
 *     focus check WebKit makes when it updates style: a focused control that
 *     is disabled at that moment loses focus. One re-enabled before the frame
 *     ends keeps it, and one disabled while a frame is under way loses it at
 *     the end of that same frame.
 *   - A disable schedules a frame even when nothing asked for one, as a
 *     style change schedules a rendering update in WebKit.
 *   - `mouseClick` is a mouse click on a button: it focuses nothing and takes
 *     focus from whatever held it. A text control is refused, since a real
 *     click on one would focus it.
 *
 * @coordinates-with test/focusFacts.ts — the facts this model is held to
 * @module test/webkitFocusModel
 */
import { fireEvent } from "@testing-library/react";

/** Time between modelled frames: long enough that a task queued with no delay runs first. */
const FRAME_MS = 16;

interface Clock {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
  next(): Promise<void>;
}

let clock: Clock | null = null;

function blurIfDisabled(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.matches(":disabled")) return;
  // jsdom's blur() ignores an element that cannot take focus, and a disabled one cannot; focusing the
  // root element focuses the document instead, firing blur and focusout with no related target.
  document.documentElement.focus();
}

/** Install the frame clock and the focus rules. Returns the uninstall. */
export function installWebKitFocusModel(): () => void {
  if (clock !== null) throw new Error("the WebKit focus model is already installed");
  let queued = new Map<number, FrameRequestCallback>();
  let handles = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ended: Array<() => void> = [];
  const endFrame = () => {
    blurIfDisabled();
    const waiting = ended;
    ended = [];
    for (const resolve of waiting) resolve();
  };
  const runFrame = () => {
    timer = null;
    const due = queued;
    queued = new Map();
    // Queued before the callbacks run, so it fires after their microtasks and before any task they queue.
    setTimeout(endFrame, 0);
    for (const callback of due.values()) callback(performance.now());
  };
  const schedule = () => {
    timer ??= setTimeout(runFrame, FRAME_MS);
  };
  const installed: Clock = {
    request(callback) {
      queued.set(++handles, callback);
      schedule();
      return handles;
    },
    cancel(handle) {
      queued.delete(handle);
    },
    next() {
      schedule();
      return new Promise((resolve) => ended.push(resolve));
    },
  };
  const targets = new Set<typeof globalThis>([globalThis, window as unknown as typeof globalThis]);
  const originals = [...targets].map((target) => ({ target, request: target.requestAnimationFrame, cancel: target.cancelAnimationFrame }));
  for (const target of targets) {
    target.requestAnimationFrame = installed.request;
    target.cancelAnimationFrame = installed.cancel;
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document, { attributes: true, attributeFilter: ["disabled"], subtree: true });
  clock = installed;
  return () => {
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
    for (const { target, request, cancel } of originals) {
      target.requestAnimationFrame = request;
      target.cancelAnimationFrame = cancel;
    }
    clock = null;
  };
}

/** Resolves when the next modelled frame has ended, its focus check included. */
export function nextFrame(): Promise<void> {
  if (clock === null) throw new Error("nextFrame needs the WebKit focus model installed");
  return clock.next();
}

/** A mouse click on `el` as WebKit delivers it: focus leaves for the page, and `el` does not take it. */
export function mouseClick(el: HTMLElement): void {
  if (el.matches("input, textarea, select, [contenteditable]")) throw new Error(`mouseClick models a click on a button, not on <${el.tagName.toLowerCase()}>`);
  fireEvent.pointerDown(el);
  fireEvent.mouseDown(el);
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur();
    // A press clears focus whatever holds it, a button disabled but not yet blurred included; jsdom's blur() ignores that one.
    if (document.activeElement === active) document.documentElement.focus();
  }
  fireEvent.pointerUp(el);
  fireEvent.mouseUp(el);
  fireEvent.click(el);
}
