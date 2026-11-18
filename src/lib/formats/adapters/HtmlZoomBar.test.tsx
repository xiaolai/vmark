// Zoom controls for the standalone HTML preview (issue #1704).

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HtmlZoomBar } from "./HtmlZoomBar";
import {
  HTML_ZOOM_DEFAULT_PERCENT,
  HTML_ZOOM_MAX_PERCENT,
  HTML_ZOOM_MIN_PERCENT,
} from "./htmlZoom";

function renderBar(zoomPercent = HTML_ZOOM_DEFAULT_PERCENT) {
  const handlers = {
    onZoomOut: vi.fn(),
    onZoomIn: vi.fn(),
    onReset: vi.fn(),
  };
  render(<HtmlZoomBar zoomPercent={zoomPercent} {...handlers} />);
  return handlers;
}

describe("HtmlZoomBar", () => {
  it("shows the current zoom percentage", () => {
    renderBar(150);
    expect(screen.getByTestId("html-zoom-value").textContent).toBe("150%");
  });

  it("shows 100% at the default", () => {
    renderBar();
    expect(screen.getByTestId("html-zoom-value").textContent).toBe("100%");
  });

  it("invokes each control's handler", async () => {
    const user = userEvent.setup();
    const h = renderBar(150);

    await user.click(screen.getByRole("button", { name: /zoom out/i }));
    expect(h.onZoomOut).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(h.onZoomIn).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /reset zoom/i }));
    expect(h.onReset).toHaveBeenCalledTimes(1);
  });

  it("disables zoom out at the minimum", () => {
    renderBar(HTML_ZOOM_MIN_PERCENT);
    expect(screen.getByRole("button", { name: /zoom out/i })).toBeDisabled();
  });

  it("disables zoom in at the maximum", () => {
    renderBar(HTML_ZOOM_MAX_PERCENT);
    expect(screen.getByRole("button", { name: /zoom in/i })).toBeDisabled();
  });

  it("disables reset at the default zoom", () => {
    renderBar(HTML_ZOOM_DEFAULT_PERCENT);
    expect(screen.getByRole("button", { name: /reset zoom/i })).toBeDisabled();
  });

  it("enables reset once zoomed away from the default", () => {
    renderBar(130);
    expect(screen.getByRole("button", { name: /reset zoom/i })).toBeEnabled();
  });
});
