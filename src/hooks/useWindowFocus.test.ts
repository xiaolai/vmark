/**
 * Tests for useWindowFocus — window label retrieval
 *
 * @module hooks/useWindowFocus.test
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
  })),
}));

import { getWindowLabel } from "./useWindowFocus";

describe("getWindowLabel", () => {
  it("returns the current window label", () => {
    const label = getWindowLabel();

    expect(label).toBe("main");
  });
});
