// @vitest-environment node
// Audit fix — one definition of the chrome left of the editor.
//
// App.tsx and the terminal's layout maths each derived this number, and the
// terminal's copy omitted the 30px workspace rail. These tests pin the shared
// definition both now use.
import { describe, it, expect } from "vitest";
import { shellSideWidth, WORKSPACE_RAIL_WIDTH } from "./shellChrome";

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
