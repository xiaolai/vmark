function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Rename `appearance.paragraphSpacing` → `blockSpacing`. Runs on the raw blob,
 * BEFORE shape-sanitization — so `appearance` is still untrusted here. `in`
 * throws a TypeError on a primitive (`appearance: "evil"`), which would abort
 * hydration and silently drop every persisted setting; isPlainObject is the
 * same guard every sibling migration uses.
 */
export function migrateParagraphSpacingToBlockSpacing(rawPersisted: Record<string, unknown>): void {
  const appearance = rawPersisted.appearance;
  if (isPlainObject(appearance) && "paragraphSpacing" in appearance && !("blockSpacing" in appearance)) {
    appearance.blockSpacing = appearance.paragraphSpacing;
    delete appearance.paragraphSpacing;
  }
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
 * WI-FL2.2 (D8) — remove the retired `appearance.autoHideStatusBar` flag.
 *
 * It had a default, a type, a Settings row and ten translations, and nothing
 * ever read it: the toggle did nothing. `sanitizePersistedSettings` forwards
 * unknown keys, so without this the stale value would linger in live state and
 * be written back on every persist. Runs before deep-merge, on the untrusted
 * raw blob — tolerant of a missing or non-object `appearance` section.
 */
export function migrateRemoveAutoHideStatusBar(rawPersisted: Record<string, unknown>): void {
  const appearance = rawPersisted.appearance;
  if (isPlainObject(appearance) && "autoHideStatusBar" in appearance) {
    delete appearance.autoHideStatusBar;
  }
}

/**
 * WI-FL2.1 (D9) — remove the retired `advanced.mcpServer.port` setting.
 *
 * The value was forwarded to `mcp_bridge_start`, which always bound
 * `127.0.0.1:0` and ignored it; the OS assigns the port and the bridge reports
 * the one it bound. The command no longer takes a port, so a persisted number
 * would be dead weight written back on every persist. Only the `port` leaf
 * goes — `autoStart` and `autoApproveEdits` are live settings. Tolerant of a
 * missing or non-object `advanced` / `mcpServer` section.
 */
export function migrateRemoveMcpPort(rawPersisted: Record<string, unknown>): void {
  const advanced = rawPersisted.advanced;
  if (!isPlainObject(advanced)) return;
  const mcpServer = advanced.mcpServer;
  if (isPlainObject(mcpServer) && "port" in mcpServer) {
    delete mcpServer.port;
  }
}

/**
 * WI-FL2.6 (D6) — remove the retired `advanced.workflowViewer` flag.
 *
 * The GitHub Actions viewer has no switch any more: the workbench was always
 * unconditional, the split-pane source aids never consulted the flag, and the
 * markdown assembly path — its last reader — is unconditional now too. A
 * persisted value, `true` or `false`, is dead weight that
 * `sanitizePersistedSettings` would forward and write back on every persist.
 *
 * This replaces the WI-19 split migration, which fanned `workflowEngine` out
 * into `workflowViewer` on every load of a blob that lacked it — kept alongside
 * this one, the pair would only have been right in one run order. Only the
 * viewer leaf goes; `workflowEngine` is a live setting. Tolerant of a missing
 * or non-object `advanced` section.
 */
export function migrateRemoveWorkflowViewer(rawPersisted: Record<string, unknown>): void {
  const advanced = rawPersisted.advanced;
  if (isPlainObject(advanced) && "workflowViewer" in advanced) {
    delete advanced.workflowViewer;
  }
}

/**
 * THE ordered migration pipeline (audit #495). The store's `merge` used to
 * list the migrations by hand, so a migration exported here but not added to
 * that list silently never ran; `migrations.test.ts` pins that every exported
 * `migrate*` function is in this array, once. Order matters only where two
 * steps touch one section (paragraphSpacing before autoHideStatusBar, both
 * under `appearance`); each step tolerates a missing or non-object section.
 */
export const PERSISTED_SETTINGS_MIGRATIONS: readonly ((raw: Record<string, unknown>) => void)[] = [
  migrateParagraphSpacingToBlockSpacing,
  migrateWorkspaceRailModeToGeneral,
  migrateRemoveInputGate,
  migrateRemoveAutoHideStatusBar,
  migrateRemoveMcpPort,
  migrateRemoveWorkflowViewer,
];

/** Run every persisted-blob migration, in order, on the raw untrusted blob. */
export function runPersistedSettingsMigrations(rawPersisted: Record<string, unknown>): void {
  for (const migrate of PERSISTED_SETTINGS_MIGRATIONS) migrate(rawPersisted);
}
