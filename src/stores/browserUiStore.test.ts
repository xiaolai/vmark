// @vitest-environment node
// WI-S1.1 — browserUiStore: transient per-tab browser nav UI state (urlInput, loading)
import { describe, it, expect, beforeEach } from "vitest";
import { useBrowserUiStore, type BrowserUiEntry } from "./browserUiStore";

beforeEach(() => {
  useBrowserUiStore.setState({ entries: {} });
});

/** The healthy seed for `ensureEntry(tab, url)`. */
function seeded(urlInput: string, generation = 0): BrowserUiEntry {
  return {
    urlInput,
    loading: true,
    canGoBack: false,
    canGoForward: false,
    frozen: false,
    error: null,
    blockedPopup: null,
    dialog: null,
    crash: null,
    generation,
  };
}

describe("browserUiStore", () => {
  it("seeds an entry with the initial url, loading=true, no history and generation 0", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://example.com/");
    expect(useBrowserUiStore.getState().entries["tab-1"]).toEqual(seeded("https://example.com/"));
  });

  it("seeds at the generation the caller already knows, when it knows one", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://example.com/", 5);
    expect(useBrowserUiStore.getState().entries["tab-1"]).toEqual(seeded("https://example.com/", 5));
  });

  // Audit 2026-09-03 X-03 — a blocked popup is recorded per tab, not discarded.
  it("records and clears the last blocked popup per tab", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://example.com/");
    useBrowserUiStore.getState().setBlockedPopup("tab-1", { url: "https://auth.example/login", at: 42 });
    expect(useBrowserUiStore.getState().entries["tab-1"].blockedPopup).toEqual({
      url: "https://auth.example/login",
      at: 42,
    });
    useBrowserUiStore.getState().setBlockedPopup("tab-1", null);
    expect(useBrowserUiStore.getState().entries["tab-1"].blockedPopup).toBeNull();
    // Guarded: an unknown tab is a no-op.
    useBrowserUiStore.getState().setBlockedPopup("nope", { url: "x", at: 1 });
    expect(useBrowserUiStore.getState().entries["nope"]).toBeUndefined();
  });

  // WI-S1.6 (Codex re-review D3#5): back/forward shipped as always-enabled no-ops.
  it("setHistory records the webview's back/forward state", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().setHistory("tab-1", true, false);
    const entry = useBrowserUiStore.getState().entries["tab-1"];
    expect(entry.canGoBack).toBe(true);
    expect(entry.canGoForward).toBe(false);
  });

  it("setHistory on a missing tab is a no-op", () => {
    useBrowserUiStore.getState().setHistory("ghost", true, true);
    expect(useBrowserUiStore.getState().entries["ghost"]).toBeUndefined();
  });

  // WI-SOC.1b — the frozen flag is what lets BrowserSurface paint an opaque
  // placeholder where the hidden native view used to be, so an overlay never
  // composites over a blank hole.
  it("seeds a tab as not frozen", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    expect(useBrowserUiStore.getState().entries["tab-1"].frozen).toBe(false);
  });

  it("setFrozen records that the native view is hidden", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().setFrozen("tab-1", true);
    expect(useBrowserUiStore.getState().entries["tab-1"].frozen).toBe(true);
    useBrowserUiStore.getState().setFrozen("tab-1", false);
    expect(useBrowserUiStore.getState().entries["tab-1"].frozen).toBe(false);
  });

  it("setFrozen on a missing tab is a no-op", () => {
    useBrowserUiStore.getState().setFrozen("ghost", true);
    expect(useBrowserUiStore.getState().entries["ghost"]).toBeUndefined();
  });

  // WI-S0.9 — every browser command used to `.catch(() => {})`, so a failed create or
  // navigate left a blank viewport and a stale URL with no signal at all. Silence is
  // the worst possible report: the user cannot tell a slow page from a dead one.
  it("seeds a tab with no error", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    expect(useBrowserUiStore.getState().entries["tab-1"].error).toBeNull();
  });

  it("setError records a failure, and clears it when the next load starts", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().setError("tab-1", "offline");
    expect(useBrowserUiStore.getState().entries["tab-1"].error).toBe("offline");
    useBrowserUiStore.getState().setError("tab-1", null);
    expect(useBrowserUiStore.getState().entries["tab-1"].error).toBeNull();
  });

  it("a failure also stops the spinner — a dead load is not a loading one", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().setError("tab-1", "boom");
    expect(useBrowserUiStore.getState().entries["tab-1"].loading).toBe(false);
  });

  it("setError on a missing tab is a no-op", () => {
    useBrowserUiStore.getState().setError("ghost", "boom");
    expect(useBrowserUiStore.getState().entries["ghost"]).toBeUndefined();
  });

  it("ensureEntry does not clobber an existing entry", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://example.com/");
    useBrowserUiStore.getState().setUrlInput("tab-1", "https://edited.com/");
    useBrowserUiStore.getState().setLoading("tab-1", false);
    // Second ensure with a different seed must be a no-op for an existing tab.
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://other.com/", 9);
    expect(useBrowserUiStore.getState().entries["tab-1"]).toEqual({
      ...seeded("https://edited.com/"),
      loading: false,
    });
  });

  it("setUrlInput updates only that tab's input", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().ensureEntry("tab-2", "https://b.com/");
    useBrowserUiStore.getState().setUrlInput("tab-1", "https://a2.com/");
    expect(useBrowserUiStore.getState().entries["tab-1"].urlInput).toBe("https://a2.com/");
    expect(useBrowserUiStore.getState().entries["tab-2"].urlInput).toBe("https://b.com/");
  });

  it("setLoading toggles the loading flag", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().setLoading("tab-1", false);
    expect(useBrowserUiStore.getState().entries["tab-1"].loading).toBe(false);
  });

  it("setUrlInput on a missing tab is a no-op (guards keyed state)", () => {
    useBrowserUiStore.getState().setUrlInput("ghost", "https://x.com/");
    expect(useBrowserUiStore.getState().entries["ghost"]).toBeUndefined();
  });

  it("setLoading on a missing tab is a no-op", () => {
    useBrowserUiStore.getState().setLoading("ghost", true);
    expect(useBrowserUiStore.getState().entries["ghost"]).toBeUndefined();
  });

  it("clearForTab removes the entry", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().clearForTab("tab-1");
    expect(useBrowserUiStore.getState().entries["tab-1"]).toBeUndefined();
  });

  it("clearForTab on a missing tab is a no-op", () => {
    expect(() => useBrowserUiStore.getState().clearForTab("ghost")).not.toThrow();
  });
  it("clearForTab on a prototype-named tab is a no-op, not a lookup up the chain (#155)", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    const before = useBrowserUiStore.getState().entries;
    useBrowserUiStore.getState().clearForTab("constructor");
    useBrowserUiStore.getState().clearForTab("toString");
    expect(useBrowserUiStore.getState().entries).toBe(before);
  });
});

// Audit 2026-09-03 round 3 (#154): the entry carries the page GENERATION, and every
// mutator that mirrors page state accepts it. Nav events cross the IPC boundary and
// can arrive out of order; a late `loaded` for a page the tab has left used to rewrite
// the omnibox and spinner because the store itself could not tell it was stale — only
// the handler in browserTabEvents guarded it, and only the tab record refused it.
describe("browserUiStore — generation-aware mutators", () => {
  const TAB = "tab-1";
  type Stamped = (generation?: number) => void;
  /** Every mutator that carries page state, invoked at `generation`. */
  const mutators: Array<[string, Stamped, (entry: BrowserUiEntry) => unknown, unknown]> = [
    ["setUrlInput", (g) => useBrowserUiStore.getState().setUrlInput(TAB, "https://late.example/", g), (e) => e.urlInput, "https://late.example/"],
    ["setLoading", (g) => useBrowserUiStore.getState().setLoading(TAB, false, g), (e) => e.loading, false],
    ["setHistory", (g) => useBrowserUiStore.getState().setHistory(TAB, true, true, g), (e) => e.canGoBack, true],
    ["setError", (g) => useBrowserUiStore.getState().setError(TAB, "late failure", g), (e) => e.error, "late failure"],
    ["setBlockedPopup", (g) => useBrowserUiStore.getState().setBlockedPopup(TAB, { url: "https://p.example/", at: 1 }, g), (e) => e.blockedPopup, { url: "https://p.example/", at: 1 }],
    ["setDialog", (g) => useBrowserUiStore.getState().setDialog(TAB, { kind: "alert", message: "late" }, g), (e) => e.dialog, { kind: "alert", message: "late" }],
    ["setCrash", (g) => useBrowserUiStore.getState().setCrash(TAB, { action: "manual" }, g), (e) => e.crash, { action: "manual" }],
  ];

  beforeEach(() => {
    useBrowserUiStore.getState().ensureEntry(TAB, "https://current.example/");
    useBrowserUiStore.getState().setUrlInput(TAB, "https://current.example/", 3);
  });

  it.each(mutators)("%s stamped with an OLDER generation is rejected whole, and the entry keeps its identity", (_name, apply, read, value) => {
    const before = useBrowserUiStore.getState().entries[TAB];
    apply(2);
    const after = useBrowserUiStore.getState().entries[TAB];
    expect(after).toBe(before);
    expect(read(after)).not.toEqual(value);
    expect(after.generation).toBe(3);
  });

  it.each(mutators)("%s stamped with the CURRENT generation applies and holds the generation", (_name, apply, read, value) => {
    apply(3);
    const entry = useBrowserUiStore.getState().entries[TAB];
    expect(read(entry)).toEqual(value);
    expect(entry.generation).toBe(3);
  });

  it.each(mutators)("%s stamped with a NEWER generation applies and advances the entry to it", (_name, apply, read, value) => {
    apply(7);
    const entry = useBrowserUiStore.getState().entries[TAB];
    expect(read(entry)).toEqual(value);
    expect(entry.generation).toBe(7);
  });

  it.each(mutators)("%s without a generation applies (a user edit, a command, a dialog) and moves nothing", (_name, apply, read, value) => {
    apply();
    const entry = useBrowserUiStore.getState().entries[TAB];
    expect(read(entry)).toEqual(value);
    expect(entry.generation).toBe(3);
  });

  it("the generation is monotonic: once advanced, the older stamp that arrives late is refused", () => {
    useBrowserUiStore.getState().setUrlInput(TAB, "https://next.example/", 4);
    useBrowserUiStore.getState().setLoading(TAB, true, 4);
    // The previous page finishes late, stamped with ITS generation.
    useBrowserUiStore.getState().setUrlInput(TAB, "https://current.example/", 3);
    useBrowserUiStore.getState().setLoading(TAB, false, 3);
    expect(useBrowserUiStore.getState().entries[TAB]).toMatchObject({
      urlInput: "https://next.example/",
      loading: true,
      generation: 4,
    });
  });

  it("a stale stamped error does not stop the current page's spinner", () => {
    useBrowserUiStore.getState().setLoading(TAB, true, 3);
    useBrowserUiStore.getState().setError(TAB, "old page died", 2);
    expect(useBrowserUiStore.getState().entries[TAB]).toMatchObject({ loading: true, error: null });
  });

  it("a stamped mutator on a prototype-named tab is a no-op, not a lookup up the chain", () => {
    const before = useBrowserUiStore.getState().entries;
    useBrowserUiStore.getState().setUrlInput("constructor", "https://x.example/", 1);
    useBrowserUiStore.getState().setLoading("toString", false, 1);
    expect(useBrowserUiStore.getState().entries).toBe(before);
  });
});
