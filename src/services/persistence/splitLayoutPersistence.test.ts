// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import {
  saveSplitLayout,
  loadSplitLayout,
  type SplitLayoutConfig,
} from "./splitLayoutPersistence";

const ROOT = "/Users/me/project";
const LAYOUT_PLATFORM_WINDOWS = "windows" as const;
const LAYOUT: SplitLayoutConfig = {
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

  it("ignores a legacy orientation field — a persisted vertical split loads as the one side-by-side layout (WI-FL3.10)", () => {
    localStorage.setItem(
      `vmark-split-layout:${ROOT}`,
      JSON.stringify({ ...LAYOUT, orientation: "vertical" }),
    );
    expect(loadSplitLayout(ROOT)).toEqual(LAYOUT);
  });

  // Audit 20260907 (#482): a well-typed record can still be malformed — a NaN
  // or Infinity fraction, a fraction outside the pane clamp, an empty pane path,
  // or the same path in both panes — and restore used to accept all of them.
  it("rejects a non-finite fraction (JSON has no NaN, but 1e999 parses to Infinity)", () => {
    for (const literal of ["1e999", "-1e999"]) {
      const raw = JSON.stringify(LAYOUT).replace('"fraction":0.4', `"fraction":${literal}`);
      expect(JSON.parse(raw).fraction).not.toBeNaN();
      expect(Number.isFinite(JSON.parse(raw).fraction)).toBe(false);
      localStorage.setItem(`vmark-split-layout:${ROOT}`, raw);
      expect(loadSplitLayout(ROOT)).toBeNull();
    }
  });

  it("clamps an out-of-range fraction into the pane bounds", () => {
    localStorage.setItem(`vmark-split-layout:${ROOT}`, JSON.stringify({ ...LAYOUT, fraction: 0.01 }));
    expect(loadSplitLayout(ROOT)?.fraction).toBe(0.2);
    localStorage.clear(); // the load above migrated the legacy key to the stable one
    localStorage.setItem(`vmark-split-layout:${ROOT}`, JSON.stringify({ ...LAYOUT, fraction: 7 }));
    expect(loadSplitLayout(ROOT)?.fraction).toBe(0.8);
  });

  it("rejects an empty pane path", () => {
    localStorage.setItem(`vmark-split-layout:${ROOT}`, JSON.stringify({ ...LAYOUT, primaryPath: "" }));
    expect(loadSplitLayout(ROOT)).toBeNull();
    localStorage.setItem(`vmark-split-layout:${ROOT}`, JSON.stringify({ ...LAYOUT, secondaryPath: "  " }));
    expect(loadSplitLayout(ROOT)).toBeNull();
  });

  it("rejects the same path in both panes", () => {
    localStorage.setItem(
      `vmark-split-layout:${ROOT}`,
      JSON.stringify({ ...LAYOUT, secondaryPath: LAYOUT.primaryPath }),
    );
    expect(loadSplitLayout(ROOT)).toBeNull();
  });

  // Round 3: the two pane paths were compared as RAW strings, so two spellings
  // of one file passed — and the restore then showed that document twice, the
  // A/A split `toggleSplitDocuments` (D9) and `resolveWindowSplit` both refuse.
  // The comparison uses the same platform identity the ROOT key already uses.
  it("windows: rejects two spellings of one pane file", () => {
    localStorage.setItem(
      "vmark-split-layout:id:path:windows:c:\\repo",
      JSON.stringify({
        ...LAYOUT,
        primaryPath: "C:\\Repo\\a.md",
        secondaryPath: "c:/repo/a.md",
      }),
    );
    expect(loadSplitLayout("C:\\Repo", LAYOUT_PLATFORM_WINDOWS)).toBeNull();
  });

  it("windows: keeps two genuinely different pane files", () => {
    const layout = {
      ...LAYOUT,
      primaryPath: "C:\\Repo\\a.md",
      secondaryPath: "c:/repo/b.md",
    };
    saveSplitLayout("C:\\Repo", layout, LAYOUT_PLATFORM_WINDOWS);
    expect(loadSplitLayout("C:\\Repo", LAYOUT_PLATFORM_WINDOWS)).toEqual(layout);
  });

  it("macos: a case-different pane path is a DIFFERENT file, and stays", () => {
    // Byte-exact on POSIX, exactly as the root key is (WI-17.2).
    const layout = { ...LAYOUT, secondaryPath: "/Users/me/project/A.md" };
    saveSplitLayout(ROOT, layout, "macos");
    expect(loadSplitLayout(ROOT, "macos")).toEqual(layout);
  });

  it("rejects a trailing-separator spelling of the same pane file", () => {
    localStorage.setItem(
      `vmark-split-layout:${ROOT}`,
      JSON.stringify({ ...LAYOUT, secondaryPath: `${LAYOUT.primaryPath}/` }),
    );
    expect(loadSplitLayout(ROOT)).toBeNull();
  });

  it("drops unknown fields rather than carrying them into the restored layout", () => {
    localStorage.setItem(
      `vmark-split-layout:${ROOT}`,
      JSON.stringify({ ...LAYOUT, orientation: "diagonal", stray: 1 }),
    );
    expect(loadSplitLayout(ROOT)).toEqual(LAYOUT);
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
