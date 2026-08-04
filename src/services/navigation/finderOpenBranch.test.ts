import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIsWithinRoot = vi.fn(() => false);
vi.mock("@/utils/paths", () => ({
  isWithinRoot: (...args: unknown[]) => mockIsWithinRoot(...args),
}));

import { resolveFinderOpenBranch, isSameWorkspace } from "./finderOpenBranch";

function input(over: Partial<Parameters<typeof resolveFinderOpenBranch>[0]> = {}) {
  return {
    filePath: "/a/file.md",
    existingTabId: null,
    replaceableTabId: null,
    workspaceRailMode: false,
    currentRoot: null,
    incomingWorkspace: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsWithinRoot.mockReturnValue(false);
});

describe("resolveFinderOpenBranch precedence", () => {
  it("activates an existing tab first (above everything else)", () => {
    expect(
      resolveFinderOpenBranch(
        input({ existingTabId: "tab-1", replaceableTabId: "tab-2", workspaceRailMode: true }),
      ),
    ).toEqual({ kind: "activate", tabId: "tab-1" });
  });

  it("replaces a clean untitled tab when no existing tab", () => {
    expect(
      resolveFinderOpenBranch(input({ replaceableTabId: "tab-empty" })),
    ).toEqual({ kind: "replace", replaceableTabId: "tab-empty" });
  });

  it("always creates a new tab in rail mode (no workspace adoption)", () => {
    expect(
      resolveFinderOpenBranch(
        input({ workspaceRailMode: true, currentRoot: "/ws", incomingWorkspace: "/other" }),
      ),
    ).toEqual({ kind: "create", adoptWorkspace: false });
  });

  it("creates a tab and adopts the incoming workspace when this window has none", () => {
    expect(
      resolveFinderOpenBranch(input({ currentRoot: null, incomingWorkspace: "/incoming" })),
    ).toEqual({ kind: "create", adoptWorkspace: true });
  });

  it("creates a tab without adoption when already in the same workspace", () => {
    expect(
      resolveFinderOpenBranch(
        input({ currentRoot: "/ws", incomingWorkspace: "/ws" }),
      ),
    ).toEqual({ kind: "create", adoptWorkspace: false });
  });

  it("opens a new window for a different workspace", () => {
    expect(
      resolveFinderOpenBranch(
        input({ currentRoot: "/ws-a", incomingWorkspace: "/ws-b" }),
      ),
    ).toEqual({ kind: "newWindow" });
  });
});

describe("isSameWorkspace", () => {
  it("is true when the file lives inside the current workspace", () => {
    mockIsWithinRoot.mockReturnValue(true);
    expect(isSameWorkspace("/ws/x.md", "/ws", null)).toBe(true);
  });

  it("is true when neither side has a workspace", () => {
    expect(isSameWorkspace("/loose/x.md", null, null)).toBe(true);
  });

  it("is true when the current window has no workspace (adoptable)", () => {
    expect(isSameWorkspace("/x.md", null, "/incoming")).toBe(true);
  });

  it("is false for a different incoming workspace not containing the file", () => {
    mockIsWithinRoot.mockReturnValue(false);
    expect(isSameWorkspace("/other/x.md", "/ws", "/other")).toBe(false);
  });

  it("is true when current root equals the incoming workspace", () => {
    expect(isSameWorkspace("/ws/x.md", "/ws", "/ws")).toBe(true);
  });
});
