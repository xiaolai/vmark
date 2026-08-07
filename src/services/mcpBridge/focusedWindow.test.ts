// @vitest-environment node
// #1208 — resolving which window the USER is looking at, as opposed to which
// window happens to be answering an MCP request. The distinction only exists
// in a multi-window session, which is why the bug hid for so long.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAllWebviewWindows } = vi.hoisted(() => ({ getAllWebviewWindows: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getAllWebviewWindows }));

import { resolveFocusedWindowLabel } from "./focusedWindow";

function win(label: string, focused: boolean | Error) {
  return {
    label,
    isFocused: () => (focused instanceof Error ? Promise.reject(focused) : Promise.resolve(focused)),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("resolveFocusedWindowLabel", () => {
  it("returns the label of the focused window", async () => {
    getAllWebviewWindows.mockResolvedValue([win("main", false), win("doc-1", true)]);
    await expect(resolveFocusedWindowLabel()).resolves.toBe("doc-1");
  });

  it("returns null when no window holds focus — the app is in the background", async () => {
    getAllWebviewWindows.mockResolvedValue([win("main", false), win("doc-1", false)]);
    await expect(resolveFocusedWindowLabel()).resolves.toBeNull();
  });

  it("returns null for an empty window list", async () => {
    getAllWebviewWindows.mockResolvedValue([]);
    await expect(resolveFocusedWindowLabel()).resolves.toBeNull();
  });

  it("returns undefined — UNKNOWN, not 'none' — when the platform API fails", async () => {
    // The caller must be able to tell "nobody is focused" from "I could not
    // find out", because only the second one may fall back to a guess.
    getAllWebviewWindows.mockRejectedValue(new Error("no tauri"));
    await expect(resolveFocusedWindowLabel()).resolves.toBeUndefined();
  });

  it("returns undefined when a per-window focus probe throws", async () => {
    getAllWebviewWindows.mockResolvedValue([win("main", new Error("gone"))]);
    await expect(resolveFocusedWindowLabel()).resolves.toBeUndefined();
  });

  it("takes the first focused window when the platform reports more than one", async () => {
    // Not reachable on a sane platform; pinned so the answer stays a single
    // label rather than becoming order-dependent noise.
    getAllWebviewWindows.mockResolvedValue([win("main", true), win("doc-1", true)]);
    await expect(resolveFocusedWindowLabel()).resolves.toBe("main");
  });
});
