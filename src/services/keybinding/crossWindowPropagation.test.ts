/**
 * Phase 7 — cross-window keybinding propagation. Proves the full chain that makes
 * a shortcut rebind in one window take effect in every other window WITHOUT new
 * plumbing: Tauri v2 webviews share one localStorage, so a rebind in window A
 * fires a `storage` event in window B; `useShortcutsSync.handleShortcutsStorageEvent`
 * adopts it into `useShortcutsStore`; and the keybinding registry (installBindings)
 * subscribes to that store and rebuilds its index — so window B's router resolves
 * the NEW chord and no longer the old one.
 */

import { afterEach, describe, expect, it } from "vitest";
import { handleShortcutsStorageEvent } from "@/hooks/useShortcutsSync";
import { useShortcutsStore } from "@/stores/settingsStore/shortcuts";
import { installBindings, resolveShortcutChord, _getIndex } from "./keybindingRegistry";
import type { Binding } from "./bindingRegistry";

const SHORTCUTS_STORAGE_KEY = "vmark-shortcuts";

function paletteBinding(): Binding {
  return {
    kind: "command",
    commandId: "app.commandPalette",
    shortcutId: "commandPalette",
    scope: "window",
    priority: 0,
    captureOwner: "window",
    repeat: "deny",
    ime: "block",
    consumption: "preventDefault",
  };
}

/** Simulate the `storage` event another window's rebind write produces. */
function fireCrossWindowRebind(bindings: Record<string, string>): void {
  const newValue = JSON.stringify({ state: { customBindings: bindings } });
  handleShortcutsStorageEvent(
    new StorageEvent("storage", { key: SHORTCUTS_STORAGE_KEY, newValue }),
  );
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  useShortcutsStore.setState({ customBindings: {} });
});

describe("cross-window keybinding propagation (Phase 7)", () => {
  it("a rebind arriving as a storage event rebuilds the registry index", () => {
    useShortcutsStore.setState({ customBindings: {} });
    dispose = installBindings([paletteBinding()]);

    const defaultChord = resolveShortcutChord("commandPalette");
    expect(defaultChord).toBeTruthy();
    expect(_getIndex().has(defaultChord!)).toBe(true);

    // Another window rebinds the palette; it reaches us as a shared-localStorage event.
    fireCrossWindowRebind({ commandPalette: "Alt-Mod-p" });

    // The store adopted the rebind...
    expect(useShortcutsStore.getState().customBindings.commandPalette).toBe("Alt-Mod-p");

    // ...and the registry rebuilt: the new chord is indexed, the old one is gone.
    const newChord = resolveShortcutChord("commandPalette");
    expect(newChord).toBeTruthy();
    expect(newChord).not.toBe(defaultChord);
    expect(_getIndex().has(newChord!)).toBe(true);
    expect(_getIndex().has(defaultChord!)).toBe(false);
    expect(_getIndex().get(newChord!)?.[0]).toMatchObject({ commandId: "app.commandPalette" });
  });

  it("a malformed cross-window write leaves the live index untouched", () => {
    useShortcutsStore.setState({ customBindings: {} });
    dispose = installBindings([paletteBinding()]);
    const chord = resolveShortcutChord("commandPalette")!;

    // Corrupt JSON and a wrong-key event must NOT clear bindings.
    handleShortcutsStorageEvent(
      new StorageEvent("storage", { key: SHORTCUTS_STORAGE_KEY, newValue: "{not json" }),
    );
    handleShortcutsStorageEvent(
      new StorageEvent("storage", { key: "other-key", newValue: "{}" }),
    );

    expect(_getIndex().has(chord)).toBe(true);
  });
});
