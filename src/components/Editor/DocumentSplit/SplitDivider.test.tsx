import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SplitDivider } from "./SplitDivider";

/** Mock the divider parent's box so drag math is deterministic in jsdom. */
function mockParentRect(sep: HTMLElement, rect: Partial<DOMRect>) {
  const parent = sep.parentElement as HTMLElement;
  parent.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, ...rect }) as DOMRect;
  return parent;
}

describe("SplitDivider (#1081)", () => {
  it("exposes separator semantics with the fraction as a percentage", () => {
    render(<SplitDivider fraction={0.42} onResize={vi.fn()} />);
    const sep = screen.getByRole("separator");
    expect(sep).toHaveAttribute("aria-orientation", "vertical"); // left|right ⇒ vertical bar
    expect(sep).toHaveAttribute("aria-valuenow", "42");
    expect(sep).toHaveAttribute("tabindex", "0");
  });

  it("ignores Up/Down — the split is always side-by-side (WI-FL3.10)", () => {
    const onResize = vi.fn();
    render(<SplitDivider fraction={0.5} onResize={onResize} />);
    const sep = screen.getByRole("separator");
    fireEvent.keyDown(sep, { key: "ArrowDown" });
    fireEvent.keyDown(sep, { key: "ArrowUp" });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("resizes with arrow keys, clamped via the parent's onResize", () => {
    const onResize = vi.fn();
    render(<SplitDivider fraction={0.5} onResize={onResize} />);
    const sep = screen.getByRole("separator");

    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(onResize).toHaveBeenLastCalledWith(0.55);
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith(0.45);
    fireEvent.keyDown(sep, { key: "Home" });
    expect(onResize).toHaveBeenLastCalledWith(0.2);
    fireEvent.keyDown(sep, { key: "End" });
    expect(onResize).toHaveBeenLastCalledWith(0.8);
  });

  // Audit 20260907 (#278/#279): the divider now drags on Pointer Events — touch
  // and pen included — through `useSplitDrag`, which rejects non-primary
  // buttons and tears its document listeners and body styles down on
  // pointerup, pointercancel, window blur AND unmount (the sidebar hook's
  // discipline; the inline handler leaked all of them on a mid-drag unmount).
  it("pointer-drag maps the pointer X onto a horizontal fraction", () => {
    const onResize = vi.fn();
    render(
      <div>
        <SplitDivider fraction={0.5} onResize={onResize} />
      </div>,
    );
    const sep = screen.getByRole("separator");
    mockParentRect(sep, { left: 0, width: 200 });

    fireEvent.pointerDown(sep, { button: 0, pointerId: 1 });
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    fireEvent.pointerMove(document, { clientX: 50, pointerId: 1 }); // 50/200 = 0.25
    expect(onResize).toHaveBeenLastCalledWith(0.25);
    fireEvent.pointerMove(document, { clientX: 150, pointerId: 1 }); // 150/200 = 0.75
    expect(onResize).toHaveBeenLastCalledWith(0.75);
    fireEvent.pointerUp(document, { pointerId: 1 });
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    // After pointerup the listener is detached — further moves are ignored.
    onResize.mockClear();
    fireEvent.pointerMove(document, { clientX: 20, pointerId: 1 });
    expect(onResize).not.toHaveBeenCalled();
  });

  // Audit R2 (#568): the document listeners see EVERY pointer, so a session
  // that does not check the id is resized and ended by a second finger.
  it("ignores a second pointer's move and pointerup mid-drag", () => {
    const onResize = vi.fn();
    render(
      <div>
        <SplitDivider fraction={0.5} onResize={onResize} />
      </div>,
    );
    const sep = screen.getByRole("separator");
    mockParentRect(sep, { left: 0, width: 200 });

    fireEvent.pointerDown(sep, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 20, pointerId: 2 });
    expect(onResize).not.toHaveBeenCalled();
    fireEvent.pointerUp(document, { pointerId: 2 });
    // The first pointer still owns the drag.
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent.pointerMove(document, { clientX: 50, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(0.25);
    fireEvent.pointerUp(document, { pointerId: 1 });
    expect(document.body.style.cursor).toBe("");
  });

  // #567: `x / 0` is Infinity and `0 / 0` is NaN, and paneStore's clamp
  // (Math.min/Math.max) propagates NaN rather than bounding it.
  it("installs no drag session for a zero-width parent", () => {
    const onResize = vi.fn();
    render(
      <div>
        <SplitDivider fraction={0.5} onResize={onResize} />
      </div>,
    );
    const sep = screen.getByRole("separator");
    mockParentRect(sep, { left: 0, width: 0 });

    fireEvent.pointerDown(sep, { button: 0, pointerId: 1 });
    expect(document.body.style.cursor).toBe("");
    fireEvent.pointerMove(document, { clientX: 50, pointerId: 1 });
    expect(onResize).not.toHaveBeenCalled();
  });

  // #569: the consumer passes an inline arrow, so onResize's identity changes
  // on the re-render every move causes — a captured one goes stale at once.
  it("a drag in flight calls the LATEST onResize", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <div>
        <SplitDivider fraction={0.5} onResize={first} />
      </div>,
    );
    const sep = screen.getByRole("separator");
    mockParentRect(sep, { left: 0, width: 200 });

    fireEvent.pointerDown(sep, { button: 0, pointerId: 1 });
    rerender(
      <div>
        <SplitDivider fraction={0.5} onResize={second} />
      </div>,
    );
    fireEvent.pointerMove(document, { clientX: 50, pointerId: 1 });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(0.25);
  });

  // #566: an unmount with no drag in progress used to clear the cursor and
  // user-select some OTHER resizer had set.
  it("unmounting with no drag in progress leaves the body styles alone", () => {
    const { unmount } = render(
      <div>
        <SplitDivider fraction={0.5} onResize={vi.fn()} />
      </div>,
    );
    document.body.style.cursor = "col-resize"; // another resizer owns these
    document.body.style.userSelect = "none";
    unmount();
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  // #570: a blur-ended drag never reaches the pointerup that would have
  // released the capture implicitly.
  it("releases the pointer capture when the drag ends on blur", () => {
    const release = vi.fn();
    render(
      <div>
        <SplitDivider fraction={0.5} onResize={vi.fn()} />
      </div>,
    );
    const sep = screen.getByRole("separator");
    mockParentRect(sep, { left: 0, width: 200 });
    sep.setPointerCapture = vi.fn();
    sep.hasPointerCapture = () => true;
    sep.releasePointerCapture = release;

    fireEvent.pointerDown(sep, { button: 0, pointerId: 1 });
    expect(sep.setPointerCapture).toHaveBeenCalledWith(1);
    fireEvent.blur(window);
    expect(release).toHaveBeenCalledWith(1);
  });

  it("a non-primary button does not start a drag", () => {
    const onResize = vi.fn();
    render(
      <div>
        <SplitDivider fraction={0.5} onResize={onResize} />
      </div>,
    );
    const sep = screen.getByRole("separator");
    mockParentRect(sep, { left: 0, width: 200 });

    fireEvent.pointerDown(sep, { button: 2, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 50 });
    expect(onResize).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
  });

  it("losing the window mid-drag ends it", () => {
    const onResize = vi.fn();
    render(
      <div>
        <SplitDivider fraction={0.5} onResize={onResize} />
      </div>,
    );
    const sep = screen.getByRole("separator");
    mockParentRect(sep, { left: 0, width: 200 });

    fireEvent.pointerDown(sep, { button: 0, pointerId: 1 });
    fireEvent.blur(window);
    expect(document.body.style.userSelect).toBe("");
    fireEvent.pointerMove(document, { clientX: 50 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("unmounting mid-drag (closing the split) detaches the listeners and restores the body", () => {
    const onResize = vi.fn();
    const { unmount } = render(
      <div>
        <SplitDivider fraction={0.5} onResize={onResize} />
      </div>,
    );
    const sep = screen.getByRole("separator");
    mockParentRect(sep, { left: 0, width: 200 });

    fireEvent.pointerDown(sep, { button: 0, pointerId: 1 });
    unmount();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    fireEvent.pointerMove(document, { clientX: 50 });
    fireEvent.pointerUp(document);
    expect(onResize).not.toHaveBeenCalled();
  });
});
