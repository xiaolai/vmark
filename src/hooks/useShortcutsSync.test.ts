import { beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcutsStore } from "@/stores/settingsStore/shortcuts";
import { handleShortcutsStorageEvent } from "./useShortcutsSync";

function createStorageEvent(state: Record<string, unknown>, key = "vmark-shortcuts"): StorageEvent {
  return new StorageEvent("storage", {
    key,
    newValue: JSON.stringify({ state, version: 0 }),
  });
}

beforeEach(() => {
  useShortcutsStore.setState({ customBindings: {} });
});

describe("useShortcutsSync cross-window sync", () => {
  // C2: vmark-shortcuts had no storage listener and no Tauri event. Native menu
  // accelerators updated (app-global via invoke) but the document window's
  // Tiptap/CodeMirror keymaps did not, so BOTH the old and new binding stayed
  // live until restart. Shortcuts with no menuId did not apply at all.
  it("adopts a rebind made in another window", () => {
    handleShortcutsStorageEvent(
      createStorageEvent({ customBindings: { "view.zoomIn": "Mod-Shift-=" } }),
    );

    expect(useShortcutsStore.getState().customBindings["view.zoomIn"]).toBe("Mod-Shift-=");
  });

  it("notifies subscribers so keymaps rebuild", () => {
    const listener = vi.fn();
    const unsubscribe = useShortcutsStore.subscribe(listener);

    handleShortcutsStorageEvent(
      createStorageEvent({ customBindings: { "file.save": "Mod-Alt-s" } }),
    );

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("adopts a reset (bindings cleared in another window)", () => {
    useShortcutsStore.setState({ customBindings: { "file.save": "Mod-Alt-s" } });

    handleShortcutsStorageEvent(createStorageEvent({ customBindings: {} }));

    expect(useShortcutsStore.getState().customBindings).toEqual({});
  });

  it("ignores events for other storage keys", () => {
    handleShortcutsStorageEvent(
      createStorageEvent({ customBindings: { "file.save": "Mod-x" } }, "vmark-settings"),
    );

    expect(useShortcutsStore.getState().customBindings).toEqual({});
  });

  it("does not apply when nothing changed", () => {
    useShortcutsStore.setState({ customBindings: { "file.save": "Mod-Alt-s" } });
    const listener = vi.fn();
    const unsubscribe = useShortcutsStore.subscribe(listener);

    handleShortcutsStorageEvent(
      createStorageEvent({ customBindings: { "file.save": "Mod-Alt-s" } }),
    );

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  describe("rejects malformed writes", () => {
    it.each([
      ["a string", "not-an-object"],
      ["an array", ["a", "b"]],
      ["null", null],
    ])("ignores customBindings that is %s", (_label, value) => {
      useShortcutsStore.setState({ customBindings: { "file.save": "Mod-Alt-s" } });

      handleShortcutsStorageEvent(createStorageEvent({ customBindings: value }));

      expect(useShortcutsStore.getState().customBindings).toEqual({
        "file.save": "Mod-Alt-s",
      });
    });

    it("drops non-string binding values but keeps valid siblings", () => {
      handleShortcutsStorageEvent(
        createStorageEvent({
          customBindings: { "file.save": "Mod-Alt-s", "file.open": 42, "file.new": null },
        }),
      );

      expect(useShortcutsStore.getState().customBindings).toEqual({
        "file.save": "Mod-Alt-s",
      });
    });

    it("ignores unparseable JSON", () => {
      useShortcutsStore.setState({ customBindings: { "file.save": "Mod-Alt-s" } });

      handleShortcutsStorageEvent(
        new StorageEvent("storage", { key: "vmark-shortcuts", newValue: "{not json" }),
      );

      expect(useShortcutsStore.getState().customBindings).toEqual({
        "file.save": "Mod-Alt-s",
      });
    });

    it("ignores an event with no new value", () => {
      handleShortcutsStorageEvent(
        new StorageEvent("storage", { key: "vmark-shortcuts", newValue: null }),
      );

      expect(useShortcutsStore.getState().customBindings).toEqual({});
    });
  });
});

describe("useShortcutsSync hook", () => {
  it("adds and removes the storage listener", async () => {
    const { renderHook } = await import("@testing-library/react");
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { useShortcutsSync } = await import("./useShortcutsSync");
    const { unmount } = renderHook(() => useShortcutsSync());

    expect(addSpy).toHaveBeenCalledWith("storage", expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("storage", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
