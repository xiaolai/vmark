/**
 * Tests for useSplitDrag, driven through a minimal host element rather than
 * SplitDivider (whose tests cover pointer ownership, blur, capture release,
 * zero-width parents and unmount).
 *
 * Covers what the divider tests do not: the fraction is measured from the
 * parent's LEFT edge, pointercancel ends a drag like pointerup, and a second
 * pointerdown while a session is live replaces it instead of stacking a
 * second set of listeners.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useSplitDrag } from "./useSplitDrag";

function Bar({ onResize }: { onResize: (f: number) => void }) {
  const { onPointerDown } = useSplitDrag(onResize);
  return (
    <div data-testid="parent">
      <div data-testid="bar" onPointerDown={onPointerDown} />
    </div>
  );
}

function mount(rect: { left: number; width: number }) {
  const onResize = vi.fn();
  const view = render(<Bar onResize={onResize} />);
  const parent = view.getByTestId("parent");
  const box = new DOMRect(rect.left, 0, rect.width, 10);
  parent.getBoundingClientRect = () => box;
  return { onResize, bar: view.getByTestId("bar") };
}

afterEach(() => {
  cleanup();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

describe("useSplitDrag", () => {
  it("measures the fraction from the parent's left edge, not the viewport's", () => {
    const { onResize, bar } = mount({ left: 100, width: 400 });

    fireEvent.pointerDown(bar, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 200, pointerId: 1 });

    expect(onResize).toHaveBeenLastCalledWith(0.25);
  });

  it("pointercancel ends the drag and restores the body styles", () => {
    const { onResize, bar } = mount({ left: 0, width: 200 });

    fireEvent.pointerDown(bar, { button: 0, pointerId: 1 });
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent.pointerCancel(document, { pointerId: 1 });

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    fireEvent.pointerMove(document, { clientX: 50, pointerId: 1 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("a second pointerdown replaces the live session rather than stacking listeners", () => {
    const { onResize, bar } = mount({ left: 0, width: 200 });

    fireEvent.pointerDown(bar, { button: 0, pointerId: 1 });
    fireEvent.pointerDown(bar, { button: 0, pointerId: 2 });

    // The first pointer no longer owns anything.
    fireEvent.pointerMove(document, { clientX: 20, pointerId: 1 });
    expect(onResize).not.toHaveBeenCalled();

    // Exactly one listener answers the new pointer.
    fireEvent.pointerMove(document, { clientX: 50, pointerId: 2 });
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenLastCalledWith(0.25);

    fireEvent.pointerUp(document, { pointerId: 2 });
    fireEvent.pointerMove(document, { clientX: 80, pointerId: 2 });
    expect(onResize).toHaveBeenCalledTimes(1);
  });
});
