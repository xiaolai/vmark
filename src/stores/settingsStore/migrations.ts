function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Terminal input-gate default flip (plan WI-4a). Before this release the default
 * was "legacy" and there was NO settings UI, so a persisted `terminal.inputGate`
 * of "legacy" is the OLD default, never an explicit opt-out. Delete it so the
 * new default ("gate") applies via deep-merge. A persisted "gate" (an early
 * DevTools opt-in) is a real choice and is kept. Runs before deep-merge.
 */
export function migrateInputGateDefaultFlip(
  rawPersisted: Record<string, unknown>,
): void {
  const terminal = rawPersisted.terminal;
  if (!isPlainObject(terminal)) return;
  if (terminal.inputGate === "legacy") {
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
