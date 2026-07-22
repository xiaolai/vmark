import { describe, it, expect } from "vitest";
import { migrateRemoveInputGate } from "./migrations";

describe("migrateRemoveInputGate (WI-4b cleanup)", () => {
  it("deletes a stale persisted terminal.inputGate", () => {
    const raw: Record<string, unknown> = { terminal: { inputGate: "gate", fontSize: 13 } };
    migrateRemoveInputGate(raw);
    expect("inputGate" in (raw.terminal as Record<string, unknown>)).toBe(false);
    expect((raw.terminal as Record<string, unknown>).fontSize).toBe(13);
  });

  it("also deletes a stale 'legacy' value", () => {
    const raw: Record<string, unknown> = { terminal: { inputGate: "legacy" } };
    migrateRemoveInputGate(raw);
    expect("inputGate" in (raw.terminal as Record<string, unknown>)).toBe(false);
  });

  it("is a no-op when terminal is absent or not an object", () => {
    const a: Record<string, unknown> = {};
    expect(() => migrateRemoveInputGate(a)).not.toThrow();
    const b: Record<string, unknown> = { terminal: "nope" };
    migrateRemoveInputGate(b);
    expect(b.terminal).toBe("nope");
  });

  it("is a no-op when inputGate is absent (fresh install)", () => {
    const raw: Record<string, unknown> = { terminal: { fontSize: 13 } };
    migrateRemoveInputGate(raw);
    expect("inputGate" in (raw.terminal as Record<string, unknown>)).toBe(false);
  });
});
