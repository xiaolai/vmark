// MCP bridge duplicate-delivery guard (audit 20260612 H20 + cross-model
// review: duplicates of COMPLETED requests must re-send the cached response
// so the bridge's retry channel is never starved).

import { describe, it, expect, beforeEach } from "vitest";
import type { McpResponse } from "./types";
import {
  classifyDelivery,
  recordResponse,
  resetRequestDedup,
} from "./requestDedup";

function res(id: string): McpResponse {
  return { id, success: true, data: { ok: true } } as McpResponse;
}

describe("classifyDelivery", () => {
  beforeEach(() => {
    resetRequestDedup();
  });

  it("executes the first delivery of an id", () => {
    expect(classifyDelivery("req-1")).toBe("execute");
  });

  it("drops a re-delivery while the request is still in flight", () => {
    expect(classifyDelivery("req-1")).toBe("execute");
    expect(classifyDelivery("req-1")).toBe("drop");
    expect(classifyDelivery("req-1")).toBe("drop");
  });

  it("returns the cached response for a re-delivery of a completed request", () => {
    expect(classifyDelivery("req-1")).toBe("execute");
    recordResponse(res("req-1"));
    const second = classifyDelivery("req-1");
    expect(second).not.toBe("execute");
    expect(second).not.toBe("drop");
    expect((second as McpResponse).id).toBe("req-1");
  });

  it("tracks distinct ids independently", () => {
    expect(classifyDelivery("req-1")).toBe("execute");
    expect(classifyDelivery("req-2")).toBe("execute");
    expect(classifyDelivery("req-1")).toBe("drop");
    expect(classifyDelivery("req-2")).toBe("drop");
  });

  it("ignores recordResponse for ids that never arrived via the dispatcher", () => {
    recordResponse(res("never-dispatched"));
    // First sighting still executes — the cache entry was not created.
    expect(classifyDelivery("never-dispatched")).toBe("execute");
  });

  it("evicts the oldest id once capacity is exceeded", () => {
    expect(classifyDelivery("req-0")).toBe("execute");
    for (let i = 1; i <= 256; i++) {
      expect(classifyDelivery(`req-${i}`)).toBe("execute");
    }
    // req-0 was evicted by the 257th insert — a (theoretical) re-delivery
    // outside the window executes again rather than leaking memory.
    expect(classifyDelivery("req-0")).toBe("execute");
    // Recent ids are still deduped.
    expect(classifyDelivery("req-256")).toBe("drop");
  });
});
