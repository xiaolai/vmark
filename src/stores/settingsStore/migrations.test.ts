// WI-19 — the workflowEngine → workflowViewer + workflowEngine split.
import { describe, it, expect } from "vitest";
import {
  migrateRemoveInputGate,
  migrateSplitWorkflowFlags,
} from "./migrations";

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

// ── WI-19: advanced.workflowEngine → advanced.workflowViewer + workflowEngine ──
//
// One flag used to gate two unrelated features: the GitHub Actions workflow
// VIEWER (expression completion, cursor↔canvas sync, `uses:` goto-def — all
// reading the `gha` IR) and the bespoke YAML EXECUTION ENGINE (the side panel's
// Run/Cancel controls and the `run_workflow` Rust runner). A user who wanted
// GHA authoring had to switch on an execution engine that spawns AI providers
// and writes files. The migration must not take anything away from a user who
// already opted in, which is why `true` fans out to BOTH.
describe("migrateSplitWorkflowFlags (WI-19)", () => {
  type Raw = Record<string, unknown>;
  const advanced = (raw: Raw) => raw.advanced as Record<string, unknown>;

  // Factories, not shared literals: every case gets a fresh object, so the
  // idempotency block below cannot be handed something the table block already
  // migrated (which would prove idempotence of the second run only).
  const cases: Array<{
    name: string;
    make: () => Raw;
    viewer: boolean | undefined;
    engine: boolean | undefined;
  }> = [
    {
      name: "opted-in user: workflowEngine true → both flags true",
      make: () => ({ advanced: { workflowEngine: true } }),
      viewer: true,
      engine: true,
    },
    {
      name: "explicit off: workflowEngine false → both flags false",
      make: () => ({ advanced: { workflowEngine: false } }),
      viewer: false,
      engine: false,
    },
    {
      name: "already split: an existing pair is left exactly as persisted",
      make: () => ({ advanced: { workflowViewer: true, workflowEngine: false } }),
      viewer: true,
      engine: false,
    },
    {
      name: "already split the other way round",
      make: () => ({ advanced: { workflowViewer: false, workflowEngine: true } }),
      viewer: false,
      engine: true,
    },
  ];

  it.each(cases)("$name", ({ make, viewer, engine }) => {
    const input = make();
    migrateSplitWorkflowFlags(input);
    expect(advanced(input).workflowViewer).toBe(viewer);
    expect(advanced(input).workflowEngine).toBe(engine);
  });

  it("leaves a fresh install alone — defaults decide, not the migration", () => {
    // Writing `false` here would be indistinguishable from an explicit opt-out
    // and would defeat any later change of default.
    const raw: Raw = {};
    migrateSplitWorkflowFlags(raw);
    expect(raw).toEqual({});

    const empty: Raw = { advanced: {} };
    migrateSplitWorkflowFlags(empty);
    expect("workflowViewer" in advanced(empty)).toBe(false);
    expect("workflowEngine" in advanced(empty)).toBe(false);
  });

  it("is a no-op when `advanced` is not an object (corrupt blob)", () => {
    const raw: Raw = { advanced: "evil" };
    expect(() => migrateSplitWorkflowFlags(raw)).not.toThrow();
    expect(raw.advanced).toBe("evil");
  });

  it("ignores a non-boolean workflowEngine — persistGuards drops it later", () => {
    const raw: Raw = { advanced: { workflowEngine: "true" } };
    migrateSplitWorkflowFlags(raw);
    expect("workflowViewer" in advanced(raw)).toBe(false);
    expect(advanced(raw).workflowEngine).toBe("true");
  });

  it.each(cases)("is idempotent — running twice is identity ($name)", ({ make }) => {
    const input = make();
    migrateSplitWorkflowFlags(input);
    const afterOnce = structuredClone(input);
    migrateSplitWorkflowFlags(input);
    expect(input).toEqual(afterOnce);
  });

  it("preserves unrelated advanced keys", () => {
    const raw: Raw = {
      advanced: { workflowEngine: true, developerMode: true, mcpServer: { port: 9223 } },
    };
    migrateSplitWorkflowFlags(raw);
    expect(advanced(raw).developerMode).toBe(true);
    expect(advanced(raw).mcpServer).toEqual({ port: 9223 });
  });
});
