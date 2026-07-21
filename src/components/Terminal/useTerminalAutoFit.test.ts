/**
 * useTerminalAutoFit — refit xterm whenever its container box changes.
 *
 * Regression cover for the window-resize bug: the panel's width/height is
 * CSS-transitioned (`transition: width var(--duration-medium)`), so a single
 * rAF-delayed fit after the React state change measured the container while it
 * was still animating and left xterm stuck near its pre-resize column count.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { useTerminalAutoFit } from "./useTerminalAutoFit";

type ROCallback = () => void;

let observed: Element[] = [];
let callbacks: ROCallback[] = [];
let disconnects = 0;

class FakeResizeObserver {
  constructor(private cb: ROCallback) {
    callbacks.push(cb);
  }
  observe(el: Element) {
    observed.push(el);
  }
  disconnect() {
    disconnects += 1;
  }
  unobserve() {}
}

/** Flush one animation frame. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

const originalRO = globalThis.ResizeObserver;

beforeEach(() => {
  observed = [];
  callbacks = [];
  disconnects = 0;
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalRO;
});

describe("useTerminalAutoFit", () => {
  it("observes the container element", () => {
    const el = document.createElement("div");
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;

    renderHook(() => useTerminalAutoFit(ref, vi.fn()));

    expect(observed).toEqual([el]);
  });

  it("refits when the container box changes", async () => {
    const el = document.createElement("div");
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;
    const fit = vi.fn();

    renderHook(() => useTerminalAutoFit(ref, fit));
    expect(fit).not.toHaveBeenCalled();

    callbacks[0]();
    await nextFrame();

    expect(fit).toHaveBeenCalledTimes(1);
  });

  it("refits again on each later box change (CSS transition frames)", async () => {
    const el = document.createElement("div");
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;
    const fit = vi.fn();

    renderHook(() => useTerminalAutoFit(ref, fit));

    for (let i = 0; i < 3; i++) {
      callbacks[0]();
      await nextFrame();
    }

    expect(fit).toHaveBeenCalledTimes(3);
  });

  it("coalesces bursts within one frame into a single fit", async () => {
    const el = document.createElement("div");
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;
    const fit = vi.fn();

    renderHook(() => useTerminalAutoFit(ref, fit));

    callbacks[0]();
    callbacks[0]();
    callbacks[0]();
    await nextFrame();

    expect(fit).toHaveBeenCalledTimes(1);
  });

  it("uses the latest fit callback, not the one captured at mount", async () => {
    const el = document.createElement("div");
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(({ f }) => useTerminalAutoFit(ref, f), {
      initialProps: { f: first },
    });
    rerender({ f: second });

    callbacks[0]();
    await nextFrame();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    // Swapping the callback must not tear down and re-create the observer.
    expect(observed).toHaveLength(1);
  });

  it("disconnects and drops the pending frame on unmount", async () => {
    const el = document.createElement("div");
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;
    const fit = vi.fn();

    const { unmount } = renderHook(() => useTerminalAutoFit(ref, fit));

    callbacks[0]();
    unmount();
    await nextFrame();

    expect(disconnects).toBe(1);
    expect(fit).not.toHaveBeenCalled();
  });

  it("no-ops when the container ref is empty", () => {
    const ref = createRef<HTMLDivElement>();

    expect(() => renderHook(() => useTerminalAutoFit(ref, vi.fn()))).not.toThrow();
    expect(observed).toHaveLength(0);
  });

  it("does not observe while inactive", () => {
    const el = document.createElement("div");
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;

    renderHook(() => useTerminalAutoFit(ref, vi.fn(), false));

    expect(observed).toHaveLength(0);
  });

  it("starts observing when the container mounts on activation", () => {
    // Deferred xterm activation: the panel renders null (no container) until it
    // is first shown, so the observer must attach on the activating render.
    const ref = createRef<HTMLDivElement>();
    const { rerender } = renderHook(
      ({ active }) => useTerminalAutoFit(ref, vi.fn(), active),
      { initialProps: { active: false } }
    );
    expect(observed).toHaveLength(0);

    const el = document.createElement("div");
    (ref as { current: HTMLDivElement | null }).current = el;
    rerender({ active: true });

    expect(observed).toEqual([el]);
  });

  it("no-ops when ResizeObserver is unavailable", () => {
    // @ts-expect-error — simulating an environment without ResizeObserver
    delete globalThis.ResizeObserver;
    const el = document.createElement("div");
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;

    expect(() => renderHook(() => useTerminalAutoFit(ref, vi.fn()))).not.toThrow();
  });
});
