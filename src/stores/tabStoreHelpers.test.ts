/**
 * Unit tests for tabStore's pure helpers.
 *
 * The registry and i18n are mocked so the format-name fallback (an unregistered
 * id, a missing translation key) can be exercised deterministically — the real
 * registry is empty until app bootstrap and the real i18n resolves every key.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getFormatById = vi.fn();
const dispatchEditor = vi.fn();
vi.mock("@/lib/formats/registry", () => ({
  getFormatById: (...args: unknown[]) => getFormatById(...args),
  dispatchEditor: (...args: unknown[]) => dispatchEditor(...args),
}));

const t = vi.fn();
vi.mock("@/i18n", () => ({
  default: { t: (...args: unknown[]) => t(...args) },
}));

import { getLocalizedFormatName, updateTabById, removeTabAt, getTabTitle, applyPathUpdate } from "./tabStoreHelpers";
import type { Tab } from "./tabStoreTypes";

beforeEach(() => {
  getFormatById.mockReset();
  dispatchEditor.mockReset();
  t.mockReset();
});

describe("getLocalizedFormatName", () => {
  it("returns the translation when the key resolves", () => {
    getFormatById.mockReturnValue({ nameI18nKey: "format.json" });
    t.mockReturnValue("JSON");
    expect(getLocalizedFormatName("json")).toBe("JSON");
  });

  it("falls back to the format id when the format is unregistered", () => {
    getFormatById.mockReturnValue(undefined);
    expect(getLocalizedFormatName("json")).toBe("json");
  });

  it("falls back to the format id when the key echoes back WITHOUT its namespace", () => {
    // i18next returns the bare key ("format.json") on a miss, not the namespaced
    // one — guarding only "common:format.json" leaks the raw key into the toast.
    getFormatById.mockReturnValue({ nameI18nKey: "format.json" });
    t.mockImplementation((key: string) => key.replace(/^common:/, ""));
    expect(getLocalizedFormatName("json")).toBe("json");
  });

  it("falls back to the format id when the key echoes back WITH its namespace", () => {
    getFormatById.mockReturnValue({ nameI18nKey: "format.json" });
    t.mockImplementation((key: string) => key);
    expect(getLocalizedFormatName("json")).toBe("json");
  });
});

// #1224 — a tab's stored title is the file's REAL name, extension included.
// Hiding the extension is a display choice (utils/displayFileName); baking it
// into the store made `tab.title` disagree with disk for every consumer that
// is not the tab strip: the MCP session listing, hot-exit snapshots, the
// close-tab dialog.
describe("getTabTitle", () => {
  it("keeps the extension of a supported file", () => {
    expect(getTabTitle("/w/README.md")).toBe("README.md");
    expect(getTabTitle("/w/requirements.txt")).toBe("requirements.txt");
  });

  it("keeps the extension of a file VMark cannot open", () => {
    expect(getTabTitle("/w/App.vue")).toBe("App.vue");
  });

  it("falls back to the path itself when it has no file name", () => {
    expect(getTabTitle("/")).toBe("/");
  });

  it("numbers an untitled document off the translated base", () => {
    t.mockReturnValue("Untitled");
    expect(getTabTitle(null, 3)).toBe("Untitled-3");
    expect(getTabTitle(null)).toBe("Untitled");
  });
});

// A tab can go back to being untitled — `useDocumentState.setFilePath(null)`
// does exactly that on an unsaved-copy flow. `updateTabPath` only accepted a
// string, so that caller passed "", and the tab then claimed a file path of ""
// while its document said null. Hot-exit dedup and filtering key on the path,
// so the two stores disagreed about which tabs were file-backed.
describe("applyPathUpdate — clearing a path", () => {
  const docTab = (id: string): Tab => ({
    kind: "document",
    id,
    filePath: `/${id}.md`,
    title: `${id}.md`,
    isPinned: false,
    formatId: "markdown",
  });

  it("stores a real null, not an empty string", () => {
    const { tabs } = applyPathUpdate({ main: [docTab("a")] }, "a", null);
    const tab = tabs.main[0] as { filePath: string | null };
    expect(tab.filePath).toBeNull();
  });

  it("retitles the tab as untitled rather than to an empty label", () => {
    t.mockReturnValue("Untitled");
    const { tabs } = applyPathUpdate({ main: [docTab("a")] }, "a", null);
    expect(tabs.main[0].title).toBe("Untitled");
  });
});

describe("updateTabById", () => {
  const docTab = (id: string): Tab => ({
    kind: "document",
    id,
    filePath: `/${id}.md`,
    title: id,
    isPinned: false,
    formatId: "markdown",
  });

  it("applies the patch to the matching document tab", () => {
    const state = { tabs: { main: [docTab("a"), docTab("b")] } };
    const next = updateTabById(state, "b", { editingEnabled: true });
    const patched = next.tabs.main[1] as { editingEnabled?: boolean };
    expect(patched.editingEnabled).toBe(true);
  });

  it("keeps state identity when the id is unknown (no subscriber churn)", () => {
    const state = { tabs: { main: [docTab("a")] } };
    const next = updateTabById(state, "nope", { editingEnabled: true });
    expect(next.tabs).toBe(state.tabs);
    expect(next.tabs.main).toBe(state.tabs.main);
  });

  it("keeps state identity when the patch changes nothing", () => {
    const state = { tabs: { main: [{ ...docTab("a"), editingEnabled: true }] } };
    const next = updateTabById(state, "a", { editingEnabled: true });
    expect(next.tabs).toBe(state.tabs);
  });

  it("keeps untouched windows' array identity", () => {
    const state = { tabs: { main: [docTab("a")], other: [docTab("b")] } };
    const next = updateTabById(state, "a", { editingEnabled: true });
    expect(next.tabs.other).toBe(state.tabs.other);
    expect(next.tabs.main).not.toBe(state.tabs.main);
  });

  it("never patches a browser tab that shares the id", () => {
    const browser: Tab = { kind: "browser", id: "b1", url: "https://x.dev/", title: "x", isPinned: false };
    const state = { tabs: { main: [browser] } };
    const next = updateTabById(state, "b1", { formatId: "json" });
    expect(next.tabs).toBe(state.tabs);
  });
});

// WI-S0.14 — removeTabAt guards its index (project rule: never assume a key exists).
describe("removeTabAt — out-of-range is a no-op, not a crash", () => {
  const state = {
    tabs: { main: [{ id: "a" }, { id: "b" }] },
    activeTabId: { main: "a" },
  } as unknown as Parameters<typeof removeTabAt>[0];

  it("returns state unchanged for an index past the end", () => {
    expect(removeTabAt(state, "main", 5)).toBe(state);
  });

  it("returns state unchanged for a window that does not exist", () => {
    expect(removeTabAt(state, "ghost", 0)).toBe(state);
  });

  it("still removes a valid index", () => {
    const out = removeTabAt(state, "main", 0) as { tabs: { main: { id: string }[] } };
    expect(out.tabs.main.map((t) => t.id)).toEqual(["b"]);
  });
});
