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
  TRAFFIC_LIGHTS_INSET,
} from "./shellChrome";

describe("shellSideWidth", () => {
  it("is zero with no rail and no sidebar", () => {
    expect(
      shellSideWidth({ workspaceRailVisible: false, sidebarVisible: false, sidebarWidth: 260 }),
    ).toBe(0);
  });

  it("counts the rail on its own", () => {
    expect(
      shellSideWidth({ workspaceRailVisible: true, sidebarVisible: false, sidebarWidth: 260 }),
    ).toBe(WORKSPACE_RAIL_WIDTH);
  });

  it("counts the sidebar on its own", () => {
    expect(
      shellSideWidth({ workspaceRailVisible: false, sidebarVisible: true, sidebarWidth: 260 }),
    ).toBe(260);
  });

  it("counts BOTH — the case the terminal used to miss", () => {
    expect(
      shellSideWidth({ workspaceRailVisible: true, sidebarVisible: true, sidebarWidth: 260 }),
    ).toBe(WORKSPACE_RAIL_WIDTH + 260);
  });

  it("ignores the sidebar width while the sidebar is hidden", () => {
    expect(
      shellSideWidth({ workspaceRailVisible: true, sidebarVisible: false, sidebarWidth: 9999 }),
    ).toBe(WORKSPACE_RAIL_WIDTH);
  });
});

// #1296 — the traffic-light inset is the vertical half of the same story the
// rail width tells horizontally: one TS definition, published as a CSS var so
// the sidebar and the rail stop hardcoding 28px each.
describe("shellChromeVars", () => {
  it("publishes the rail width so descendants inherit the TS value", () => {
    expect(shellChromeVars(true)["--workspace-rail-width"]).toBe(
      `${WORKSPACE_RAIL_WIDTH}px`,
    );
  });

  it("reserves the traffic-light inset where the app overlays the native title bar", () => {
    expect(shellChromeVars(true)["--traffic-lights-inset"]).toBe(
      `${TRAFFIC_LIGHTS_INSET}px`,
    );
  });

  it("reserves NOTHING where the OS draws its own title bar", () => {
    // Windows/Linux have no traffic lights, so the 28px was a gap with no cause
    // — and once the chrome strip is gone it is the top of the window.
    expect(shellChromeVars(false)["--traffic-lights-inset"]).toBe("0px");
  });

  it("keeps the rail width platform-independent", () => {
    expect(shellChromeVars(false)["--workspace-rail-width"]).toBe(
      shellChromeVars(true)["--workspace-rail-width"],
    );
  });
});
