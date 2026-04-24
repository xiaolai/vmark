import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useDismissOnOutsideOrEscape } from "./useDismissOnOutsideOrEscape";

function setup(enabled: boolean, target: HTMLElement | null = null) {
  const onDismiss = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ enabled: e }: { enabled: boolean }) => {
      const ref = useRef<HTMLElement | null>(target);
      useDismissOnOutsideOrEscape(e, ref, onDismiss);
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
});
