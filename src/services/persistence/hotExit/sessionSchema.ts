/**
 * Zod schemas for the hot-exit session read boundary (WI-3).
 *
 * Purpose: structural validation of persisted session payloads BEFORE they
 * reach migration/restore. The payload crosses an IPC boundary (Rust reads the
 * bytes, but both sides migrate independently — "dual migration by design" in
 * schemaMigration.ts — so the frontend must not assume the shape).
 *
 * Key decisions:
 *   - Posture is PASSTHROUGH (decision ledger D5, persistence-read class):
 *     every object schema is loose so unknown fields from newer app versions
 *     survive the boundary; corrupt ≠ unknown.
 *   - Schemas are VALIDATORS, not transformers: callers keep the original
 *     payload objects, so valid data round-trips byte-identically (no
 *     narrowing, no default-filling — migration owns normalization).
 *   - Tolerances mirror the oldest migratable shape (v1): fields added in
 *     later schema versions are optional here because validation runs BEFORE
 *     migration backfills them.
 *   - Only content-integrity fields are strict (tab id, document content);
 *     cosmetic sub-shapes (ui_state, geometry, rail metadata) pass through
 *     untouched — quarantining a window's content over a corrupt sidebar
 *     width would be worse than restoring it.
 *
 * @coordinates-with sessionSalvage.ts — per-item salvage over these schemas
 * @coordinates-with instanceContextState.ts — opaque-field validation at restore
 * @module services/persistence/hotExit/sessionSchema
 */
import { z } from "zod";

/** Cursor info is best-effort at restore; object-or-null is enough here. */
const cursorInfoSchema = z.union([z.looseObject({}), z.null()]);

/** History checkpoints are consumed defensively downstream; require object-ness. */
const historyCheckpointSchema = z.looseObject({});

/** Document content is the payload that must never be silently lost. */
const documentStateSchema = z.looseObject({
  content: z.string(),
  saved_content: z.string(),
  is_dirty: z.boolean().optional(),
  is_missing: z.boolean().optional(),
  is_divergent: z.boolean().optional(),
  is_read_only: z.boolean().optional(),
  line_ending: z.enum(["\n", "\r\n", "unknown"]).optional(),
  cursor_info: cursorInfoSchema.optional(),
  last_modified_timestamp: z.number().nullish(),
  is_untitled: z.boolean().optional(),
  untitled_number: z.number().nullish(),
  undo_history: z.array(historyCheckpointSchema).optional(),
  redo_history: z.array(historyCheckpointSchema).optional(),
  mode: z.enum(["wysiwyg", "source"]).optional(),
  hard_break_style: z.enum(["backslash", "twoSpaces", "mixed", "unknown"]).optional(),
  last_disk_content: z.string().optional(),
});

/** A restorable tab: identity + document integrity. v3 fields optional (pre-migration). */
export const tabStateSchema = z.looseObject({
  id: z.string(),
  file_path: z.string().nullish(),
  title: z.string(),
  is_pinned: z.boolean().optional(),
  document: documentStateSchema,
  format_id: z.string().optional(),
  editing_enabled: z.boolean().optional(),
  active_schema_id: z.string().nullish(),
});

/**
 * A window's routing envelope. Tabs are validated per-item by the salvage
 * layer (this schema only requires an array), so one corrupt tab never
 * quarantines its siblings.
 */
export const windowEnvelopeSchema = z.looseObject({
  window_label: z.string(),
  is_main_window: z.boolean(),
  active_tab_id: z.string().nullish(),
  tabs: z.array(z.unknown()),
});

/** The session envelope: identity fields migration/dispatch cannot proceed without. */
export const sessionEnvelopeSchema = z.looseObject({
  version: z.number(),
  timestamp: z.number(),
  vmark_version: z.string(),
  windows: z.array(z.unknown()),
});

/** Workspace payload: object-or-null; salvage replaces an invalid one with null. */
export const workspaceStateSchema = z.union([z.looseObject({}), z.null()]);

/**
 * Per-instance UI state (WI-9.4 opaque field). Mirrors the hydrate guard in
 * workspaceInstanceUiStore (`isValidInstanceUiState`) so the boundary is
 * exactly as strict as the store — plus passthrough for unknown fields.
 */
export const instanceUiStateSchema = z.looseObject({
  sidebarWidth: z.number().finite().nullable(),
  sidebarViewMode: z.string().nullable(),
  fileExplorerOpenState: z.record(z.string(), z.unknown()).nullable(),
  fileTreeScrollOffset: z.number().finite().nullable(),
  outlineByTabId: z.record(z.string(), z.unknown()),
});

/** Opaque record payloads (closed_tab_scopes, ui_state_by_instance containers). */
export const opaqueRecordSchema = z.record(z.string(), z.unknown());

/** One human-readable line summarizing why a payload failed its schema. */
export function schemaReason(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");
}
