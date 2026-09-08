// WI-FL2.1 — migrateRemoveMcpPort drops the retired advanced.mcpServer.port; WI-FL2.2 — migrateRemoveAutoHideStatusBar drops appearance.autoHideStatusBar
// @vitest-environment node
// Persisted-blob migrations. Each runs on the raw, untrusted localStorage
// object BEFORE shape-sanitisation, so every one is exercised against a
// missing, non-object or corrupt section as well as the happy path.
import { describe, it, expect } from "vitest";
import * as migrations from "./migrations";
import {
  migrateRemoveInputGate,
  migrateRemoveAutoHideStatusBar,
  migrateRemoveMcpPort,
  migrateRemoveWorkflowViewer,
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

// ── WI-FL2.2 (D8): appearance.autoHideStatusBar never had a consumer ──────────
describe("migrateRemoveAutoHideStatusBar (WI-FL2.2)", () => {
  type Raw = Record<string, unknown>;
  const appearance = (raw: Raw) => raw.appearance as Record<string, unknown>;

  it("deletes the persisted flag and leaves the other appearance keys alone", () => {
    const raw: Raw = {
      appearance: { autoHideStatusBar: true, fontSize: 18, showFilenameInTitlebar: true },
      general: { tabSize: 2 },
    };
    migrateRemoveAutoHideStatusBar(raw);
    expect("autoHideStatusBar" in appearance(raw)).toBe(false);
    expect(appearance(raw)).toEqual({ fontSize: 18, showFilenameInTitlebar: true });
    expect(raw.general).toEqual({ tabSize: 2 });
  });

  it("deletes the flag whatever its persisted value — false and corrupt included", () => {
    for (const value of [false, "yes", 0, null]) {
      const raw: Raw = { appearance: { autoHideStatusBar: value } };
      migrateRemoveAutoHideStatusBar(raw);
      expect("autoHideStatusBar" in appearance(raw)).toBe(false);
    }
  });

  it("is a no-op when the flag is absent (fresh install or already migrated)", () => {
    const raw: Raw = { appearance: { fontSize: 18 } };
    migrateRemoveAutoHideStatusBar(raw);
    expect(raw).toEqual({ appearance: { fontSize: 18 } });
  });

  it("tolerates a missing or non-object appearance section", () => {
    const missing: Raw = {};
    expect(() => migrateRemoveAutoHideStatusBar(missing)).not.toThrow();
    expect(missing).toEqual({});
    const corrupt: Raw = { appearance: "evil" };
    migrateRemoveAutoHideStatusBar(corrupt);
    expect(corrupt.appearance).toBe("evil");
  });

  it("is idempotent", () => {
    const raw: Raw = { appearance: { autoHideStatusBar: true, fontSize: 18 } };
    migrateRemoveAutoHideStatusBar(raw);
    const once = structuredClone(raw);
    migrateRemoveAutoHideStatusBar(raw);
    expect(raw).toEqual(once);
  });
});

// ── WI-FL2.1 (D9): advanced.mcpServer.port was forwarded and ignored ─────────
describe("migrateRemoveMcpPort (WI-FL2.1)", () => {
  type Raw = Record<string, unknown>;
  const mcp = (raw: Raw) =>
    (raw.advanced as Record<string, unknown>).mcpServer as Record<string, unknown>;

  it("deletes only the port — autoStart and autoApproveEdits are live settings", () => {
    const raw: Raw = {
      advanced: {
        mcpServer: { port: 9223, autoStart: false, autoApproveEdits: true },
        developerMode: true,
      },
    };
    migrateRemoveMcpPort(raw);
    expect("port" in mcp(raw)).toBe(false);
    expect(mcp(raw)).toEqual({ autoStart: false, autoApproveEdits: true });
    expect((raw.advanced as Record<string, unknown>).developerMode).toBe(true);
  });

  it("deletes a customised port too — it was never honoured", () => {
    const raw: Raw = { advanced: { mcpServer: { port: 4242 } } };
    migrateRemoveMcpPort(raw);
    expect(mcp(raw)).toEqual({});
  });

  it("is a no-op when the port is absent (fresh install or already migrated)", () => {
    const raw: Raw = { advanced: { mcpServer: { autoStart: true } } };
    migrateRemoveMcpPort(raw);
    expect(raw).toEqual({ advanced: { mcpServer: { autoStart: true } } });
  });

  it("tolerates a missing or non-object advanced / mcpServer section", () => {
    for (const raw of [
      {},
      { advanced: "evil" },
      { advanced: {} },
      { advanced: { mcpServer: null } },
      { advanced: { mcpServer: 9223 } },
    ] as Raw[]) {
      const before = structuredClone(raw);
      expect(() => migrateRemoveMcpPort(raw)).not.toThrow();
      expect(raw).toEqual(before);
    }
  });

  it("is idempotent", () => {
    const raw: Raw = { advanced: { mcpServer: { port: 9223, autoStart: true } } };
    migrateRemoveMcpPort(raw);
    const once = structuredClone(raw);
    migrateRemoveMcpPort(raw);
    expect(raw).toEqual(once);
  });
});

// ── WI-FL2.6 (D6): advanced.workflowViewer is gone — the viewer ships on ─────
//
// The GitHub Actions workbench was always unconditional and the split-pane
// source aids never consulted the flag; the markdown assembly path was its last
// reader, and that is unconditional now too. A persisted value — EITHER value —
// is dead weight that `sanitizePersistedSettings` would forward and write back
// on every persist. Both values are exercised on purpose: a stale `true` is the
// opted-in user (who loses nothing, the viewer is always on) and a stale `false`
// is an opt-out that can no longer mean anything.
describe("migrateRemoveWorkflowViewer (WI-FL2.6)", () => {
  type Raw = Record<string, unknown>;
  const advanced = (raw: Raw) => raw.advanced as Record<string, unknown>;

  it.each([
    { persisted: true, engine: true },
    { persisted: true, engine: false },
    { persisted: false, engine: true },
    { persisted: false, engine: false },
  ])(
    "drops a persisted viewer=$persisted and leaves engine=$engine exactly as persisted",
    ({ persisted, engine }) => {
      const raw: Raw = {
        advanced: { workflowViewer: persisted, workflowEngine: engine, developerMode: true },
      };
      migrateRemoveWorkflowViewer(raw);
      expect("workflowViewer" in advanced(raw)).toBe(false);
      expect(advanced(raw)).toEqual({ workflowEngine: engine, developerMode: true });
    },
  );

  it("is a no-op when the key is absent (fresh install or already migrated)", () => {
    const raw: Raw = { advanced: { workflowEngine: true }, general: { tabSize: 2 } };
    migrateRemoveWorkflowViewer(raw);
    expect(raw).toEqual({ advanced: { workflowEngine: true }, general: { tabSize: 2 } });
  });

  it("the WI-19 split migration is retired with the flag — nothing re-creates the key", () => {
    // `migrateSplitWorkflowFlags` fanned `workflowEngine` out into
    // `workflowViewer` on every load of a blob that lacked it. Kept alongside
    // this migration, the pair would only have been right in one run order.
    expect("migrateSplitWorkflowFlags" in migrations).toBe(false);
  });

  it("deletes the key whatever its persisted value — corrupt included", () => {
    for (const value of ["true", 1, null]) {
      const raw: Raw = { advanced: { workflowViewer: value, workflowEngine: false } };
      migrateRemoveWorkflowViewer(raw);
      expect("workflowViewer" in advanced(raw)).toBe(false);
      expect(advanced(raw).workflowEngine).toBe(false);
    }
  });

  it("tolerates a missing or non-object advanced section", () => {
    for (const raw of [{}, { advanced: "evil" }, { advanced: null }, { advanced: 7 }] as Raw[]) {
      const before = structuredClone(raw);
      expect(() => migrateRemoveWorkflowViewer(raw)).not.toThrow();
      expect(raw).toEqual(before);
    }
  });

  it("is idempotent", () => {
    const raw: Raw = { advanced: { workflowViewer: true, workflowEngine: true } };
    migrateRemoveWorkflowViewer(raw);
    const once = structuredClone(raw);
    migrateRemoveWorkflowViewer(raw);
    expect(raw).toEqual(once);
  });
});

// Audit 20260907 (#495): the store's merge listed the migrations by hand, so a
// new migration that was exported but not added to that list silently never
// ran. The ordered pipeline lives here, and this pins that it is complete.
describe("PERSISTED_SETTINGS_MIGRATIONS (#495)", () => {
  it("contains every exported migration, once, so an exported step cannot be left inactive", () => {
    const exported = Object.entries(migrations)
      .filter(([name, value]) => name.startsWith("migrate") && typeof value === "function")
      .map(([, fn]) => fn);
    expect(exported.length).toBeGreaterThan(0);
    const pipeline = migrations.PERSISTED_SETTINGS_MIGRATIONS as readonly unknown[];
    for (const fn of exported) expect(pipeline).toContain(fn);
    expect(new Set(pipeline).size).toBe(pipeline.length);
  });

  it("runPersistedSettingsMigrations applies every step in order on one raw blob", () => {
    const raw: Record<string, unknown> = {
      appearance: { paragraphSpacing: "loose", autoHideStatusBar: true },
      terminal: { inputGate: "gate" },
      advanced: { workspaceRailMode: true, mcpServer: { port: 1 }, workflowViewer: true },
    };
    migrations.runPersistedSettingsMigrations(raw);
    expect(raw.appearance).toEqual({ blockSpacing: "loose" });
    expect(raw.terminal).toEqual({});
    expect(raw.advanced).toEqual({ mcpServer: {} });
    expect(raw.general).toEqual({ workspaceRailMode: true });
  });
});
