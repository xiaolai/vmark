import { describe, expect, it } from "vitest";
import {
  HTML_ZOOM_DEFAULT_PERCENT,
  HTML_ZOOM_MAX_PERCENT,
  HTML_ZOOM_MIN_PERCENT,
  HTML_ZOOM_STEP_PERCENT,
  stepZoomPercent,
} from "./htmlZoom";

describe("htmlZoom", () => {
  it("steps in by one increment from the default", () => {
    expect(stepZoomPercent(HTML_ZOOM_DEFAULT_PERCENT, 1)).toBe(110);
  });

  it("steps out by one increment from the default", () => {
    expect(stepZoomPercent(HTML_ZOOM_DEFAULT_PERCENT, -1)).toBe(90);
  });

  it("clamps at the minimum", () => {
    expect(stepZoomPercent(HTML_ZOOM_MIN_PERCENT, -1)).toBe(HTML_ZOOM_MIN_PERCENT);
  });

  it("clamps at the maximum", () => {
    expect(stepZoomPercent(HTML_ZOOM_MAX_PERCENT, 1)).toBe(HTML_ZOOM_MAX_PERCENT);
  });

  it("steps by the configured increment anywhere in range", () => {
    expect(HTML_ZOOM_STEP_PERCENT).toBe(10);
    expect(stepZoomPercent(250, 1)).toBe(260);
    expect(stepZoomPercent(250, -1)).toBe(240);
  });
});
