import { describe, it, expect } from "vitest";
import { migrateInputGateDefaultFlip } from "./migrations";

describe("migrateInputGateDefaultFlip (WI-4a)", () => {
  it("clears a persisted 'legacy' (the old default, never an explicit opt-out)", () => {
    const raw: Record<string, unknown> = { terminal: { inputGate: "legacy", fontSize: 13 } };
    migrateInputGateDefaultFlip(raw);
    expect((raw.terminal as Record<string, unknown>).inputGate).toBeUndefined();
    // Unrelated keys are untouched.
    expect((raw.terminal as Record<string, unknown>).fontSize).toBe(13);
  });

  it("keeps a persisted 'gate' (an early DevTools opt-in is a real choice)", () => {
    const raw: Record<string, unknown> = { terminal: { inputGate: "gate" } };
    migrateInputGateDefaultFlip(raw);
    expect((raw.terminal as Record<string, unknown>).inputGate).toBe("gate");
  });

  it("is a no-op when terminal is absent or not an object", () => {
    const a: Record<string, unknown> = {};
    expect(() => migrateInputGateDefaultFlip(a)).not.toThrow();
    const b: Record<string, unknown> = { terminal: "nope" };
    migrateInputGateDefaultFlip(b);
    expect(b.terminal).toBe("nope");
  });

  it("is a no-op when inputGate is absent (fresh install)", () => {
    const raw: Record<string, unknown> = { terminal: { fontSize: 13 } };
    migrateInputGateDefaultFlip(raw);
    expect("inputGate" in (raw.terminal as Record<string, unknown>)).toBe(false);
  });
});
