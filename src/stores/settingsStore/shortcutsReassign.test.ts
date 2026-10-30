// @vitest-environment node
/**
 * Reassigning a chord another shortcut owns, and reporting a menu refusal.
 *
 * "Assign Anyway" used to set the chord and leave the previous owner bound to
 * it too: the native menu fires only one of two items sharing an accelerator,
 * and the keybinding router refuses a tie as `AmbiguousBindingError`, so the
 * new binding could silently do nothing. `reassignShortcut` moves the chord.
 *
 * A rejected `update_menu_accelerators` was only logged, so a rebinding the
 * native menu refused still looked applied; the rejection now reaches every
 * `onMenuShortcutSyncFailure` listener (the Shortcuts pane toasts it).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/utils/shortcutMatch", () => ({ isMacPlatform: () => true }));

import {
  useShortcutsStore,
  flushMenuShortcutsSync,
  onMenuShortcutSyncFailure,
} from "./shortcuts";

beforeEach(async () => {
  // Drain the previous test's debounced update before counting calls.
  await flushMenuShortcutsSync();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  useShortcutsStore.setState({ customBindings: {} });
});

describe("reassignShortcut", () => {
  it("moves a chord from its owner, leaving the owner unassigned", () => {
    const store = useShortcutsStore.getState();
    expect(store.getShortcut("italic")).toBe("Mod-i");
    store.reassignShortcut("bold", "Mod-i");
    expect(store.getShortcut("bold")).toBe("Mod-i");
    expect(store.getShortcut("italic")).toBe("");
    expect(store.getConflict("Mod-i", "bold")).toBeNull();
  });

  it("matches the owner however the chord is written (modifier order, case)", () => {
    const store = useShortcutsStore.getState();
    store.setShortcut("italic", "Shift-Mod-k");
    store.reassignShortcut("bold", "mod-shift-K");
    expect(store.getShortcut("italic")).toBe("");
  });

  it("is a plain assignment when nobody owns the chord", () => {
    const store = useShortcutsStore.getState();
    const before = store.getAllShortcuts();
    store.reassignShortcut("bold", "Alt-Mod-Shift-9");
    const after = useShortcutsStore.getState().getAllShortcuts();
    expect(after.bold).toBe("Alt-Mod-Shift-9");
    expect({ ...after, bold: before.bold }).toEqual(before);
  });

  it("sends the native menu one update holding both changes", async () => {
    useShortcutsStore.getState().reassignShortcut("bold", "Mod-i");
    await flushMenuShortcutsSync();
    expect(invoke).toHaveBeenCalledTimes(1);
    const sent = invoke.mock.calls[0][1].shortcuts as Record<string, string>;
    expect(sent.bold).toBe("CmdOrCtrl+I");
    expect(sent.italic).toBe("");
  });

  it("an empty chord unassigns without touching anyone else", () => {
    const store = useShortcutsStore.getState();
    const before = store.getAllShortcuts();
    store.reassignShortcut("bold", "");
    const after = useShortcutsStore.getState().getAllShortcuts();
    expect(after.bold).toBe("");
    expect({ ...after, bold: before.bold }).toEqual(before);
  });
});

describe("onMenuShortcutSyncFailure", () => {
  it("hands a rejected menu update to the listener", async () => {
    const refusal = { code: "invalid-input", message: "invalid accelerator for 'bold'" };
    invoke.mockRejectedValueOnce(refusal);
    const listener = vi.fn();
    const off = onMenuShortcutSyncFailure(listener);
    useShortcutsStore.getState().setShortcut("bold", "Mod-k");
    await flushMenuShortcutsSync();
    off();
    expect(listener).toHaveBeenCalledWith(refusal);
  });

  it("stays quiet on success and after unsubscribing", async () => {
    const listener = vi.fn();
    const off = onMenuShortcutSyncFailure(listener);
    useShortcutsStore.getState().setShortcut("bold", "Mod-k");
    await flushMenuShortcutsSync();
    off();
    invoke.mockRejectedValueOnce(new Error("refused"));
    useShortcutsStore.getState().setShortcut("bold", "Mod-j");
    await flushMenuShortcutsSync();
    expect(listener).not.toHaveBeenCalled();
  });
});
