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
    render(<SplitDivider orientation="horizontal" fraction={0.42} onResize={vi.fn()} />);
    const sep = screen.getByRole("separator");
    expect(sep).toHaveAttribute("aria-orientation", "vertical"); // left|right ⇒ vertical bar
    expect(sep).toHaveAttribute("aria-valuenow", "42");
    expect(sep).toHaveAttribute("tabindex", "0");
  });

  it("uses a horizontal bar for a vertical (top/bottom) split", () => {
    render(<SplitDivider orientation="vertical" fraction={0.5} onResize={vi.fn()} />);
    expect(screen.getByRole("separator")).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("resizes with arrow keys, clamped via the parent's onResize", () => {
    const onResize = vi.fn();
    render(<SplitDivider orientation="horizontal" fraction={0.5} onResize={onResize} />);
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

  it("maps Up/Down to resize for a vertical split", () => {
    const onResize = vi.fn();
    render(<SplitDivider orientation="vertical" fraction={0.5} onResize={onResize} />);
    const sep = screen.getByRole("separator");
    fireEvent.keyDown(sep, { key: "ArrowDown" });
    expect(onResize).toHaveBeenLastCalledWith(0.55);
    fireEvent.keyDown(sep, { key: "ArrowUp" });
    expect(onResize).toHaveBeenLastCalledWith(0.45);
  });

  it("mouse-drag maps the pointer X onto a horizontal fraction", () => {
    const onResize = vi.fn();
    render(
      <div>
        <SplitDivider orientation="horizontal" fraction={0.5} onResize={onResize} />
      </div>,
    );
    const sep = screen.getByRole("separator");
    mockParentRect(sep, { left: 0, width: 200 });

    fireEvent.mouseDown(sep);
    fireEvent.mouseMove(document, { clientX: 50 }); // 50/200 = 0.25
    expect(onResize).toHaveBeenLastCalledWith(0.25);
    fireEvent.mouseMove(document, { clientX: 150 }); // 150/200 = 0.75
    expect(onResize).toHaveBeenLastCalledWith(0.75);
    fireEvent.mouseUp(document);

    // After mouseup the listener is detached — further moves are ignored.
    onResize.mockClear();
    fireEvent.mouseMove(document, { clientX: 20 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("mouse-drag maps the pointer Y onto a vertical fraction", () => {
    const onResize = vi.fn();
    render(
      <div>
        <SplitDivider orientation="vertical" fraction={0.5} onResize={onResize} />
      </div>,
    );
    const sep = screen.getByRole("separator");
    mockParentRect(sep, { top: 0, height: 100 });

    fireEvent.mouseDown(sep);
    fireEvent.mouseMove(document, { clientY: 30 }); // 30/100 = 0.3
    expect(onResize).toHaveBeenLastCalledWith(0.3);
    fireEvent.mouseUp(document);
  });
});
