import { describe, it, expect, vi, beforeEach } from "vitest";
import { terminalLog } from "@/utils/debug";

vi.mock("@/utils/debug", () => ({
  terminalLog: vi.fn(),
  clipboardWarn: vi.fn(),
}));

const mockOpenUrl = vi.fn();

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));

describe("openTerminalLink", () => {
  let openTerminalLink: typeof import("./openTerminalLink").openTerminalLink;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockOpenUrl.mockResolvedValue(undefined);
    const mod = await import("./openTerminalLink");
    openTerminalLink = mod.openTerminalLink;
  });

  it("calls openUrl with the given URI", async () => {
    await openTerminalLink("https://example.com");
    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("catches openUrl rejection and logs the error", async () => {
    mockOpenUrl.mockRejectedValue(new Error("sandbox denied"));

    await openTerminalLink("https://example.com");

    expect(terminalLog).toHaveBeenCalledWith(
      "Failed to open URL:",
      "sandbox denied",
    );
  });

  it("handles non-Error rejection values", async () => {
    mockOpenUrl.mockRejectedValue("string error");

    await openTerminalLink("bad://uri");

    expect(terminalLog).toHaveBeenCalledWith(
      "Failed to open URL:",
      "string error",
    );
  });
});
