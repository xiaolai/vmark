// @vitest-environment node
// WI-FL3.3 / WI-FL3.10 — the two menu items wired by the feature-ledger fixes
// are actually ROUTED. Rust emits only `menu:{id}`; without a binding row in
// useCommandBootstrap the item is dead while every contract gate stays green
// (the same hole menuRouting.test.ts pins for the view-menu items).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bootstrap = () => readFileSync("src/hooks/useCommandBootstrap.ts", "utf8");

const ROUTES: ReadonlyArray<readonly [menuId: string, commandId: string, rustFile: string]> = [
  ["reopen-closed-tab", "tab.reopenClosed", "src-tauri/src/menu/localized/file_menu.rs"],
  ["bring-all-to-front", "window.bringAllToFront", "src-tauri/src/menu/localized/window_help_menu.rs"],
];

describe("file/window menu items are routed to commands", () => {
  it.each(ROUTES)("routes menu:%s to %s", (menuId, commandId) => {
    expect(bootstrap()).toContain(`{ menuEvent: "menu:${menuId}", commandId: "${commandId}" }`);
  });

  it.each(ROUTES)("declares %s in its Rust menu builder", (menuId, _commandId, rustFile) => {
    expect(readFileSync(rustFile, "utf8")).toContain(`"${menuId}"`);
  });

  it("classifies each id as CommandBus-routed so the action-registry contract stays complete", () => {
    const excluded = readFileSync("src/shared/menuIdExtraction.ts", "utf8");
    for (const [menuId] of ROUTES) expect(excluded).toContain(`"${menuId}"`);
  });

  it("routes each id exactly once — a duplicate row double-fires the command", () => {
    const src = bootstrap();
    for (const [menuId] of ROUTES) {
      const hits = src.split(`menuEvent: "menu:${menuId}"`).length - 1;
      expect(hits, `menu:${menuId} routed ${hits} times`).toBe(1);
    }
  });
});
