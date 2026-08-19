// @vitest-environment node
// WI-NB2.2 — the gate probe: one best-effort read-class eval, parsed and
// classified. Contract: NEVER throws, NEVER blocks a navigation result — every
// failure shape (rejected invoke, non-JSON, wrong shape) is null.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { probeGate } from "@/services/mcpBridge/v2/browserGateProbe";

const LOGIN = {
  url: "https://x.example.com/login",
  title: "Sign in — X",
  textHead: "Username. Password.",
  challengeWidget: false,
  passwordField: true,
};

// Braces matter: an arrow WITHOUT them returns the mock (a function), which
// vitest treats as a registered CLEANUP callback and calls after the test —
// re-invoking whatever implementation the test installed.
beforeEach(() => {
  invoke.mockReset();
});

describe("probeGate", () => {
  it("runs a read-class eval and classifies the signals", async () => {
    invoke.mockResolvedValue(JSON.stringify(LOGIN));
    const gate = await probeGate("tab-1", 3);
    expect(gate?.kind).toBe("login-required");
    expect(invoke).toHaveBeenCalledWith(
      "browser_eval",
      expect.objectContaining({ tabId: "tab-1", operation: "read", generation: 3 }),
    );
  });

  it("is null for an ordinary page", async () => {
    invoke.mockResolvedValue(
      JSON.stringify({ url: "https://x/", title: "X", textHead: "hi", challengeWidget: false, passwordField: false }),
    );
    expect(await probeGate("tab-1", 1)).toBeNull();
  });

  it.each([
    ["throwing invoke", () => invoke.mockImplementation(() => { throw new Error("stale"); })],
    ["non-JSON result", () => invoke.mockResolvedValue("<timeout>")],
    ["wrong shape", () => invoke.mockResolvedValue(JSON.stringify({ nope: true }))],
    ["non-string result", () => invoke.mockResolvedValue(42)],
  ])("never throws: %s → null", async (_label, arm) => {
    arm();
    expect(await probeGate("tab-1", 1)).toBeNull();
  });
});
