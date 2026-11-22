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
import { readFileSync } from "node:fs";
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

// WI-RA24.13 — a binding for an event Rust never sends is a second, dead path
// to the same action, and it reads as the live one.
describe("no binding listens for a menu id Rust handles itself", () => {
  // The MenuAction variants whose handler acts natively (the quit coordinator,
  // window creation, the Settings window) and forwards no `menu:<id>` event.
  const NATIVE = ["Quit", "SaveAllQuit", "NewWindow", "Preferences", "About", "KeyboardShortcuts"];

  /** `"id" => MenuAction::Variant` arms of the Rust menu classifier. */
  function classifiedIds(): Map<string, string> {
    const rust = readFileSync("src-tauri/src/menu/events/dispatch.rs", "utf8");
    return new Map([...rust.matchAll(/"([a-z-]+)" => MenuAction::(\w+),/g)].map((m) => [m[1], m[2]]));
  }

  it("reads every native variant from the classifier, so the check cannot pass vacuously", () => {
    expect([...new Set(classifiedIds().values())]).toEqual(expect.arrayContaining(NATIVE));
  });

  it("binds no command to a natively handled id", () => {
    const native = [...classifiedIds()].filter(([, action]) => NATIVE.includes(action)).map(([id]) => `menu:${id}`);
    expect(STATIC_MENU_BINDINGS.map((b) => b.menuEvent).filter((event) => native.includes(event))).toEqual([]);
  });
});
