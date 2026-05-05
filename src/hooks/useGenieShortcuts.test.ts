/**
 * Tests for the two pure helpers in useGenieShortcuts.
 *
 * Closes #869: getMenuShortcuts and detectScope are critical to genie
 * menu sync and picker scope filtering, but were previously untested. The
 * three-way `null | {} | { ... }` contract that `getMenuShortcuts` reports
 * to `dynamic.rs` is non-obvious; ditto the four-branch return shape of
 * `detectScope`.
 *
 * Scope: per the issue, only the two pure helpers — useEffect blocks,
 * keydown handler, and `loadAndSyncMenu` are out of scope.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks must be hoisted above the SUT import.
const getAllShortcutsMock = vi.fn<() => Record<string, string>>();
const prosemirrorToTauriMock = vi.fn<(key: string) => string>(
  (key: string) => `TAURI(${key})`,
);

vi.mock("@/stores/shortcutsStore", () => ({
  useShortcutsStore: {
    getState: () => ({
      getAllShortcuts: getAllShortcutsMock,
    }),
  },
  prosemirrorToTauri: (key: string) => prosemirrorToTauriMock(key),
}));

const editorStoreMock = { sourceMode: false as boolean };
vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => editorStoreMock,
  },
}));

const tiptapEditorStoreMock = {
  editor: null as null | { state: { selection: { empty: boolean } } },
};
vi.mock("@/stores/tiptapEditorStore", () => ({
  useTiptapEditorStore: {
    getState: () => tiptapEditorStoreMock,
  },
}));

// Import AFTER mocks so the SUT picks up the mocked stores.
import { detectScope, getMenuShortcuts } from "./useGenieShortcuts";

beforeEach(() => {
  getAllShortcutsMock.mockReset();
  prosemirrorToTauriMock.mockReset();
  prosemirrorToTauriMock.mockImplementation((key: string) => `TAURI(${key})`);
  editorStoreMock.sourceMode = false;
  tiptapEditorStoreMock.editor = null;
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

describe("detectScope", () => {
  it("returns undefined in source mode regardless of selection state", () => {
    editorStoreMock.sourceMode = true;
    tiptapEditorStoreMock.editor = {
      state: { selection: { empty: false } },
    };
    expect(detectScope()).toBeUndefined();
  });

  it("returns undefined when there is no editor", () => {
    editorStoreMock.sourceMode = false;
    tiptapEditorStoreMock.editor = null;
    expect(detectScope()).toBeUndefined();
  });

  it("returns undefined when the selection is empty", () => {
    editorStoreMock.sourceMode = false;
    tiptapEditorStoreMock.editor = {
      state: { selection: { empty: true } },
    };
    expect(detectScope()).toBeUndefined();
  });

  it("returns 'selection' when there is a non-empty selection", () => {
    editorStoreMock.sourceMode = false;
    tiptapEditorStoreMock.editor = {
      state: { selection: { empty: false } },
    };
    expect(detectScope()).toBe("selection");
  });
});
