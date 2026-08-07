/**
 * Unbinding a shortcut.
 *
 * `getShortcut` tested `customBindings[id]` for TRUTHINESS while
 * `getAllShortcuts` used `??`. An explicitly cleared binding — the empty
 * string — is falsy but present, so the two disagreed: the settings list and
 * the native menu showed the shortcut as unbound while `getShortcut` handed
 * the DEFAULT back to every keymap that asked. Unbinding appeared to work and
 * the chord kept firing.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useShortcutsStore } from "./shortcuts";

beforeEach(() => {
  useShortcutsStore.setState({ customBindings: {} });
});

describe("an explicitly unbound shortcut", () => {
  it("stays unbound when read one at a time", () => {
    useShortcutsStore.getState().setShortcut("bold", "");
    expect(useShortcutsStore.getState().getShortcut("bold")).toBe("");
  });

  it("reads the same through both accessors", () => {
    useShortcutsStore.getState().setShortcut("bold", "");
    const one = useShortcutsStore.getState().getShortcut("bold");
    const all = useShortcutsStore.getState().getAllShortcuts().bold;
    expect(one).toBe(all);
  });

  it("comes back after a reset", () => {
    const original = useShortcutsStore.getState().getShortcut("bold");
    useShortcutsStore.getState().setShortcut("bold", "");
    useShortcutsStore.getState().resetShortcut("bold");
    expect(useShortcutsStore.getState().getShortcut("bold")).toBe(original);
  });

  it("still resolves the default for a shortcut nobody touched", () => {
    expect(useShortcutsStore.getState().getShortcut("bold")).not.toBe("");
  });

  it("returns empty for an id that does not exist", () => {
    expect(useShortcutsStore.getState().getShortcut("no-such-shortcut")).toBe("");
  });
});
