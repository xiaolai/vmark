import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

const findTabById = vi.fn();
vi.mock("./tabStore", () => ({
  useTabStore: {
    getState: () => ({ activeTabId: { main: "t1" }, findTabById }),
  },
}));

import { selectSourceEditing } from "./selectSourceEditing";

beforeEach(() => {
  findTabById.mockReset().mockReturnValue({ formatId: "markdown" });
});

describe("selectSourceEditing", () => {
  it("is true in Source mode regardless of tab format", () => {
    findTabById.mockReturnValue({ formatId: "json" });
    expect(selectSourceEditing({ sourceMode: true, markdownSplitView: false })).toBe(true);
  });

  it("is true in Split view when the active tab is markdown", () => {
    expect(selectSourceEditing({ sourceMode: false, markdownSplitView: true })).toBe(true);
  });

  it("is FALSE in Split view when the active tab is NOT markdown (no misroute)", () => {
    findTabById.mockReturnValue({ formatId: "json" });
    expect(selectSourceEditing({ sourceMode: false, markdownSplitView: true })).toBe(false);
  });

  it("is false in plain WYSIWYG", () => {
    expect(selectSourceEditing({ sourceMode: false, markdownSplitView: false })).toBe(false);
  });
});
