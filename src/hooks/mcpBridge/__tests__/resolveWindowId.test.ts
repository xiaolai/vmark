/**
 * Tests for resolveWindowId utility.
 *
 * Verifies that windowId resolution uses getCurrentWindowLabel()
 * instead of hardcoded "main", enabling correct per-window routing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockWindowLabel = "main";
vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => mockWindowLabel,
}));

// Must mock all named exports that utils.ts imports
vi.mock("@/stores/tiptapEditorStore", () => ({
  useTiptapEditorStore: { getState: () => ({ editor: null }) },
}));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: () => ({ advanced: { mcpServer: { autoApproveEdits: false } } }) },
}));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ activeTabId: { main: "t1", "doc-0": "t2" } }) },
}));
vi.mock("@/utils/markdownPipeline", () => ({
  serializeMarkdown: () => "",
}));

import { resolveWindowId, getActiveTabId } from "../utils";

describe("resolveWindowId", () => {
  beforeEach(() => {
    mockWindowLabel = "main";
  });

  it("resolves 'focused' to current window label", () => {
    mockWindowLabel = "doc-0";
    expect(resolveWindowId("focused")).toBe("doc-0");
  });

  it("resolves undefined to current window label", () => {
    mockWindowLabel = "doc-1";
    expect(resolveWindowId(undefined)).toBe("doc-1");
  });

  it("returns explicit window label as-is", () => {
    expect(resolveWindowId("doc-5")).toBe("doc-5");
  });

  it("resolves 'focused' to 'main' when main window is active", () => {
    expect(resolveWindowId("focused")).toBe("main");
  });
});

describe("getActiveTabId", () => {
  beforeEach(() => {
    mockWindowLabel = "main";
  });

  it("returns active tab for current window when no label given", () => {
    mockWindowLabel = "doc-0";
    expect(getActiveTabId()).toBe("t2");
  });

  it("returns active tab for explicit window label", () => {
    expect(getActiveTabId("main")).toBe("t1");
  });

  it("returns 'unknown' for non-existent window", () => {
    expect(getActiveTabId("doc-999")).toBe("unknown");
  });
});
