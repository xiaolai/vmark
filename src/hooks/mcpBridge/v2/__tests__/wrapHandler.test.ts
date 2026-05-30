// WI-3.2 — wrapHandler centralizes the MCP v2 handler error contract (D2).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { wrapHandler } from "../wrapHandler";

vi.mock("../../utils", () => ({
  respond: vi.fn(),
}));

import { respond } from "../../utils";

describe("wrapHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts a thrown error into a structured failure respond", async () => {
    await wrapHandler("req-1", async () => {
      throw new Error("boom");
    });

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "boom",
    });
  });

  it("does not call respond itself on the happy path", async () => {
    await wrapHandler("req-2", async () => {
      // happy path owns its own respond — wrapHandler stays out of it
    });

    expect(respond).not.toHaveBeenCalled();
  });
});
