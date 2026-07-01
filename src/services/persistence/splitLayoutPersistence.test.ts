import { describe, it, expect, beforeEach } from "vitest";
import {
  saveSplitLayout,
  loadSplitLayout,
  type SplitLayoutConfig,
} from "./splitLayoutPersistence";

const ROOT = "/Users/me/project";
const LAYOUT: SplitLayoutConfig = {
  orientation: "vertical",
  fraction: 0.4,
  syncScroll: true,
  secondaryPath: "/Users/me/project/b.md",
};

beforeEach(() => {
  localStorage.clear();
});

describe("splitLayoutPersistence (#1081 Phase 4)", () => {
  it("round-trips a saved layout", () => {
    saveSplitLayout(ROOT, LAYOUT);
    expect(loadSplitLayout(ROOT)).toEqual(LAYOUT);
  });

  it("returns null when nothing is persisted", () => {
    expect(loadSplitLayout(ROOT)).toBeNull();
  });

  it("clears the layout when saving null", () => {
    saveSplitLayout(ROOT, LAYOUT);
    saveSplitLayout(ROOT, null);
    expect(loadSplitLayout(ROOT)).toBeNull();
  });

  it("normalizes trailing slashes so save/load keys match", () => {
    saveSplitLayout(`${ROOT}/`, LAYOUT);
    expect(loadSplitLayout(ROOT)).toEqual(LAYOUT);
  });

  it("keeps layouts for different roots independent", () => {
    saveSplitLayout(ROOT, LAYOUT);
    expect(loadSplitLayout("/other/root")).toBeNull();
  });

  it("returns null for a malformed persisted value", () => {
    localStorage.setItem(`vmark-split-layout:${ROOT}`, "{not json");
    expect(loadSplitLayout(ROOT)).toBeNull();
  });

  it("returns null when a required field has the wrong type", () => {
    localStorage.setItem(
      `vmark-split-layout:${ROOT}`,
      JSON.stringify({ ...LAYOUT, fraction: "nope" }),
    );
    expect(loadSplitLayout(ROOT)).toBeNull();
  });

  it("rejects an unknown orientation value", () => {
    localStorage.setItem(
      `vmark-split-layout:${ROOT}`,
      JSON.stringify({ ...LAYOUT, orientation: "diagonal" }),
    );
    expect(loadSplitLayout(ROOT)).toBeNull();
  });
});
