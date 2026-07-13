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

import { getLocalizedFormatName, updateTabById } from "./tabStoreHelpers";
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
