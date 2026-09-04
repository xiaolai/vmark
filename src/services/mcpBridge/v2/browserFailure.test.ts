// @vitest-environment node
/**
 * WI-14 — the two questions a browser refusal has to answer, in isolation.
 *
 * The handler-level behaviour lives in `__tests__/browserNavigation.test.ts`;
 * these pin the decisions themselves, including the hazards the substring match
 * they replaced could not avoid — and, since round 4 (#48), that the substring
 * fallback itself is gone. Nothing is mocked — both functions are pure.
 *
 * @module services/mcpBridge/v2/browserFailure.test
 */
import { describe, it, expect } from "vitest";
import wire from "@/test/fixtures/commandErrorWire.json";
import { browserFailureToken, needsNavigationApproval } from "./browserFailure";

describe("needsNavigationApproval", () => {
  it("is true only for the typed approval-required code", () => {
    expect(needsNavigationApproval(wire.browserApprovalRequired)).toBe(true);
    expect(needsNavigationApproval({ code: "permission-denied", message: "blocked" })).toBe(false);
    expect(needsNavigationApproval({ code: "conflict", message: "stale" })).toBe(false);
  });

  it("does not fire on a typed error whose MESSAGE contains the legacy token", () => {
    // The exact hazard of `String(error).includes("APPROVAL_REQUIRED")`: an SSRF
    // refusal that merely mentions the token would have opened a prompt for a
    // destination no approval can unblock.
    expect(
      needsNavigationApproval({
        code: "permission-denied",
        message: "blocked; this is not APPROVAL_REQUIRED",
      }),
    ).toBe(false);
  });

  // Round 4, #48 — the substring fallback is GONE. Every browser command returns
  // a typed CommandError (the ratchet baseline has no `src-tauri/src/browser/`
  // entry left), so an untyped rejection is never an approval: the only things
  // that can still arrive untyped are a caller-controlled URL or message that
  // happens to contain the word, and a thrown `Error` from the webview's own
  // plumbing — and neither is something a user approval can lift.
  it("never treats an UNTYPED rejection as approvable, even one that contains the word", () => {
    expect(needsNavigationApproval("APPROVAL_REQUIRED")).toBe(false);
    expect(needsNavigationApproval(new Error("APPROVAL_REQUIRED"))).toBe(false);
    expect(needsNavigationApproval(new Error("navigate to https://evil.example/?APPROVAL_REQUIRED failed"))).toBe(false);
    expect(needsNavigationApproval({ reason: "APPROVAL_REQUIRED" })).toBe(false);
    expect(needsNavigationApproval(["APPROVAL_REQUIRED"])).toBe(false);
    expect(needsNavigationApproval("WINDOW_UNAVAILABLE")).toBe(false);
    expect(needsNavigationApproval(undefined)).toBe(false);
    expect(needsNavigationApproval(null)).toBe(false);
  });

  it("a typed error whose MESSAGE is exactly the legacy sentinel still decides by code alone", () => {
    expect(needsNavigationApproval({ code: "conflict", message: "APPROVAL_REQUIRED" })).toBe(false);
    expect(needsNavigationApproval({ code: "approval-required", message: "anything" })).toBe(true);
  });
});

describe("browserFailureToken", () => {
  it("prefers the MCP token Rust attached", () => {
    expect(
      browserFailureToken({
        code: "permission-denied",
        message: "blocked",
        detail: { mcpCode: "SSRF_BLOCKED" },
      }),
    ).toBe("SSRF_BLOCKED");
  });

  it("derives a SCREAMING_SNAKE token from the code when none was attached", () => {
    expect(browserFailureToken({ code: "approval-required", message: "x" })).toBe(
      "APPROVAL_REQUIRED",
    );
    expect(browserFailureToken({ code: "io", message: "x" })).toBe("IO");
  });

  it("ignores a non-string mcpCode rather than sending the AI an object", () => {
    expect(
      browserFailureToken({ code: "conflict", message: "x", detail: { mcpCode: 7 } }),
    ).toBe("CONFLICT");
  });

  it("passes a legacy string rejection through unchanged, and renders others by message", () => {
    expect(browserFailureToken("SSRF_BLOCKED")).toBe("SSRF_BLOCKED");
    expect(browserFailureToken(new Error("boom"))).toBe("boom");
    // An untyped OBJECT rejection used to print "[object Object]" (the WI-14 class).
    expect(browserFailureToken({ reason: "socket closed" })).not.toBe("[object Object]");
  });

  it("never emits [object Object] for a typed rejection", () => {
    expect(browserFailureToken(wire.browserApprovalRequired)).not.toContain("[object Object]");
  });
});
