// @vitest-environment node
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
  primaryPath: "/Users/me/project/a.md",
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

  it("returns null when primaryPath is missing (legacy secondary-only value)", () => {
    localStorage.setItem(
      `vmark-split-layout:${ROOT}`,
      JSON.stringify({
        orientation: "vertical",
        fraction: 0.4,
        syncScroll: true,
        secondaryPath: "/Users/me/project/b.md",
      }),
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

// WI-17.2 — stable-root keying: layouts key by workspace root identity, so
// alternate spellings of one Windows root share one layout, while macOS/Linux
// stay byte-exact. Legacy raw-path keys migrate on load.
describe("splitLayoutPersistence stable-root keying (WI-17.2)", () => {
  it("windows: alternate case/separator spelling loads the same layout", () => {
    saveSplitLayout("C:\\Repo", LAYOUT, "windows");
    expect(loadSplitLayout("c:/repo", "windows")).toEqual(LAYOUT);
  });

  it("macos: alternate casing is a different key (byte-exact)", () => {
    saveSplitLayout("/Users/me/Project", LAYOUT, "macos");
    expect(loadSplitLayout("/users/me/project", "macos")).toBeNull();
  });

  it("migrates a legacy raw-path key on load", () => {
    localStorage.setItem(`vmark-split-layout:${ROOT}`, JSON.stringify(LAYOUT));

    expect(loadSplitLayout(ROOT)).toEqual(LAYOUT);
    // Migrated: legacy key removed, stable key present, second load still works.
    expect(localStorage.getItem(`vmark-split-layout:${ROOT}`)).toBeNull();
    expect(loadSplitLayout(ROOT)).toEqual(LAYOUT);
  });

  it("does not migrate a malformed legacy value", () => {
    localStorage.setItem(`vmark-split-layout:${ROOT}`, "{not json");
    expect(loadSplitLayout(ROOT)).toBeNull();
    expect(localStorage.getItem(`vmark-split-layout:${ROOT}`)).toBe("{not json");
  });

  it("saving removes a stale legacy key for the same root", () => {
    localStorage.setItem(`vmark-split-layout:${ROOT}`, JSON.stringify(LAYOUT));
    saveSplitLayout(ROOT, { ...LAYOUT, fraction: 0.7 });
    expect(localStorage.getItem(`vmark-split-layout:${ROOT}`)).toBeNull();
    expect(loadSplitLayout(ROOT)?.fraction).toBe(0.7);
  });
});
