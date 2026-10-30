// @vitest-environment node
// APP_NAME is the product name the webview shows (window title fallback, the
// empty title bar, the welcome heading). The bundle spells it in
// `src-tauri/tauri.conf.json`, which also gives the main window its title
// before the webview sets one; a rename in one place only would make the
// window's name change the moment the frontend loads.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME } from "./appName";

interface TauriConf {
  productName: string;
  app: { windows: Array<{ label: string; title: string }> };
}

const conf = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../src-tauri/tauri.conf.json"), "utf8"),
) as TauriConf;

describe("APP_NAME", () => {
  it("is the bundle's product name", () => {
    expect(APP_NAME).toBe(conf.productName);
  });

  it("is the title the main window opens with", () => {
    const main = conf.app.windows.find((w) => w.label === "main");
    expect(main?.title).toBe(APP_NAME);
  });
});
