/**
 * Tests for popupHostDom — generic popup host/coordinate helpers.
 * Moved from plugins/sourcePopup/sourcePopupUtils.test.ts with the
 * functions they cover (WI-8).
 */

import { describe, it, expect } from "vitest";
import { getPopupHostForDom, toHostCoordsForDom } from "./popupHostDom";

describe("getPopupHostForDom", () => {
  it("returns null for null dom", () => {
    expect(getPopupHostForDom(null)).toBeNull();
  });

  it("returns editor-container when present", () => {
    const container = document.createElement("div");
    container.className = "editor-container";
    const child = document.createElement("div");
    container.appendChild(child);
    expect(getPopupHostForDom(child)).toBe(container);
  });

  it("returns parentElement when no editor-container", () => {
    const parent = document.createElement("div");
    const child = document.createElement("div");
    parent.appendChild(child);
    expect(getPopupHostForDom(child)).toBe(parent);
  });

  it("returns null for a detached element with no parent", () => {
    const orphan = document.createElement("div");
    expect(getPopupHostForDom(orphan)).toBeNull();
  });
});

describe("toHostCoordsForDom", () => {
  it("converts viewport coordinates to host-relative", () => {
    const host = document.createElement("div");
    host.getBoundingClientRect = () => ({
      top: 100, left: 50, bottom: 500, right: 800, width: 750, height: 400,
      x: 50, y: 100, toJSON: () => ({}),
    });
    Object.defineProperty(host, "scrollTop", { value: 10, configurable: true });
    Object.defineProperty(host, "scrollLeft", { value: 5, configurable: true });

    const result = toHostCoordsForDom(host, { top: 200, left: 150 });
    expect(result.top).toBe(200 - 100 + 10);  // 110
    expect(result.left).toBe(150 - 50 + 5);   // 105
  });

  it("passes coordinates through for a zero-rect host with no scroll", () => {
    const host = document.createElement("div");
    const result = toHostCoordsForDom(host, { top: 42, left: 7 });
    expect(result).toEqual({ top: 42, left: 7 });
  });
});
