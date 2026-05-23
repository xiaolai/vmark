/**
 * Schema Migration for Hot Exit Sessions (TypeScript side)
 *
 * Provides migration functions to upgrade old session formats to the current schema.
 * This ensures users don't lose their session data when the app updates.
 *
 * **Dual migration by design**: Both TypeScript (this file) and Rust
 * (`src-tauri/src/hot_exit/migration.rs`) implement the same migrations.
 * TypeScript handles in-memory session data from the frontend hot-exit
 * capture flow; Rust handles sessions read from disk at startup.
 * Both must be kept in sync when adding new schema versions.
 *
 * Migration Strategy:
 * - Sessions at current version pass through unchanged
 * - Older sessions are migrated step-by-step (vN -> vN+1 -> ... -> current)
 * - Future sessions (higher version) cannot be migrated (fail gracefully)
 * - Version 0 is invalid and rejected
 * - Every version step MUST have an explicit migration function
 */

import type { SessionData, DocumentState } from './types';
import { SCHEMA_VERSION } from './types';

// Re-export for consumers that import from schemaMigration
export { SCHEMA_VERSION };

/** Minimum supported version for migration */
const MIN_SUPPORTED_VERSION = 1;

/**
 * Type for migration functions.
 * Each migration takes a session and returns the upgraded version.
 */
type MigrationFn = (session: SessionData) => SessionData;

/**
 * Registry of migration functions.
 * Key is the source version, value migrates from that version to the next.
 */
const migrations: Record<number, MigrationFn> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
};

/**
 * Check if a session version can be migrated to current version.
 *
 * @param version - The session's schema version
 * @returns true if migration is possible
 */
export function canMigrate(version: number): boolean {
  // Invalid version
  if (version < MIN_SUPPORTED_VERSION) {
    return false;
  }

  // Current or older (can migrate)
  if (version <= SCHEMA_VERSION) {
    return true;
  }

  // Future version - cannot migrate
  return false;
}

/**
 * Migrate a session to the current schema version.
 *
 * @param session - Session data to migrate
 * @returns Migrated session at current version
 * @throws Error if migration is not possible
 */
export function migrateSession(session: SessionData): SessionData {
  // Validate version
  if (!canMigrate(session.version)) {
    throw new Error(
      `Cannot migrate session from version ${session.version} to ${SCHEMA_VERSION}. ` +
      `Supported versions: ${MIN_SUPPORTED_VERSION} to ${SCHEMA_VERSION}`
    );
  }

  // Already at current version - return as-is
  if (session.version === SCHEMA_VERSION) {
    return session;
  }

  // Apply migrations step by step
  let current = { ...session };

  while (current.version < SCHEMA_VERSION) {
    const migrateFn = migrations[current.version];

    /* v8 ignore next 7 -- @preserve programming error guard: all schema version steps must have migrations */
    if (!migrateFn) {
      // CRITICAL: Every version step must have an explicit migration
      // Silently bumping version can skip required field additions
      throw new Error(
        `Missing migration function for version ${current.version}. ` +
        `Add a migration in the 'migrations' registry.`
      );
    }

    // Apply migration
    current = migrateFn(current);
  }

  return current;
}

/**
 * Check if session needs migration.
 *
 * @param session - Session to check
 * @returns true if session version is older than current
 */
export function needsMigration(session: SessionData): boolean {
  return session.version < SCHEMA_VERSION;
}

// =============================================================================
// Migration Functions
// =============================================================================
// Add migration functions here as we evolve the schema.
// Each function should:
// 1. Take a session at version N
// 2. Return a session at version N+1
// 3. Add default values for new fields
// 4. Transform data structures as needed

/**
 * Migrate v1 -> v2: Add undo/redo history to documents
 *
 * v2 adds undo_history and redo_history arrays to DocumentState
 * for preserving cross-mode undo capability across restarts.
 */
function migrateV1toV2(session: SessionData): SessionData {
  return {
    ...session,
    version: 2,
    windows: session.windows.map(window => ({
      ...window,
      tabs: window.tabs.map(tab => ({
        ...tab,
        // V1 documents don't have undo_history/redo_history - cast to V1 type
        document: addHistoryToDocument(tab.document as V1DocumentState),
      })),
    })),
  };
}

/**
 * V1 DocumentState - all fields except undo/redo history (added in v2)
 */
type V1DocumentState = Omit<DocumentState, 'undo_history' | 'redo_history'>;

/**
 * Add empty history arrays to a v1 document (v1 -> v2 migration helper)
 */
function addHistoryToDocument(doc: V1DocumentState): DocumentState {
  return {
    ...doc,
    undo_history: [],
    redo_history: [],
  };
}

/**
 * V2 TabState — without v3-only format fields. Used for type-safe migration.
 */
type V2TabState = Omit<
  SessionData['windows'][number]['tabs'][number],
  'format_id' | 'editing_enabled' | 'active_schema_id'
>;

/**
 * Migrate v2 -> v3: Add tab-format fields (formatId / editingEnabled / activeSchemaId)
 *
 * v3 adds three fields to TabState in support of the multi-format
 * workspace (plan WI-1A.13). All v2 sessions are markdown-only by
 * definition, so the backfill is:
 *   - format_id = "markdown" (the only format that existed pre-v3)
 *   - editing_enabled = true  (markdown is editable by default)
 *   - active_schema_id = null (no schema dispatch yet)
 */
function migrateV2toV3(session: SessionData): SessionData {
  return {
    ...session,
    version: 3,
    windows: session.windows.map((window) => ({
      ...window,
      tabs: window.tabs.map((tab) => addFormatFieldsToTab(tab as V2TabState)),
    })),
  };
}

function addFormatFieldsToTab(
  tab: V2TabState,
): SessionData['windows'][number]['tabs'][number] {
  return {
    ...tab,
    format_id: 'markdown',
    editing_enabled: true,
    active_schema_id: null,
  };
}
