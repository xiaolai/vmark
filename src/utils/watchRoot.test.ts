// @vitest-environment node
import { describe, expect, it } from "vitest";

import { pickWatchRoot } from "./watchRoot";

describe("pickWatchRoot", () => {
  it("watches the workspace root in workspace mode", () => {
    expect(
      pickWatchRoot({ isWorkspaceMode: true, workspaceRoot: "/ws", activeFilePath: "/other/a.md" }),
    ).toBe("/ws");
  });

  it("falls back to the active document's directory outside workspace mode", () => {
    expect(
      pickWatchRoot({ isWorkspaceMode: false, workspaceRoot: null, activeFilePath: "/docs/a.md" }),
    ).toBe("/docs");
  });

  it("ignores the workspace root when not in workspace mode", () => {
    expect(
      pickWatchRoot({ isWorkspaceMode: false, workspaceRoot: "/ws", activeFilePath: "/docs/a.md" }),
    ).toBe("/docs");
  });

  it("returns null when a workspace has no root yet", () => {
    expect(
      pickWatchRoot({ isWorkspaceMode: true, workspaceRoot: null, activeFilePath: null }),
    ).toBeNull();
  });

  it("returns null when nothing is open", () => {
    expect(
      pickWatchRoot({ isWorkspaceMode: false, workspaceRoot: null, activeFilePath: null }),
    ).toBeNull();
  });

  it("returns the parent directory for a Windows path", () => {
    expect(
      pickWatchRoot({ isWorkspaceMode: false, workspaceRoot: null, activeFilePath: "C:\\docs\\a.md" }),
    ).toBe("C:\\docs");
  });

  it("returns null for a bare filename with no directory", () => {
    expect(
      pickWatchRoot({ isWorkspaceMode: false, workspaceRoot: null, activeFilePath: "a.md" }),
    ).toBeNull();
  });
});
