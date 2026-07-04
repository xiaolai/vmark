// useWorkspaceLifecycle — pins the workspace + cross-window-sync
// composite. The load-bearing contract: useWorkspaceBootstrap MUST run
// first so downstream sync hooks see the persisted workspace config.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("@/hooks/useWorkspaceBootstrap", () => ({
  useWorkspaceBootstrap: () => calls.push("workspaceBootstrap"),
}));
vi.mock("@/hooks/useWorkspaceRailSeed", () => ({
  useWorkspaceRailSeed: () => calls.push("workspaceRailSeed"),
}));
vi.mock("@/hooks/useSettingsSync", () => ({
  useSettingsSync: () => calls.push("settingsSync"),
}));
vi.mock("@/hooks/useConfirmQuitSync", () => ({
  useConfirmQuitSync: () => calls.push("confirmQuitSync"),
}));
vi.mock("@/hooks/useRecentFilesSync", () => ({
  useRecentFilesSync: () => calls.push("recentFilesSync"),
}));
vi.mock("@/hooks/useRecentWorkspacesSync", () => ({
  useRecentWorkspacesSync: () => calls.push("recentWorkspacesSync"),
}));
vi.mock("@/services/formats/formatSettingsBridge", () => ({
  useFormatSettingsBridge: () => calls.push("formatSettingsBridge"),
}));

import { useWorkspaceLifecycle } from "../useWorkspaceLifecycle";

beforeEach(() => {
  calls.length = 0;
});

describe("useWorkspaceLifecycle", () => {
  it("mounts every workspace hook exactly once, in the documented order", () => {
    renderHook(() => useWorkspaceLifecycle());
    expect(calls).toEqual([
      "workspaceBootstrap",
      "workspaceRailSeed",
      "settingsSync",
      "confirmQuitSync",
      "recentFilesSync",
      "recentWorkspacesSync",
      "formatSettingsBridge",
    ]);
  });

  it("runs workspace bootstrap before every sync hook (order contract)", () => {
    renderHook(() => useWorkspaceLifecycle());
    expect(calls[0]).toBe("workspaceBootstrap");
  });
});
