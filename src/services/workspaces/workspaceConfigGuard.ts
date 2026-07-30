/**
 * Runtime shape guard for the `read_workspace_config` IPC payload (T1/ADR-2).
 *
 * Extracted to a LEAF module (WI-13.3): both the open path
 * (`openWorkspaceWithConfig`) and the rail-switch refresh
 * (`syncLegacyWorkspaceContext`) validate the same boundary, and importing
 * the guard from the open path made the coordinator's import chain circular
 * (open → instanceActions → switch → legacySync → open).
 *
 * The Rust side is the sole producer and serde-validates it, but this is a
 * highest-blast-radius boundary (drives tab restore + file-explorer
 * filtering), so the frontend re-checks the core fields before trusting the
 * typed result. Mirrors what the Rust `WorkspaceConfig` struct actually
 * serializes (`workspace.rs`): `version` (number), `excludeFolders` /
 * `lastOpenTabs` (string arrays), `showHiddenFiles` (bool). `showAllFiles`
 * is a frontend-only field the store defaults — Rust never emits it, so it
 * is NOT required here. `version` is checked as a number (not literal `1`)
 * so a future migration bump doesn't reject otherwise-valid configs.
 * Optional `ai`/`identity` are intentionally not validated.
 *
 * @module services/workspaces/workspaceConfigGuard
 */
import type { WorkspaceConfig } from "@/stores/workspaceStore";

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function isValidWorkspaceConfig(raw: unknown): raw is WorkspaceConfig {
  if (typeof raw !== "object" || raw === null) return false;
  const c = raw as Record<string, unknown>;
  return (
    typeof c.version === "number" &&
    isStringArray(c.excludeFolders) &&
    isStringArray(c.lastOpenTabs) &&
    typeof c.showHiddenFiles === "boolean"
  );
}
