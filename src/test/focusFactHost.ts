/**
 * Focus fact host — the fixture the focus facts (`focusFacts.ts`) run in: a
 * fresh host element per case, element and event helpers, and a button whose
 * `disabled` follows React state, for the cases a React commit drives.
 * `openFactHost`/`closeFactHost` bracket one case for a runner without
 * vitest hooks (the in-app WKWebView journey).
 *
 * @coordinates-with test/focusFacts.ts — the facts that use it
 * @module test/focusFactHost
 */
import { afterEach, beforeEach } from "vitest";
import { createElement, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

/** A button whose `disabled` follows React state; `reenable` turns it back on from the layout effect of the commit that disabled it. */
function BusyButton({ log, reenable, expose }: { log: (entry: string) => void; reenable: boolean; expose: (set: (busy: boolean) => void) => void }) {
  const [busy, setBusy] = useState(false);
  expose(setBusy);
  useLayoutEffect(() => {
    log(`layoutEffect busy=${busy}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the case under measurement: a re-enable from the layout effect of the commit that disabled
    if (reenable && busy) setBusy(false);
  }, [busy, log, reenable]);
  return createElement("button", { id: "b", disabled: busy }, "b");
}

/** Where focus is, by name: `body` when it has fallen to the page. */
export function where(): string {
  const el = document.activeElement;
  if (el === null || el === document.body) return "body";
  return el.id || el.tagName.toLowerCase();
}

let host: HTMLElement;

/** The current case's host element. */
export const factHost = (): HTMLElement => host;

/**
 * Start a case: a fresh host element with nothing focused.
 * @public — the in-app WKWebView journey imports it inside webview-evaluated
 * code, which static analysis (knip) cannot trace.
 */
export function openFactHost(): void {
  (document.activeElement as HTMLElement | null)?.blur?.();
  host = document.createElement("div");
  document.body.appendChild(host);
}

/**
 * End a case: remove its host element.
 * @public — imported by the in-app WKWebView journey, as `openFactHost` is.
 */
export const closeFactHost = (): void => host.remove();

/** Give every case a fresh host element with nothing focused; call inside the runner's `describe`. */
export function useFocusFactHost(): void {
  beforeEach(openFactHost);
  afterEach(closeFactHost);
}

export function add<K extends keyof HTMLElementTagNameMap>(tag: K, id: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.id = id;
  if (el instanceof HTMLButtonElement) el.textContent = id;
  host.appendChild(el);
  return el;
}

/** Count `focusout` events dispatched on `el`. */
export function countFocusOut(el: HTMLElement): { n: number } {
  const seen = { n: 0 };
  el.addEventListener("focusout", () => seen.n++);
  return seen;
}

/**
 * Start in a fresh task just after a frame. A control disabled inside a
 * rendering update still running loses focus in that same update, so a
 * timing case that did not start here would measure where the previous
 * case left off.
 */
export const afterFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Record, in order, the events of `types` reaching `target` (capture phase). */
export function record(target: EventTarget, types: string[], log: string[]): void {
  for (const type of types) target.addEventListener(type, (e) => log.push(`${type}${e.target instanceof Element && e.target.id ? `@${e.target.id}` : ""}`), true);
}

/** Mount `BusyButton`, focused; returns its state setter and the log. */
export function mountBusy(reenable: boolean) {
  const log: string[] = [];
  let set: (busy: boolean) => void = () => undefined;
  const root: Root = createRoot(host);
  flushSync(() => root.render(createElement(BusyButton, { log: (e) => log.push(e), reenable, expose: (s) => (set = s) })));
  const b = host.querySelector<HTMLButtonElement>("#b");
  if (!b) throw new Error("BusyButton did not render");
  b.focus();
  log.length = 0;
  return { b, log, root, set: (busy: boolean) => flushSync(() => set(busy)) };
}
