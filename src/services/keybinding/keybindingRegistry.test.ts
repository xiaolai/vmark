// WI-1.3 — the live registry service: chord resolution, event resolution, rebind reactivity.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Pin the platform to mac so "Mod" resolves to meta and the metaKey events below
// line up (jsdom's navigator.platform would otherwise resolve "other" = ctrl).
vi.mock("@/utils/shortcutMatch", () => ({ isMacPlatform: () => true }));

// Controllable shortcut store.
let keyMap: Record<string, string> = {};
const subscribers = new Set<() => void>();
const getShortcut = (id: string) => keyMap[id] ?? "";
vi.mock("@/stores/settingsStore/shortcuts", () => ({
  useShortcutsStore: {
    getState: () => ({ getShortcut }),
    subscribe: (fn: () => void) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  },
}));
function emitStoreChange() {
  for (const fn of subscribers) fn();
}

import {
  installBindings,
  resolveShortcutChord,
  resolveEvent,
  _getIndex,
} from "./keybindingRegistry";
import type { Binding, BindingContext } from "./bindingRegistry";
import { canonicalizeChordString } from "@/utils/keybinding/canonicalChord";

function cmd(shortcutId: string, commandId: string, over: Partial<Binding> = {}): Binding {
  return {
    kind: "command",
    commandId,
    shortcutId,
    scope: "window",
    priority: 0,
    captureOwner: "window",
    repeat: "deny",
    ime: "block",
    consumption: "preventDefault",
    ...over,
  } as Binding;
}

const winCtx: BindingContext = { activeScopes: ["window"] };
const evt = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

let dispose: () => void;
beforeEach(() => {
  keyMap = {};
  subscribers.clear();
  dispose?.();
});

describe("keybindingRegistry service", () => {
  it("resolveShortcutChord maps a bound id via the store; unbound → null", () => {
    keyMap = { save: "Mod-s" };
    expect(resolveShortcutChord("save")).toBe(canonicalizeChordString("Mod-s"));
    expect(resolveShortcutChord("missing")).toBeNull();
  });

  it("installBindings indexes bound bindings and resolves a live event", () => {
    keyMap = { palette: "Mod-k" };
    dispose = installBindings([cmd("palette", "palette.open")]);
    const r = resolveEvent(evt("KeyK", { metaKey: true }), winCtx, "window");
    expect(r?.binding.kind === "command" && r.binding.commandId).toBe("palette.open");
  });

  it("drops an unbound binding from the index (referential integrity)", () => {
    keyMap = { palette: "Mod-k" }; // 'other' is unbound
    dispose = installBindings([cmd("palette", "palette.open"), cmd("other", "other.cmd")]);
    // Only one chord indexed.
    expect([..._getIndex().values()].flat()).toHaveLength(1);
  });

  it("rebuilds the index when the store changes (rebind propagation)", () => {
    keyMap = { palette: "Mod-k" };
    dispose = installBindings([cmd("palette", "palette.open")]);
    expect(resolveEvent(evt("KeyK", { metaKey: true }), winCtx, "window")).not.toBeNull();

    // User rebinds palette to Mod-p.
    keyMap = { palette: "Mod-p" };
    emitStoreChange();
    expect(resolveEvent(evt("KeyK", { metaKey: true }), winCtx, "window")).toBeNull(); // old chord gone
    expect(resolveEvent(evt("KeyP", { metaKey: true }), winCtx, "window")?.binding).toMatchObject({
      commandId: "palette.open",
    });
  });

  it("resolveEvent returns null for a non-chord (modifier-only) event", () => {
    keyMap = { palette: "Mod-k" };
    dispose = installBindings([cmd("palette", "palette.open")]);
    expect(resolveEvent(evt("MetaLeft", { metaKey: true }), winCtx, "window")).toBeNull();
  });

  it("the disposer stops tracking and clears the index", () => {
    keyMap = { palette: "Mod-k" };
    dispose = installBindings([cmd("palette", "palette.open")]);
    dispose();
    expect([..._getIndex().values()]).toHaveLength(0);
    // A later store change does not rebuild (unsubscribed).
    keyMap = { palette: "Mod-k" };
    emitStoreChange();
    expect([..._getIndex().values()]).toHaveLength(0);
  });
});
