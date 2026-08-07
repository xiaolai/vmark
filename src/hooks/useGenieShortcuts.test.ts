// @vitest-environment node
/**
 * Tests for the getMenuShortcuts helper in useGenieShortcuts.
 *
 * Closes #869: getMenuShortcuts is critical to genie menu sync, but was
 * previously untested. The three-way `null | {} | { ... }` contract that
 * `getMenuShortcuts` reports to `dynamic.rs` is non-obvious.
 *
 * Scope: only the pure helper — useEffect blocks and `loadAndSyncMenu` are
 * out of scope here. `detectScope` moved to genieCommands.ts (covered in
 * genieCommands.test.ts); the menu:invoke-genie effect is covered in
 * useGenieShortcuts.invokeGenie.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks must be hoisted above the SUT import.
const getAllShortcutsMock = vi.fn<() => Record<string, string>>();
const prosemirrorToTauriMock = vi.fn<(key: string) => string>(
  (key: string) => `TAURI(${key})`,
);

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: () => ({ markdown: {} }), subscribe: () => () => {} },
  useShortcutsStore: {
    getState: () => ({
      getAllShortcuts: getAllShortcutsMock,
    }),
  },
  prosemirrorToTauri: (key: string) => prosemirrorToTauriMock(key),
}));

// Import AFTER mocks so the SUT picks up the mocked stores.
import { getMenuShortcuts } from "./useGenieShortcuts";

beforeEach(() => {
  getAllShortcutsMock.mockReset();
  prosemirrorToTauriMock.mockReset();
  prosemirrorToTauriMock.mockImplementation((key: string) => `TAURI(${key})`);
});

describe("getMenuShortcuts", () => {
  it("returns null when aiPrompts is missing from the store", () => {
    // null/undefined value in the shortcuts map → use backend default.
    getAllShortcutsMock.mockReturnValue({});
    expect(getMenuShortcuts()).toBeNull();
  });

  it("returns null when aiPrompts is explicitly null", () => {
    // Same path as missing — `key == null` catches both null and undefined.
    getAllShortcutsMock.mockReturnValue({ aiPrompts: null as unknown as string });
    expect(getMenuShortcuts()).toBeNull();
  });

  it("treats explicit empty string as 'unbound' and forwards via prosemirrorToTauri", () => {
    // `"" == null` is false, so empty string falls through to the
    // prosemirrorToTauri path. The downstream Rust side reads this as
    // "explicitly unbound" per `dynamic.rs` line 220.
    getAllShortcutsMock.mockReturnValue({ aiPrompts: "" });
    expect(getMenuShortcuts()).toEqual({ "search-genies": "TAURI()" });
  });

  it("forwards a set accelerator through prosemirrorToTauri", () => {
    getAllShortcutsMock.mockReturnValue({ aiPrompts: "Mod-y" });
    expect(getMenuShortcuts()).toEqual({ "search-genies": "TAURI(Mod-y)" });
    expect(prosemirrorToTauriMock).toHaveBeenCalledWith("Mod-y");
  });

  it("returns null when getAllShortcuts throws", () => {
    // The catch block is the safety net — a malformed store should not
    // brick the menu sync, just fall back to the backend default.
    getAllShortcutsMock.mockImplementation(() => {
      throw new Error("store boom");
    });
    expect(getMenuShortcuts()).toBeNull();
  });
});
