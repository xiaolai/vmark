// @vitest-environment node
/**
 * Platform-aware chord identity, fixed menu accelerators, and the persisted
 * bindings boundary in the shortcuts store (#1721, #1722).
 *
 * #1721: off macOS `Mod` IS Ctrl, but the store compared chord strings
 * literally, so `Mod-Shift-Up` and `Ctrl-Shift-Up` never conflicted and both
 * shortcuts held one chord (only one fires).
 * #1722: F11 is a fixed, non-rebindable accelerator on Windows/Linux (View →
 * Toggle Full Screen), but the store let any shortcut take it.
 * Load boundary: a persisted `customBindings: null` or non-string values must
 * not reach the keymaps or the menu sync.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const platform = vi.hoisted(() => ({ mac: true }));
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/utils/shortcutMatch", () => ({ isMacPlatform: () => platform.mac }));

import { useShortcutsStore, flushMenuShortcutsSync } from "./shortcuts";

type State = ReturnType<typeof useShortcutsStore.getState>;

function hydrate(persisted: unknown): State {
  const merge = useShortcutsStore.persist.getOptions().merge;
  if (!merge) throw new Error("shortcuts store must define a persist merge");
  return merge(persisted, useShortcutsStore.getState()) as State;
}

beforeEach(async () => {
  await flushMenuShortcutsSync();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  platform.mac = true;
  useShortcutsStore.setState({ customBindings: {} });
});

describe("Mod and Ctrl chord identity (#1721)", () => {
  it("off macOS, Mod-Shift-Up conflicts with the Ctrl-Shift-Up owner", () => {
    platform.mac = false;
    const store = useShortcutsStore.getState();
    expect(store.getShortcut("expandSelection")).toBe("Ctrl-Shift-Up");
    expect(store.getConflict("Mod-Shift-Up", "bold")?.id).toBe("expandSelection");
  });

  it("off macOS, Ctrl-b conflicts with the Mod-b owner", () => {
    platform.mac = false;
    expect(useShortcutsStore.getState().getConflict("Ctrl-b", "italic")?.id).toBe("bold");
  });

  it("on macOS, Mod is Cmd: Mod-Shift-Up does not conflict with Ctrl-Shift-Up", () => {
    platform.mac = true;
    const store = useShortcutsStore.getState();
    expect(store.getConflict("Mod-Shift-Up", "bold")).toBeNull();
    expect(store.getConflict("Ctrl-b", "italic")).toBeNull();
  });

  it("off macOS, reassigning Mod-Shift-Up unassigns the Ctrl-Shift-Up owner", () => {
    platform.mac = false;
    const store = useShortcutsStore.getState();
    store.reassignShortcut("bold", "Mod-Shift-Up");
    expect(store.getShortcut("bold")).toBe("Mod-Shift-Up");
    expect(store.getShortcut("expandSelection")).toBe("");
  });

  it("on macOS, reassigning Mod-Shift-Up leaves the Ctrl-Shift-Up owner alone", () => {
    platform.mac = true;
    const store = useShortcutsStore.getState();
    store.reassignShortcut("bold", "Mod-Shift-Up");
    expect(store.getShortcut("expandSelection")).toBe("Ctrl-Shift-Up");
  });

  it("still matches a chord the canonicalizer cannot map, by its own spellings", () => {
    platform.mac = false;
    const store = useShortcutsStore.getState();
    store.setShortcut("italic", "Shift-Mod-?");
    expect(store.getConflict("mod-shift-?", "bold")?.id).toBe("italic");
    expect(store.getConflict("Mod-?", "bold")).toBeNull();
  });
});

describe("fixed menu accelerators (#1722)", () => {
  it("off macOS, F11 is reserved and cannot be assigned or reassigned", () => {
    platform.mac = false;
    const store = useShortcutsStore.getState();
    expect(store.isReserved("F11")).toBe(true);
    expect(store.isReserved("f11")).toBe(true);
    store.reassignShortcut("bold", "F11");
    store.setShortcut("italic", "F11");
    expect(store.getShortcut("bold")).toBe("Mod-b");
    expect(store.getShortcut("italic")).toBe("Mod-i");
  });

  it("on macOS, F11 is free to bind", () => {
    platform.mac = true;
    const store = useShortcutsStore.getState();
    expect(store.isReserved("F11")).toBe(false);
    store.reassignShortcut("bold", "F11");
    expect(store.getShortcut("bold")).toBe("F11");
  });

  it("modified F11 and other F-keys are not reserved", () => {
    platform.mac = false;
    const store = useShortcutsStore.getState();
    expect(store.isReserved("Shift-F11")).toBe(false);
    expect(store.isReserved("F12")).toBe(false);
    expect(store.isReserved("")).toBe(false);
  });

  it("off macOS, an imported F11 binding loads unassigned (the fixed item wins)", () => {
    platform.mac = false;
    const store = useShortcutsStore.getState();
    const result = store.importConfig(JSON.stringify({ customBindings: { bold: "F11", italic: "Mod-j" } }));
    expect(result.success).toBe(true);
    expect(store.getShortcut("bold")).toBe("");
    expect(store.getShortcut("italic")).toBe("Mod-j");
  });

  it("on macOS, an imported F11 binding is kept", () => {
    platform.mac = true;
    const store = useShortcutsStore.getState();
    store.importConfig(JSON.stringify({ customBindings: { bold: "F11" } }));
    expect(store.getShortcut("bold")).toBe("F11");
  });
});

describe("persisted bindings boundary (hydrate)", () => {
  it("off macOS, a saved F11 binding loads unassigned; on macOS it is kept", () => {
    platform.mac = false;
    expect(hydrate({ customBindings: { bold: "F11" }, version: 1 }).customBindings).toEqual({ bold: "" });
    platform.mac = true;
    expect(hydrate({ customBindings: { bold: "F11" }, version: 1 }).customBindings).toEqual({ bold: "F11" });
  });

  it.each([null, "Mod-b", 42, ["Mod-b"], undefined])(
    "customBindings %j loads as an empty map",
    (raw) => {
      const state = hydrate({ customBindings: raw, version: 1 });
      expect(state.customBindings).toEqual({});
      expect(() => state.getAllShortcuts()).not.toThrow();
    },
  );

  it("drops non-string values so the default applies, keeping the rest", () => {
    const state = hydrate({
      customBindings: { bold: false, italic: 0, underline: null, strikethrough: "", code: "Mod-j" },
      version: 1,
    });
    expect(state.customBindings).toEqual({ strikethrough: "", code: "Mod-j" });
  });

  it("adopts only the persisted data fields, never an action or a bad version", () => {
    const state = hydrate({ customBindings: {}, version: "2", getShortcut: "x" });
    expect(typeof state.getShortcut).toBe("function");
    expect(state.version).toBe(1);
    expect(hydrate({ customBindings: {}, version: 3 }).version).toBe(3);
  });

  it("a non-object persisted state keeps the current state", () => {
    useShortcutsStore.setState({ customBindings: { italic: "Mod-k" } });
    const current = useShortcutsStore.getState();
    expect(hydrate(null).customBindings).toEqual(current.customBindings);
    expect(hydrate("junk").customBindings).toEqual(current.customBindings);
    expect(hydrate([{ customBindings: { bold: "Mod-j" } }]).customBindings).toEqual(current.customBindings);
  });
});
