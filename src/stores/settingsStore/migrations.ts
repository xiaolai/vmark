function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
