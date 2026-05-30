import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import {
  useDismissOnOutsideOrEscape,
  type DismissOptions,
} from "./useDismissOnOutsideOrEscape";

function setup(
  enabled: boolean,
  target: HTMLElement | null = null,
  options?: DismissOptions,
) {
  const onDismiss = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ enabled: e }: { enabled: boolean }) => {
      const ref = useRef<HTMLElement | null>(target);
      useDismissOnOutsideOrEscape(e, ref, onDismiss, options);
    },
    { initialProps: { enabled } },
  );
  return { onDismiss, rerender, unmount };
}

describe("useDismissOnOutsideOrEscape", () => {
  it("calls onDismiss when mousedown happens outside the ref element", () => {
    const inside = document.createElement("div");
    document.body.appendChild(inside);
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    const { onDismiss, unmount } = setup(true, inside);

    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    unmount();
    document.body.removeChild(inside);
    document.body.removeChild(outside);
  });

  it("does not call onDismiss when mousedown happens inside the ref element", () => {
    const inside = document.createElement("div");
    const child = document.createElement("span");
    inside.appendChild(child);
    document.body.appendChild(inside);

    const { onDismiss, unmount } = setup(true, inside);

    child.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    unmount();
    document.body.removeChild(inside);
  });

  it("calls onDismiss when Escape is pressed", () => {
    const inside = document.createElement("div");
    document.body.appendChild(inside);

    const { onDismiss, unmount } = setup(true, inside);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    unmount();
    document.body.removeChild(inside);
  });

  it("ignores Escape during IME composition", () => {
    const inside = document.createElement("div");
    document.body.appendChild(inside);

    const { onDismiss, unmount } = setup(true, inside);

    // KeyboardEvent.isComposing is true during IME — should be filtered
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", isComposing: true }),
    );
    expect(onDismiss).not.toHaveBeenCalled();

    unmount();
    document.body.removeChild(inside);
  });

  it("does not call onDismiss for non-Escape keys", () => {
    const inside = document.createElement("div");
    document.body.appendChild(inside);

    const { onDismiss, unmount } = setup(true, inside);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(onDismiss).not.toHaveBeenCalled();

    unmount();
    document.body.removeChild(inside);
  });

  it("attaches no listeners when enabled is false", () => {
    const inside = document.createElement("div");
    document.body.appendChild(inside);
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    const { onDismiss, unmount } = setup(false, inside);

    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).not.toHaveBeenCalled();

    unmount();
    document.body.removeChild(inside);
    document.body.removeChild(outside);
  });

  it("removes listeners on unmount", () => {
    const inside = document.createElement("div");
    document.body.appendChild(inside);
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    const { onDismiss, unmount } = setup(true, inside);
    unmount();

    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).not.toHaveBeenCalled();

    document.body.removeChild(inside);
    document.body.removeChild(outside);
  });

  it("removes listeners when enabled flips to false", () => {
    const inside = document.createElement("div");
    document.body.appendChild(inside);
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    const { onDismiss, rerender, unmount } = setup(true, inside);

    rerender({ enabled: false });

    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).not.toHaveBeenCalled();

    unmount();
    document.body.removeChild(inside);
    document.body.removeChild(outside);
  });

  describe("deferActivation", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("does NOT dismiss on an outside click in the same tick as mount", () => {
      const inside = document.createElement("div");
      document.body.appendChild(inside);
      const outside = document.createElement("button");
      document.body.appendChild(outside);

      const { onDismiss, unmount } = setup(true, inside, {
        deferActivation: true,
      });

      // Same tick as mount — the listener is still pending on the timer.
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(onDismiss).not.toHaveBeenCalled();

      unmount();
      document.body.removeChild(inside);
      document.body.removeChild(outside);
    });

    it("dismisses on an outside click that occurs on a later tick", () => {
      const inside = document.createElement("div");
      document.body.appendChild(inside);
      const outside = document.createElement("button");
      document.body.appendChild(outside);

      const { onDismiss, unmount } = setup(true, inside, {
        deferActivation: true,
      });

      // Advance past the setTimeout(0) so the listener attaches.
      vi.runAllTimers();
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(onDismiss).toHaveBeenCalledTimes(1);

      unmount();
      document.body.removeChild(inside);
      document.body.removeChild(outside);
    });

    it("clears the pending timer on unmount before it fires", () => {
      const inside = document.createElement("div");
      document.body.appendChild(inside);
      const outside = document.createElement("button");
      document.body.appendChild(outside);

      const { onDismiss, unmount } = setup(true, inside, {
        deferActivation: true,
      });

      // Unmount before the deferred attach runs, then flush timers.
      unmount();
      vi.runAllTimers();
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(onDismiss).not.toHaveBeenCalled();

      document.body.removeChild(inside);
      document.body.removeChild(outside);
    });
  });

  it("does not handle Escape when escape: false", () => {
    const inside = document.createElement("div");
    document.body.appendChild(inside);
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    const { onDismiss, unmount } = setup(true, inside, { escape: false });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).not.toHaveBeenCalled();

    // Outside-click half still works.
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    unmount();
    document.body.removeChild(inside);
    document.body.removeChild(outside);
  });

  it("dismisses on outside mousedown with bubble phase (capture: false)", () => {
    const inside = document.createElement("div");
    document.body.appendChild(inside);
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    const { onDismiss, unmount } = setup(true, inside, { capture: false });

    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    unmount();
    document.body.removeChild(inside);
    document.body.removeChild(outside);
  });
});
