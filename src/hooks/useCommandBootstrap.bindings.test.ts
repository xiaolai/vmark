// Runs under jsdom, the default: registerAllCommands pulls in viewCommands,
// which imports contentServerStore — that publishes a DEV debug handle on
// `window` at import time.
/**
 * Every menu binding must name a command that exists (audit #916).
 *
 * `executeCommand` answers `false` for BOTH "no such command" and "`when()`
 * said no", so at dispatch time a dead menu item is indistinguishable from a
 * disabled one — it simply does nothing, forever, and nothing says so. The
 * mount-time preflight in `mountMenuCommands` now catches it: an unresolvable
 * binding is dropped and readiness reports `false`.
 *
 * That makes this property load-bearing, and a property nothing asserts is a
 * property that breaks quietly. Editor-action bindings are excluded because
 * they never touch the bus — they dispatch through `runEditorAction`.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { STATIC_MENU_BINDINGS } from "./useCommandBootstrap";
import { registerAllCommands } from "@/services/commands/registerAllCommands";
import { hasCommand, _resetCommandBus } from "@/services/commands/CommandBus";

beforeEach(() => {
  _resetCommandBus();
});

describe("static menu bindings resolve to registered commands (#916)", () => {
  it("every command binding names a command registerAllCommands registers", () => {
    registerAllCommands();

    const unresolved = STATIC_MENU_BINDINGS.filter(
      (b) => b.kind !== "editorAction" && !hasCommand(b.commandId),
    ).map((b) => `${b.menuEvent} → ${"commandId" in b ? b.commandId : "?"}`);

    expect(unresolved).toEqual([]);
  });

  it("the list is non-empty and holds command bindings, so it cannot pass vacuously", () => {
    const commandBindings = STATIC_MENU_BINDINGS.filter((b) => b.kind !== "editorAction");
    expect(commandBindings.length).toBeGreaterThan(20);
  });
});
