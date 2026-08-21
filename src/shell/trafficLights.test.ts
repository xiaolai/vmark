// @vitest-environment node
//
// The macOS window controls are described in THREE places that no compiler
// joins: `tauri.conf.json` (the main window), `window_manager/traffic_lights.rs`
// (every window built at runtime), and `trafficLights.ts` (the clearances the app's
// own chrome leaves). A number changed in one of them and not the others is
// silent — the lights simply move under the title bar, or a second window's
// lights sit somewhere the first window's do not.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TRAFFIC_LIGHT_POSITION,
  TRAFFIC_LIGHT_DIAMETER,
  TRAFFIC_LIGHTS_SPAN,
  TRAFFIC_LIGHTS_TOP,
  TRAFFIC_LIGHTS_CLEARANCE,
  TRAFFIC_LIGHTS_CENTRE,
  TRAFFIC_LIGHTS_REACH,
  TRAFFIC_LIGHTS_ZONE,
} from "./trafficLights";

const REPO = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

describe("the derived geometry", () => {
  // Finder, measured live: insets 19.0pt from the window's left and top, centre
  // 25.75pt down (the 0.25 is antialiasing on a 14pt circle — the true centre
  // is 19 + 7). paper-one measured Finder's centre at 25.8pt independently.
  it("puts the buttons on Finder's line, 19pt below the window top", () => {
    expect(TRAFFIC_LIGHTS_TOP).toBe(19);
  });

  it("insets 19pt from the window's left edge, as Finder does", () => {
    expect(TRAFFIC_LIGHT_POSITION.x).toBe(19);
  });

  it("derives the optical centre rather than restating it", () => {
    expect(TRAFFIC_LIGHTS_CENTRE).toBe(TRAFFIC_LIGHTS_TOP + TRAFFIC_LIGHT_DIAMETER / 2);
    expect(TRAFFIC_LIGHTS_CENTRE).toBe(26);
  });

  it("derives the downward clearance from the same two numbers", () => {
    expect(TRAFFIC_LIGHTS_CLEARANCE).toBe(TRAFFIC_LIGHTS_TOP + TRAFFIC_LIGHT_DIAMETER);
    expect(TRAFFIC_LIGHTS_CLEARANCE).toBe(33);
  });

  it("derives the sideways reach from the inset and the measured span", () => {
    expect(TRAFFIC_LIGHTS_REACH).toBe(TRAFFIC_LIGHT_POSITION.x + TRAFFIC_LIGHTS_SPAN);
    expect(TRAFFIC_LIGHTS_REACH).toBe(78.5);
  });

  // The half-change paper-one warns about: move the cluster right and the title
  // bar's leading pad must move with it. This fails if the inset is raised
  // alone, which is the whole point of asserting the RELATIONSHIP.
  it("keeps the title bar's leading zone clear of the cluster", () => {
    expect(TRAFFIC_LIGHTS_ZONE).toBeGreaterThan(TRAFFIC_LIGHTS_REACH);
  });

  it("does not waste more than a few points doing so", () => {
    expect(TRAFFIC_LIGHTS_ZONE - TRAFFIC_LIGHTS_REACH).toBeLessThanOrEqual(6);
  });
});

describe("the three declarations of the position agree", () => {
  it("matches src-tauri/tauri.conf.json", () => {
    const conf = JSON.parse(read("src-tauri/tauri.conf.json")) as {
      app: { macOSPrivateApi?: boolean; windows: { trafficLightPosition?: { x: number; y: number } }[] };
    };
    const main = conf.app.windows[0];
    expect(main?.trafficLightPosition).toEqual({
      x: TRAFFIC_LIGHT_POSITION.x,
      y: TRAFFIC_LIGHT_POSITION.y,
    });
  });

  // Without this flag Tauri ignores the position SILENTLY. Nothing else in the
  // build reports it, and the symptom is "the config had no effect".
  it("has macOSPrivateApi enabled, without which the position is ignored", () => {
    const conf = JSON.parse(read("src-tauri/tauri.conf.json")) as {
      app: { macOSPrivateApi?: boolean };
    };
    expect(conf.app.macOSPrivateApi).toBe(true);
  });

  // tauri-build reads this array as MANIFEST TEXT and refuses to build when
  // macOSPrivateApi is set without the feature literally listed. It therefore
  // cannot move behind a `desktop` feature or a target cfg.
  it("lists the macos-private-api cargo feature literally", () => {
    const toml = read("src-tauri/Cargo.toml");
    const line = toml.split("\n").find((l) => l.startsWith("tauri = "));
    expect(line).toBeDefined();
    expect(line).toContain("macos-private-api");
  });

  it("matches the constant the runtime window builders use", () => {
    const rs = read("src-tauri/src/window_manager/traffic_lights.rs");
    const m = /const TRAFFIC_LIGHT_POSITION:\s*(?:tauri::)?LogicalPosition<f64>\s*=\s*(?:tauri::)?LogicalPosition\s*\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+)\s*,?\s*\}/.exec(rs);
    expect(m, "TRAFFIC_LIGHT_POSITION not found in window_manager/traffic_lights.rs").not.toBeNull();
    expect(Number(m?.[1])).toBe(TRAFFIC_LIGHT_POSITION.x);
    expect(Number(m?.[2])).toBe(TRAFFIC_LIGHT_POSITION.y);
  });

  // A window built at runtime does NOT inherit the config's window entry, so
  // every builder that asks for the overlay title bar has to place the buttons
  // itself. Miss one and that window's lights sit 10pt from where the main
  // window's do — in the same app, on the same screen.
  it.each([
    "src-tauri/src/window_manager/settings_window.rs",
    "src-tauri/src/window_manager/document_windows.rs",
  ])("%s places the buttons wherever it asks for the overlay title bar", (path) => {
    const rs = read(path);
    const overlays = rs.split("\n").filter((l) => l.includes("title_bar_style"));
    expect(overlays.length).toBeGreaterThan(0);
    expect(rs).toMatch(/traffic_light_position\((?:super::)?TRAFFIC_LIGHT_POSITION\)/);
  });
});
