import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarkdownSplitView } from "./MarkdownSplitView";

function setup() {
  return render(
    <MarkdownSplitView
      source={<div data-testid="src">SOURCE</div>}
      preview={<div data-testid="prev">PREVIEW</div>}
    />,
  );
}

describe("MarkdownSplitView", () => {
  it("renders the source and preview panes side by side", () => {
    setup();
    expect(screen.getByTestId("src")).toBeInTheDocument();
    expect(screen.getByTestId("prev")).toBeInTheDocument();
  });

  it("exposes a keyboard-resizable separator that adjusts the source fraction", () => {
    const { container } = setup();
    const root = container.querySelector(".split-pane-editor") as HTMLElement;
    const handle = screen.getByRole("separator");
    const initial = root.style.getPropertyValue("--split-pane-source-fraction");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(root.style.getPropertyValue("--split-pane-source-fraction")).not.toBe(initial);
  });

  it("clamps to the min/max bounds with Home/End and updates aria-valuenow", () => {
    const { container } = setup();
    const root = container.querySelector(".split-pane-editor") as HTMLElement;
    const handle = screen.getByRole("separator");
    const read = () => root.style.getPropertyValue("--split-pane-source-fraction");

    fireEvent.keyDown(handle, { key: "End" });
    expect(read()).toBe("0.8");
    expect(handle).toHaveAttribute("aria-valuenow", "80");

    fireEvent.keyDown(handle, { key: "Home" });
    expect(read()).toBe("0.2");
    expect(handle).toHaveAttribute("aria-valuenow", "20");

    // ArrowRight past Home should step back up, staying within bounds.
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(Number(read())).toBeGreaterThan(0.2);
    expect(Number(read())).toBeLessThanOrEqual(0.8);
  });
});
