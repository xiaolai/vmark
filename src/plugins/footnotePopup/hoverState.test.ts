// @vitest-environment node
/**
 * Per-view hover bookkeeping.
 *
 * The timer discipline is the point: a pending open must not fire after the
 * pointer has left, and clearing must be safe to call when nothing is pending.
 *
 * @coordinates-with plugins/footnotePopup/hoverState.ts
 * @module plugins/footnotePopup/hoverState.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getHoverState,
  clearHoverTimeout,
  clearCloseTimeout,
  resetHoverState,
} from "./hoverState";
import type { EditorView } from "@tiptap/pm/view";

const view = () => ({}) as EditorView;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("hover state is per view", () => {
  it("returns the same object for one view", () => {
    const v = view();
    expect(getHoverState(v)).toBe(getHoverState(v));
  });

  it("keeps two views' state separate", () => {
    expect(getHoverState(view())).not.toBe(getHoverState(view()));
  });
});

describe("clearing is safe whether or not a timer is pending", () => {
  it("cancels a PENDING open timer", () => {
    const state = getHoverState(view());
    const fired = vi.fn();
    state.hoverTimeout = setTimeout(fired, 100);
    clearHoverTimeout(state);
    vi.advanceTimersByTime(500);
    expect(fired).not.toHaveBeenCalled();
    expect(state.hoverTimeout).toBeNull();
  });

  it("cancels a PENDING close timer", () => {
    const state = getHoverState(view());
    const fired = vi.fn();
    state.closeTimeout = setTimeout(fired, 100);
    clearCloseTimeout(state);
    vi.advanceTimersByTime(500);
    expect(fired).not.toHaveBeenCalled();
    expect(state.closeTimeout).toBeNull();
  });

  it("is a no-op when nothing is pending", () => {
    // The other branch: called on a fresh state, which happens on every
    // mouseout that had no pending open.
    const state = getHoverState(view());
    expect(() => {
      clearHoverTimeout(state);
      clearCloseTimeout(state);
    }).not.toThrow();
  });
});

describe("reset clears both timers at once", () => {
  it("leaves no timer pending", () => {
    const v = view();
    const state = getHoverState(v);
    state.hoverTimeout = setTimeout(() => {}, 100);
    state.closeTimeout = setTimeout(() => {}, 100);
    resetHoverState(v);
    expect(getHoverState(v).hoverTimeout).toBeNull();
    expect(getHoverState(v).closeTimeout).toBeNull();
  });
});
