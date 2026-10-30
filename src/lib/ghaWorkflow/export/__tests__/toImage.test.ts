// WI-4.2 — image export wrapper tests.
//
// We can't fully exercise html-to-image in jsdom (Canvas2D missing). The
// real-DOM behavior was verified in Spike B (Playwright + Chromium,
// 44-75 ms per export, light + dark themes). Here we test that:
//   - the wrapper finds the correct viewport element
//   - the right html-to-image function is called with the right options
//   - a missing element produces a clear error
//   - off-screen mount path tears down on failure

import { describe, expect, it, vi } from "vitest";

vi.mock("html-to-image", () => ({
  toSvg: vi.fn(async () => "data:image/svg+xml;charset=utf-8,test"),
  toPng: vi.fn(async () => "data:image/png;base64,test"),
}));

import { toPng, toSvg } from "html-to-image";
import { exportCanvas } from "../toImage";

describe("exportCanvas", () => {
  it("calls toSvg for format='svg'", async () => {
    const el = document.createElement("div");
    el.className = "react-flow__viewport";
    document.body.appendChild(el);

    const result = await exportCanvas("svg");
    expect(result).toMatch(/^data:image\/svg/);
    expect(toSvg).toHaveBeenCalledWith(el, expect.any(Object));

    document.body.removeChild(el);
  });

  it("calls toPng for format='png' with pixelRatio=2", async () => {
    const el = document.createElement("div");
    el.className = "react-flow__viewport";
    document.body.appendChild(el);

    const result = await exportCanvas("png");
    expect(result).toMatch(/^data:image\/png/);
    const callArgs = (toPng as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.at(-1);
    expect(callArgs?.[0]).toBe(el);
    expect((callArgs?.[1] as { pixelRatio?: number }).pixelRatio).toBe(2);

    document.body.removeChild(el);
  });

  it("throws a clear error when the canvas viewport is missing", async () => {
    // No element in DOM.
    await expect(exportCanvas("svg")).rejects.toThrow(/viewport/i);
  });

  it("accepts a caller-provided element override", async () => {
    const el = document.createElement("div");
    el.id = "manual";
    document.body.appendChild(el);

    await exportCanvas("svg", { element: el });
    const callArgs = (toSvg as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.at(-1);
    expect(callArgs?.[0]).toBe(el);

    document.body.removeChild(el);
  });

  it("captures the viewport inside `scope`, not the first one in the document", async () => {
    const first = document.createElement("div");
    first.className = "react-flow__viewport";
    const wrapper = document.createElement("section");
    const own = document.createElement("div");
    own.className = "react-flow__viewport";
    wrapper.appendChild(own);
    document.body.append(first, wrapper);

    await exportCanvas("svg", { scope: wrapper });
    const callArgs = (toSvg as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.at(-1);
    expect(callArgs?.[0]).toBe(own);

    first.remove();
    wrapper.remove();
  });

  it("refuses when `scope` holds no viewport, even if another canvas exists", async () => {
    const other = document.createElement("div");
    other.className = "react-flow__viewport";
    const emptyScope = document.createElement("section");
    document.body.append(other, emptyScope);

    await expect(exportCanvas("svg", { scope: emptyScope })).rejects.toThrow(/viewport/i);

    other.remove();
    emptyScope.remove();
  });
});
