import { describe, expect, it } from "vitest";
import { appShellClassName, type AppShellFlags } from "./appShellClassName";

const NONE: AppShellFlags = {
  focusMode: false,
  typewriterMode: false,
  findBarOpen: false,
  browserWorkspaceActive: false,
  workspaceRailVisible: false,
};

describe("appShellClassName", () => {
  it("is empty when no flags are set", () => {
    expect(appShellClassName(NONE)).toBe("");
  });

  it("includes only the classes whose flags are true, in declared order", () => {
    expect(
      appShellClassName({ ...NONE, browserWorkspaceActive: true, focusMode: true }),
    ).toBe("focus-mode browser-workspace-active");
  });

  it("emits every modifier when all flags are set", () => {
    expect(appShellClassName({
      focusMode: true,
      typewriterMode: true,
      findBarOpen: true,
      browserWorkspaceActive: true,
      workspaceRailVisible: true,
    })).toBe(
      "focus-mode typewriter-mode find-bar-open browser-workspace-active workspace-rail-visible",
    );
  });
});
