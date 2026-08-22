// @vitest-environment node
// WI-TNAV2.3 / WI-DSPL1.2 — the five new native menu items are actually ROUTED.
//
// Rust emits only `menu:{id}`; without an explicit `VIEW_BINDINGS` row the menu
// item is DEAD. Nothing caught that: `check-keybinding-manifest` compares
// accelerators, `menuIdExtraction` checks the id is classified, and neither
// looks at the event→command mapping. A typo in a menu id would ship a menu
// item that silently does nothing while every contract gate stayed green.
//
// Reads source because `VIEW_BINDINGS` is module-private and the hook needs a
// React tree; the mapping is a static table, so a static read decides it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bootstrap = () => readFileSync("src/hooks/useCommandBootstrap.ts", "utf8");
const rustMenu = () => readFileSync("src-tauri/src/menu/localized/view_menu.rs", "utf8");

const NEW_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ["last-used-tab", "tab.lastUsed"],
  ["split-documents", "view.toggleSplitDocuments"],
  ["close-pane", "view.closePane"],
  ["focus-other-pane", "view.focusOtherPane"],
  ["sync-pane-scroll", "view.toggleSyncScroll"],
];

describe("new native menu items are routed to commands", () => {
  it.each(NEW_ROUTES)("routes menu:%s to %s", (menuId, commandId) => {
    expect(bootstrap()).toContain(`{ menuEvent: "menu:${menuId}", commandId: "${commandId}" }`);
  });

  it.each(NEW_ROUTES)("declares %s in the Rust menu builder", (menuId) => {
    expect(rustMenu()).toContain(`"${menuId}"`);
  });

  it("classifies every new id so the action-registry contract stays complete", () => {
    const excluded = readFileSync("src/shared/menuIdExtraction.ts", "utf8");
    for (const [menuId] of NEW_ROUTES) {
      expect(excluded).toContain(`"${menuId}"`);
    }
  });

  it("routes each id exactly once — a duplicate row double-fires the command", () => {
    const src = bootstrap();
    for (const [menuId] of NEW_ROUTES) {
      const hits = src.split(`menuEvent: "menu:${menuId}"`).length - 1;
      expect(hits, `menu:${menuId} routed ${hits} times`).toBe(1);
    }
  });
});
