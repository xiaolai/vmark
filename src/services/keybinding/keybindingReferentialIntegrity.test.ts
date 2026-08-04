/**
 * WI-1.3 — keybinding referential integrity. Registers the full CommandBus
 * command surface, then asserts every KEYBINDING resolves cleanly:
 *   - every `command` binding's `commandId` is a registered command, and
 *   - every `shortcutId`-sourced binding references a real shortcut definition.
 * This catches a binding pointing at a renamed/removed command or shortcut id
 * before it silently drops out of the resolver index at runtime.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { KEYBINDINGS } from "./keybindingDefinitions";
import { getCommand, _resetCommandBus } from "@/services/commands/CommandBus";
import { DEFAULT_SHORTCUTS } from "@/stores/settingsStore/shortcutDefinitions";
import { registerMiscCommands } from "@/services/commands/miscCommands";
import { registerViewCommands } from "@/services/commands/viewCommands";
import { registerBrowserCommands } from "@/services/commands/browserCommands";
import { registerTabCommands } from "@/services/commands/tabCommands";
import { registerFileCommands } from "@/services/commands/fileCommands";
import { registerGenieCommands } from "@/services/commands/genieCommands";

const shortcutIds = new Set(DEFAULT_SHORTCUTS.map((s) => s.id));

beforeAll(() => {
  _resetCommandBus();
  // The command surface every KEYBINDING commandId is drawn from (app / view /
  // explorer / lint / tab / file / browser / genies).
  registerMiscCommands();
  registerViewCommands();
  registerBrowserCommands();
  registerTabCommands();
  registerFileCommands();
  registerGenieCommands();
});

describe("KEYBINDINGS — referential integrity (WI-1.3)", () => {
  it("every command binding's commandId is a registered CommandBus command", () => {
    const missing: string[] = [];
    for (const b of KEYBINDINGS) {
      if (b.kind === "command" && !getCommand(b.commandId)) {
        missing.push(b.commandId);
      }
    }
    expect(missing, `unregistered command ids: ${missing.join(", ")}`).toEqual([]);
  });

  it("every shortcutId-sourced binding references a real shortcut definition", () => {
    const unknown: string[] = [];
    for (const b of KEYBINDINGS) {
      if ("shortcutId" in b && !shortcutIds.has(b.shortcutId)) {
        unknown.push(b.shortcutId);
      }
    }
    expect(unknown, `unknown shortcut ids: ${unknown.join(", ")}`).toEqual([]);
  });

  it("no command binding is missing both a shortcutId and a fixedChord (must have a chord source)", () => {
    const chordless: string[] = [];
    for (const b of KEYBINDINGS) {
      const hasSource = "shortcutId" in b || "fixedChord" in b;
      if (!hasSource) chordless.push(b.kind === "command" ? b.commandId : "(containment)");
    }
    expect(chordless).toEqual([]);
  });
});
