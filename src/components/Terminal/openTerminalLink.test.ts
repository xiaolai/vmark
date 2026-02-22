import { vi, describe, it, expect, beforeEach } from "vitest";

const mockOpenUrl = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mockOpenUrl,
}));

import { openTerminalLink } from "./openTerminalLink";

describe("openTerminalLink", () => {
  beforeEach(() => {
    mockOpenUrl.mockReset();
    mockOpenUrl.mockResolvedValue(undefined);
  });

  it("calls openUrl with the provided URI", async () => {
    openTerminalLink("https://example.com");
    await vi.waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com");
    });
  });

  it("catches openUrl rejection without unhandled promise rejection", async () => {
    mockOpenUrl.mockRejectedValue(new Error("sandbox denied"));
    // Should not throw or cause unhandled rejection
    openTerminalLink("https://blocked.example.com");
    await vi.waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith("https://blocked.example.com");
    });
  });
});
