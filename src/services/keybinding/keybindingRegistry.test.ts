// @vitest-environment node
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

// The drop warning is the subject of the tests at the bottom of this file: it
// forwards to the Tauri log plugin in production, so a false alarm here ends up
// in every user's VMark.log.
const keybindingWarn = vi.fn();
vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/debug")>()),
  keybindingWarn: (...args: unknown[]) => keybindingWarn(...args),
}));

import {
  installBindings,
  resolveShortcutChord,
  resolveEvent,
  _getIndex,
} from "./keybindingRegistry";
import type { Binding, BindingContext } from "./bindingRegistry";
import { canonicalizeChordString } from "@/utils/keybinding/canonicalChord";
import { KEYBINDINGS } from "./keybindingDefinitions";
import { DEFAULT_SHORTCUTS } from "@/stores/settingsStore/shortcutDefinitions";

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
  keybindingWarn.mockClear();
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

  it("a stale disposer does not tear down a newer installation (audit #3)", () => {
    keyMap = { palette: "Mod-k" };
    const disposeA = installBindings([cmd("palette", "palette.open")]);
    const disposeB = installBindings([cmd("palette", "palette.open")]);
    // The stale disposer A must be a no-op — installation B owns the state now.
    disposeA();
    expect(resolveEvent(evt("KeyK", { metaKey: true }), winCtx, "window")).not.toBeNull();
    // B's own disposer still cleans up.
    disposeB();
    expect([..._getIndex().values()].flat()).toHaveLength(0);
    dispose = () => {};
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

/**
 * An UNBOUND shortcut is not a defect (#1301).
 *
 * `getShortcut` returns `""` for both "this id has no key" and "this id does
 * not exist", so the registry could not tell them apart and warned about both.
 * Six shipped shortcuts have an empty `defaultKey` on purpose, and a user may
 * clear any key in Settings — so the warning fired on every window load, was
 * forwarded to the Tauri log plugin, and reached users' VMark.log. #1301's
 * attached log carries eight copies of it, and the reporter listed it as a
 * suspected cause of the freeze it had nothing to do with. That is the cost:
 * a permanent false alarm trains readers to ignore the one line that would
 * mean something.
 */
describe("dropped-binding warnings distinguish unbound from unknown", () => {
  it("stays silent for a KNOWN shortcut that is deliberately unbound", () => {
    const known = DEFAULT_SHORTCUTS[0].id;
    keyMap = {}; // nothing bound
    dispose = installBindings([cmd(known, "some.command")]);
    expect([..._getIndex().values()].flat()).toHaveLength(0); // still dropped
    expect(keybindingWarn).not.toHaveBeenCalled();
  });

  it("still warns for a shortcutId that does not exist at all", () => {
    dispose = installBindings([cmd("no-such-shortcut-id", "some.command")]);
    expect(keybindingWarn).toHaveBeenCalledTimes(1);
    expect(String(keybindingWarn.mock.calls[0][0])).toContain("no-such-shortcut-id");
  });

  it("installing the REAL bindings at their REAL defaults logs nothing", () => {
    // The regression pin for the reported log line. Real KEYBINDINGS, real
    // DEFAULT_SHORTCUTS — only the store plumbing is a stand-in.
    keyMap = Object.fromEntries(DEFAULT_SHORTCUTS.map((s) => [s.id, s.defaultKey]));
    dispose = installBindings(KEYBINDINGS);
    expect(keybindingWarn.mock.calls).toEqual([]);
  });

  it("the real binding set does include an intentionally unbound shortcut", () => {
    // Guards the test above from going vacuous: if every shipped shortcut ever
    // gains a default key, the silence proves nothing and this fails loudly.
    const unbound = DEFAULT_SHORTCUTS.filter((s) => s.defaultKey === "").map((s) => s.id);
    const bound = new Set(unbound);
    const declared = KEYBINDINGS.filter((b) => "shortcutId" in b && bound.has(b.shortcutId));
    expect(declared.length).toBeGreaterThan(0);
  });
});
