// @vitest-environment node
// Conditional native menu items (#1425) — the frontend half of
// `src-tauri/src/menu/conditional_items.rs`. Every item whose feature ships off
// is REMOVED from the menu bar rather than greyed out, and this is what keeps
// the menu in step with the settings that decide it.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { useSettingsStore } from "@/stores/settingsStore";
import {
  CONDITIONAL_MENU_ITEMS,
  startConditionalMenuItemSync,
} from "./conditionalMenuItemSync";

const setDeveloperMode = (developerMode: boolean) =>
  useSettingsStore.setState((s) => ({ advanced: { ...s.advanced, developerMode } }));
const setBrowserEnabled = (enabled: boolean) =>
  useSettingsStore.setState((s) => ({ browser: { ...s.browser, enabled } }));

/** Every `set_menu_item_visible` call as `[itemId, visible]`. */
const pushes = (): Array<[string, boolean]> =>
  mocks.invoke.mock.calls
    .filter(([cmd]) => cmd === "set_menu_item_visible")
    .map(([, args]) => [
      (args as { itemId: string }).itemId,
      (args as { visible: boolean }).visible,
    ]);

const pushesFor = (itemId: string) => pushes().filter(([id]) => id === itemId).map(([, v]) => v);

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
  setDeveloperMode(false);
  setBrowserEnabled(false);
});

describe("startConditionalMenuItemSync (#1425)", () => {
  it("pushes an initial visibility for EVERY conditional item", () => {
    const stop = startConditionalMenuItemSync();
    const pushed = pushes().map(([id]) => id).sort();
    expect(pushed).toEqual(CONDITIONAL_MENU_ITEMS.map((i) => i.itemId).sort());
    stop();
  });

  it("hides the Knowledge Base item while Developer Mode is off", () => {
    const stop = startConditionalMenuItemSync();
    expect(pushesFor("knowledge-base")).toEqual([false]);
    stop();
  });

  it("shows it once Developer Mode is on, and hides it again when it goes off", async () => {
    const stop = startConditionalMenuItemSync();
    setDeveloperMode(true);
    await vi.waitFor(() => expect(pushesFor("knowledge-base")).toEqual([false, true]));
    setDeveloperMode(false);
    await vi.waitFor(() => expect(pushesFor("knowledge-base")).toEqual([false, true, false]));
    stop();
  });

  // A settings store change fires for every key. Re-pushing an unchanged value
  // would put one IPC call per keystroke in a settings text field on the main
  // thread, for a menu item that is not moving.
  it("does not re-push a value that has not changed", () => {
    const stop = startConditionalMenuItemSync();
    const before = pushes().length;
    useSettingsStore.setState((s) => ({ advanced: { ...s.advanced, keepBothEditorsAlive: true } }));
    expect(pushes()).toHaveLength(before);
    stop();
  });

  it("stops pushing once disposed", () => {
    const stop = startConditionalMenuItemSync();
    stop();
    const after = pushes().length;
    setDeveloperMode(true);
    expect(pushes()).toHaveLength(after);
  });
});

// The push names an item id that only Rust declares. A typo there is not a
// compile error on either side: the command would reject it as invalid-input and
// the pusher would retry that rejection forever, so the item simply never moves.
describe("the item ids agree with the Rust table", () => {
  it("matches CONDITIONAL_ITEMS in src-tauri/src/menu/conditional_items.rs", () => {
    const source = readFileSync("src-tauri/src/menu/conditional_items.rs", "utf8");
    const table = source.slice(
      source.indexOf("pub const CONDITIONAL_ITEMS"),
      source.indexOf("/// The table entry for"),
    );
    const rustIds = [...table.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(rustIds.length).toBeGreaterThan(0);
    expect(CONDITIONAL_MENU_ITEMS.map((i) => i.itemId).sort()).toEqual(rustIds);
  });
});
