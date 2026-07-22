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
