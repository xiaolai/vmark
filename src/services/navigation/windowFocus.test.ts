// @vitest-environment node
/**
 * Tests for useWindowFocus — window label retrieval
 *
 * @module services/navigation/windowFocus.test
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
  })),
}));

import { getWindowLabel } from "./windowFocus";

describe("getWindowLabel", () => {
  it("returns the current window label", () => {
    const label = getWindowLabel();

    expect(label).toBe("main");
  });
});
