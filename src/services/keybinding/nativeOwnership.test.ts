// @vitest-environment node
/**
 * WI-5.2 — whole-system exactly-once: a chord whose resolved ownership is
 * native-only must be REJECTED by the window (DOM) adapter, so the native menu
 * accelerator is its sole executor and one physical keypress runs it once.
 * `newBrowserTab` is the canonical native-only chord (the WKWebView browser eats
 * DOM keys when focused; AppKit dispatches the accelerator regardless of focus).
 */

import { describe, expect, it } from "vitest";
import { KEYBINDINGS } from "./keybindingDefinitions";
import { buildIndex, resolveBinding, type Binding } from "./bindingRegistry";
import { resolveShortcutChord } from "./keybindingRegistry";

function commandBinding(commandId: string): Binding | undefined {
  return KEYBINDINGS.find(
    (b): b is Binding => b.kind === "command" && b.commandId === commandId,
  );
}

describe("native-owned bindings (WI-5.2)", () => {
  it("newBrowserTab is native-menu owned, not window", () => {
    const b = commandBinding("browser.newTab");
    expect(b?.captureOwner).toBe("native-menu");
  });

  it("the window adapter does NOT resolve the native-only chord; the native owner does", () => {
    const index = buildIndex(KEYBINDINGS, resolveShortcutChord);
    const b = commandBinding("browser.newTab")!;
    const chord = "shortcutId" in b ? resolveShortcutChord(b.shortcutId) : null;
    expect(chord).toBeTruthy();

    const ctx = { activeScopes: ["window" as const] };
    // Window (DOM) adapter: rejected — native handles it (no double-fire).
    expect(resolveBinding(index, chord!, ctx, "window")).toBeNull();
    // Native-menu owner: resolves to browser.newTab.
    const asNative = resolveBinding(index, chord!, ctx, "native-menu");
    expect(asNative?.binding.kind === "command" && asNative.binding.commandId).toBe(
      "browser.newTab",
    );
  });

  it("still enters the index (referential integrity + conflict detection see it)", () => {
    const index = buildIndex(KEYBINDINGS, resolveShortcutChord);
    const b = commandBinding("browser.newTab")!;
    const chord = "shortcutId" in b ? resolveShortcutChord(b.shortcutId) : null;
    expect(index.get(chord!)?.some((x) => x.kind === "command" && x.commandId === "browser.newTab")).toBe(true);
  });
});
