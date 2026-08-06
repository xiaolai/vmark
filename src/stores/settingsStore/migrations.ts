function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Remove the retired `terminal.inputGate` flag (WI-4b deleted Channel-Ownership's
 * toggle). `sanitizePersistedSettings` forwards unknown keys, so without this the
 * stale value would linger in live state and be written back on every persist.
 * Runs before deep-merge.
 */
export function migrateRemoveInputGate(rawPersisted: Record<string, unknown>): void {
  const terminal = rawPersisted.terminal;
  if (isPlainObject(terminal) && "inputGate" in terminal) {
    delete terminal.inputGate;
  }
}

export function migrateWorkspaceRailModeToGeneral(
  rawPersisted: Record<string, unknown>,
): void {
  const advanced = rawPersisted.advanced;
  if (!isPlainObject(advanced)) return;

  const legacyValue = advanced.workspaceRailMode;
  if (typeof legacyValue !== "boolean") return;

  if (!isPlainObject(rawPersisted.general)) rawPersisted.general = {};

  const general = rawPersisted.general;
  if (isPlainObject(general) && typeof general.workspaceRailMode !== "boolean") {
    general.workspaceRailMode = legacyValue;
  }

  delete advanced.workspaceRailMode;
}

/**
 * WI-19 — fan `advanced.workflowEngine` out into `workflowViewer` +
 * `workflowEngine`.
 *
 * One flag gated two unrelated features: the GitHub Actions VIEWER extras
 * (expression completion, cursor↔canvas sync, `uses:` goto-def — read-only
 * aids over the `gha` IR) and the bespoke EXECUTION engine (Run/Cancel and the
 * `run_workflow` runner, which spawns AI providers and writes files). A user
 * who wanted GHA authoring had to switch the runner on.
 *
 * A user who already opted in keeps everything they had, so `true` fans out to
 * BOTH. A fresh install is left untouched — writing `false` here would be
 * indistinguishable from an explicit opt-out and would freeze the defaults.
 * Idempotent: once `workflowViewer` exists, the value persisted wins.
 *
 * Runs before deep-merge, on the untrusted raw blob — hence the isPlainObject
 * and typeof guards.
 */
export function migrateSplitWorkflowFlags(
  rawPersisted: Record<string, unknown>,
): void {
  const advanced = rawPersisted.advanced;
  if (!isPlainObject(advanced)) return;
  // Already split — the persisted pair is authoritative.
  if (typeof advanced.workflowViewer === "boolean") return;
  const legacy = advanced.workflowEngine;
  // Absent (fresh install) or corrupt: leave it to the defaults and to
  // sanitizePersistedSettings, which drops a non-boolean leaf.
  if (typeof legacy !== "boolean") return;
  advanced.workflowViewer = legacy;
}
