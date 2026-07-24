/**
 * Keybinding definitions — the declarative bindings routed through the registry
 * (ADR-018). This set GROWS one migration slice at a time; each entry replaces a
 * bespoke `window` keydown hook. Every `command` binding's `commandId` must be a
 * registered CommandBus command (the invariant: keyboard enters via
 * `executeCommand`).
 *
 * @module services/keybinding/keybindingDefinitions
 */

import type { Binding } from "./bindingRegistry";

export const KEYBINDINGS: readonly Binding[] = [
  // Command Palette (migrated from useCommandPaletteShortcut). Global, works
  // everywhere incl. inputs (no scope guard on the original), IME-blocked,
  // no-repeat.
  {
    kind: "command",
    commandId: "app.commandPalette",
    shortcutId: "commandPalette",
    scope: "window",
    priority: 0,
    captureOwner: "window",
    repeat: "deny",
    ime: "block",
    consumption: "preventDefault",
  },
  // Find in Files (migrated from useContentSearchShortcuts). Global open; the
  // menu:find-in-files event routes to the same command via useCommandBootstrap.
  {
    kind: "command",
    commandId: "view.contentSearch",
    shortcutId: "contentSearch",
    scope: "window",
    priority: 0,
    captureOwner: "window",
    repeat: "deny",
    ime: "block",
    consumption: "preventDefault",
  },
  // Quick Open (migrated from useQuickOpenShortcuts). Keyboard toggles; the
  // menu:quick-open event routes to the same toggle command (the picker is modal,
  // so toggle ≡ open from the menu in practice — behavior-neutral).
  {
    kind: "command",
    commandId: "app.quickOpen",
    shortcutId: "quickOpen",
    scope: "window",
    priority: 0,
    captureOwner: "window",
    repeat: "deny",
    ime: "block",
    consumption: "preventDefault",
  },
];
