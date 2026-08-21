// @vitest-environment node
// Audit fix — one definition of the chrome left of the editor.
//
// App.tsx and the terminal's layout maths each derived this number, and the
// terminal's copy omitted the 30px workspace rail. These tests pin the shared
// definition both now use.
import { describe, it, expect } from "vitest";
import {
  shellSideWidth,
  shellChromeVars,
  WORKSPACE_RAIL_WIDTH,
  CHROME_HEIGHT,
  SHELL_TOP_INSET,
  SHELL_CARD_INSET,
  SHELL_CARD_RADIUS,
  WINDOW_RADIUS,
} from "./shellChrome";
import { TRAFFIC_LIGHTS_CENTRE, TRAFFIC_LIGHTS_CLEARANCE, TRAFFIC_LIGHTS_ZONE } from "./trafficLights";

describe("shellSideWidth", () => {
  it("is zero with no rail and no sidebar", () => {
    expect(
      shellSideWidth({ workspaceRailVisible: false, sidebarVisible: false, sidebarWidth: 260 }),
    ).toBe(0);
  });

  it("counts the rail on its own", () => {
    expect(
      shellSideWidth({ workspaceRailVisible: true, sidebarVisible: false, sidebarWidth: 260 }),
    ).toBe(WORKSPACE_RAIL_WIDTH + SHELL_CARD_INSET * 2);
  });

  it("counts the sidebar on its own", () => {
    expect(
      shellSideWidth({ workspaceRailVisible: false, sidebarVisible: true, sidebarWidth: 260 }),
    ).toBe(260 + SHELL_CARD_INSET * 2);
  });

  it("counts BOTH — the case the terminal used to miss", () => {
    expect(
      shellSideWidth({ workspaceRailVisible: true, sidebarVisible: true, sidebarWidth: 260 }),
    ).toBe(WORKSPACE_RAIL_WIDTH + 260 + SHELL_CARD_INSET * 2);
  });

  it("ignores the sidebar width while the sidebar is hidden", () => {
    expect(
      shellSideWidth({ workspaceRailVisible: true, sidebarVisible: false, sidebarWidth: 9999 }),
    ).toBe(WORKSPACE_RAIL_WIDTH + SHELL_CARD_INSET * 2);
  });

  // App.tsx renders no aside at all when both are hidden, so there is no card
  // to inset — charging its gutters here would push the editor 16px right of
  // the window edge with nothing beside it.
  it("charges no card gutters when there is no card", () => {
    expect(
      shellSideWidth({ workspaceRailVisible: false, sidebarVisible: false, sidebarWidth: 260 }),
    ).toBe(0);
  });
});

// The leading card: the rail and the sidebar are one surface, so they get one
// frame — concentric with the window's own corner, per Apple's guidance.
describe("the leading card", () => {
  it("derives its radius from the window's, minus the inset", () => {
    expect(SHELL_CARD_RADIUS).toBe(WINDOW_RADIUS - SHELL_CARD_INSET);
  });

  it("is TIGHTER than the window holding it, never rounder", () => {
    // Finder's sidebar is 28 inside 36. Borrowing that absolute 28 into our 21pt
    // window would invert the relationship and bulge the corners outward.
    expect(SHELL_CARD_RADIUS).toBeLessThan(WINDOW_RADIUS);
  });

  it("publishes both so CSS never restates them", () => {
    expect(shellChromeVars(true)["--shell-card-inset"]).toBe(`${SHELL_CARD_INSET}px`);
    expect(shellChromeVars(true)["--shell-card-radius"]).toBe(`${SHELL_CARD_RADIUS}px`);
  });

  it("keeps the card on BOTH platforms — it is the app's shape, not the OS's", () => {
    expect(shellChromeVars(false)["--shell-card-inset"]).toBe(`${SHELL_CARD_INSET}px`);
    expect(shellChromeVars(false)["--shell-card-radius"]).toBe(`${SHELL_CARD_RADIUS}px`);
  });
});

// #1296 — the top inset is the vertical half of the same story the rail width
// tells horizontally: one TS definition, published as a CSS var so the sidebar
// and the rail stop hardcoding a number each.
describe("shellChromeVars", () => {
  it("publishes the rail width so descendants inherit the TS value", () => {
    expect(shellChromeVars(true)["--workspace-rail-width"]).toBe(
      `${WORKSPACE_RAIL_WIDTH}px`,
    );
  });

  it("reserves the top inset where the app overlays the native title bar", () => {
    expect(shellChromeVars(true)["--shell-top-inset"]).toBe(`${SHELL_TOP_INSET}px`);
  });

  it("reserves NOTHING where the OS draws its own title bar", () => {
    // Windows/Linux have no traffic lights and mount no chrome strip, so the
    // reservation was a gap with no cause — and once the strip is gone it is
    // simply the top of the window.
    expect(shellChromeVars(false)["--shell-top-inset"]).toBe("0px");
  });

  it("keeps the rail width platform-independent", () => {
    expect(shellChromeVars(false)["--workspace-rail-width"]).toBe(
      shellChromeVars(true)["--workspace-rail-width"],
    );
  });

  it("publishes the window controls' zone and optical centre", () => {
    expect(shellChromeVars(true)["--traffic-lights-zone"]).toBe(`${TRAFFIC_LIGHTS_ZONE}px`);
    expect(shellChromeVars(true)["--traffic-lights-centre"]).toBe(`${TRAFFIC_LIGHTS_CENTRE}px`);
  });

  it("collapses BOTH light-derived values off macOS, with the inset", () => {
    // They describe buttons that are not inside the webview there. Leaving the
    // zone at 82px would indent a title bar against nothing; leaving the centre
    // would push its content down for the same absent reason.
    const off = shellChromeVars(false);
    expect(off["--traffic-lights-zone"]).toBe("0px");
    expect(off["--traffic-lights-centre"]).toBe("0px");
    expect(off["--shell-top-inset"]).toBe("0px");
  });
});

// The inset used to be a standalone 28, chosen against nothing. Two things
// occupy the space it reserves and BOTH are measurable, so it is derived from
// them — see the constants' own docs for the screenshot the numbers come from.
describe("SHELL_TOP_INSET is derived, not chosen", () => {
  it("clears the chrome strip, which is a drag region over the whole shell", () => {
    // The regression: at 28 against a 40px strip, the sidebar's header buttons
    // ran 36→64px and their top 4px sat under `data-tauri-drag-region`,
    // un-clickable. Measured in the running app at 2×, not inferred.
    expect(SHELL_TOP_INSET).toBeGreaterThanOrEqual(CHROME_HEIGHT);
  });

  it("clears the native traffic lights", () => {
    expect(SHELL_TOP_INSET).toBeGreaterThanOrEqual(TRAFFIC_LIGHTS_CLEARANCE);
  });

  it("is exactly the larger of the two — no third, unstated input", () => {
    expect(SHELL_TOP_INSET).toBe(Math.max(CHROME_HEIGHT, TRAFFIC_LIGHTS_CLEARANCE));
  });

  it("leaves the sidebar's first row level with the editor's first row", () => {
    // `AppShell` gives the primary column `paddingTop: CHROME_HEIGHT`. A
    // different number here is two answers to where the top of the window is,
    // and the 12px difference was visible as a step between the two columns.
    expect(SHELL_TOP_INSET).toBe(CHROME_HEIGHT);
  });
});
