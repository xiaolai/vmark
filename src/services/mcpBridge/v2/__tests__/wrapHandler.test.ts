// @vitest-environment node
// WI-3.2 — wrapHandler centralizes the MCP v2 handler error contract (D2).
// Audit 2026-09-03 E-01 — a typed CommandError must reach the client as its
// token + message, never as "[object Object]".

import { describe, it, expect, beforeEach, vi } from "vitest";
import { wrapHandler } from "@/services/mcpBridge/v2/wrapHandler";
import { bridgeErrorEnvelope, bridgeErrorToken } from "@/services/mcpBridge/v2/bridgeError";

vi.mock("@/services/mcpBridge/utils", () => ({
  respond: vi.fn(),
}));

import { respond } from "@/services/mcpBridge/utils";

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

  it("renders a typed CommandError as TOKEN: message with the structured half in data", async () => {
    await wrapHandler("req-3", async () => {
      // The exact wire shape src-tauri/src/command_error.rs serialises.
      throw {
        code: "conflict",
        message: "stale command: tab navigated since this operation was authorized",
        i18nKey: "errors.browser.staleCommand",
        detail: { mcpCode: "STALE_COMMAND", tabId: "tab-1" },
      };
    });

    expect(respond).toHaveBeenCalledTimes(1);
    const call = vi.mocked(respond).mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.error).toBe(
      "STALE_COMMAND: stale command: tab navigated since this operation was authorized",
    );
    expect(call.error).not.toContain("[object Object]");
    expect(call.data).toEqual({
      code: "conflict",
      token: "STALE_COMMAND",
      mcpCode: "STALE_COMMAND",
      detail: { mcpCode: "STALE_COMMAND", tabId: "tab-1" },
    });
  });

  it("derives the token from the code when Rust set no mcpCode", async () => {
    await wrapHandler("req-4", async () => {
      throw { code: "permission-denied", message: "no" };
    });
    const call = vi.mocked(respond).mock.calls[0][0];
    expect(call.error).toBe("PERMISSION_DENIED: no");
    expect(call.data).toEqual({ code: "permission-denied", token: "PERMISSION_DENIED" });
  });

  it("renders a legacy string rejection verbatim and a plain object as JSON", async () => {
    await wrapHandler("req-5", async () => {
      throw "NOT_GRANTED";
    });
    await wrapHandler("req-6", async () => {
      throw { weird: true };
    });
    const calls = vi.mocked(respond).mock.calls.map((c) => c[0]);
    expect(calls[0]).toEqual({ id: "req-5", success: false, error: "NOT_GRANTED" });
    expect(calls[1]).toEqual({ id: "req-6", success: false, error: '{"weird":true}' });
  });
});

describe("bridgeErrorToken / bridgeErrorEnvelope", () => {
  it("prefers mcpCode, falls back to UPPER_SNAKE code, and is null for untyped values", () => {
    expect(bridgeErrorToken({ code: "timeout", message: "x", detail: { mcpCode: "EVAL_TIMEOUT" } })).toBe(
      "EVAL_TIMEOUT",
    );
    expect(bridgeErrorToken({ code: "approval-required", message: "x" })).toBe("APPROVAL_REQUIRED");
    expect(bridgeErrorToken(new Error("x"))).toBeNull();
    expect(bridgeErrorToken("x")).toBeNull();
    expect(bridgeErrorToken(undefined)).toBeNull();
  });

  it("never emits the [object Object] rendering for any object shape", () => {
    for (const value of [{ code: "io", message: "m" }, { a: 1 }, {}, [1, 2]]) {
      expect(bridgeErrorEnvelope(value).error).not.toContain("[object Object]");
    }
  });
});
