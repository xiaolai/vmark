import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SplitDivider } from "./SplitDivider";

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
});
