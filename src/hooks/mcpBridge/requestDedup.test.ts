// MCP bridge duplicate-delivery guard (audit H20).

import { describe, it, expect, beforeEach } from "vitest";
import { shouldProcessRequest, resetRequestDedup } from "./requestDedup";

describe("shouldProcessRequest", () => {
  beforeEach(() => {
    resetRequestDedup();
  });

  it("allows the first delivery of an id", () => {
    expect(shouldProcessRequest("req-1")).toBe(true);
  });

  it("drops a re-delivery of the same id (wake-and-retry)", () => {
    expect(shouldProcessRequest("req-1")).toBe(true);
    expect(shouldProcessRequest("req-1")).toBe(false);
    expect(shouldProcessRequest("req-1")).toBe(false);
  });

  it("tracks distinct ids independently", () => {
    expect(shouldProcessRequest("req-1")).toBe(true);
    expect(shouldProcessRequest("req-2")).toBe(true);
    expect(shouldProcessRequest("req-1")).toBe(false);
    expect(shouldProcessRequest("req-2")).toBe(false);
  });

  it("evicts the oldest id once capacity is exceeded", () => {
    expect(shouldProcessRequest("req-0")).toBe(true);
    for (let i = 1; i <= 256; i++) {
      expect(shouldProcessRequest(`req-${i}`)).toBe(true);
    }
    // req-0 was evicted by the 257th insert — a (theoretical) re-delivery
    // outside the window processes again rather than leaking memory.
    expect(shouldProcessRequest("req-0")).toBe(true);
    // Recent ids are still deduped.
    expect(shouldProcessRequest("req-256")).toBe(false);
  });
});
