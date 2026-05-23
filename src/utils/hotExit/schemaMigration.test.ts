/**
 * Schema Migration Tests
 *
 * Tests for hot exit session schema migration.
 * Ensures old session formats can be upgraded to current schema.
 */

import { describe, it, expect } from 'vitest';
import {
  migrateSession,
  canMigrate,
  SCHEMA_VERSION,
} from './schemaMigration';
import type { SessionData } from './types';

describe('Schema Migration', () => {
  describe('canMigrate', () => {
    it('should return true for current version', () => {
      expect(canMigrate(SCHEMA_VERSION)).toBe(true);
    });

    it('should return true for older supported versions', () => {
      // Version 1 should always be supported
      expect(canMigrate(1)).toBe(true);
    });

    it('should return false for future versions', () => {
      // Cannot migrate from a future version we don't understand
      expect(canMigrate(SCHEMA_VERSION + 1)).toBe(false);
      expect(canMigrate(999)).toBe(false);
    });

    it('should return false for version 0 (invalid)', () => {
      expect(canMigrate(0)).toBe(false);
    });
  });

  describe('migrateSession', () => {
    it('should return session unchanged if already at current version', () => {
      const session: SessionData = {
        version: SCHEMA_VERSION,
        timestamp: Date.now() / 1000,
        vmark_version: '0.3.24',
        windows: [],
        workspace: null,
      };

      const migrated = migrateSession(session);
      expect(migrated.version).toBe(SCHEMA_VERSION);
      expect(migrated).toEqual(session);
    });

    it('should throw for future versions', () => {
      const futureSession = {
        version: SCHEMA_VERSION + 1,
        timestamp: Date.now() / 1000,
        vmark_version: '1.0.0',
        windows: [],
        workspace: null,
      } as SessionData;

      expect(() => migrateSession(futureSession)).toThrow(/Cannot migrate/);
    });

    it('should throw for version 0', () => {
      const invalidSession = {
        version: 0,
        timestamp: Date.now() / 1000,
        vmark_version: '0.0.1',
        windows: [],
        workspace: null,
      } as SessionData;

      expect(() => migrateSession(invalidSession)).toThrow(/Cannot migrate/);
    });

    it('should update version number after migration', () => {
      // This test verifies that migration updates the version field
      // For now with only version 1, this is a no-op
      const session: SessionData = {
        version: 1,
        timestamp: Date.now() / 1000,
        vmark_version: '0.3.24',
        windows: [],
        workspace: null,
      };

      const migrated = migrateSession(session);
      expect(migrated.version).toBe(SCHEMA_VERSION);
    });
  });

  describe('Migration from v1 to current', () => {
    it('should preserve window data during migration', () => {
      // v1 fixture: predates both undo/redo (v2) and format fields (v3).
      // Cast away the v3-only fields; the migration backfills them.
      const v1Session = {
        version: 1,
        timestamp: Date.now() / 1000,
        vmark_version: '0.3.24',
        windows: [
          {
            window_label: 'main',
            is_main_window: true,
            active_tab_id: 'tab-1',
            tabs: [
              {
                id: 'tab-1',
                file_path: '/test/file.md',
                title: 'file.md',
                is_pinned: false,
                document: {
                  content: '# Hello',
                  saved_content: '# Hello',
                  is_dirty: false,
                  is_missing: false,
                  is_divergent: false,
                  is_read_only: false,
                  line_ending: '\n',
                  cursor_info: null,
                  last_modified_timestamp: null,
                  is_untitled: false,
                  untitled_number: null,
                  undo_history: [],
                  redo_history: [],
                },
              },
            ],
            ui_state: {
              sidebar_visible: true,
              sidebar_width: 260,
              outline_visible: false,
              sidebar_view_mode: 'files',
              status_bar_visible: true,
              source_mode_enabled: false,
              focus_mode_enabled: false,
              typewriter_mode_enabled: false,
            },
            geometry: null,
          },
        ],
        workspace: null,
      } as unknown as SessionData;

      const migrated = migrateSession(v1Session);

      // Core data should be preserved
      expect(migrated.windows.length).toBe(1);
      expect(migrated.windows[0].window_label).toBe('main');
      expect(migrated.windows[0].tabs.length).toBe(1);
      expect(migrated.windows[0].tabs[0].document.content).toBe('# Hello');
    });

    it('should handle missing optional fields gracefully', () => {
      // Simulate an old session that might be missing newer optional fields
      const oldSession = {
        version: 1,
        timestamp: Date.now() / 1000,
        vmark_version: '0.3.20',
        windows: [
          {
            window_label: 'main',
            is_main_window: true,
            active_tab_id: null,
            tabs: [],
            ui_state: {
              sidebar_visible: true,
              sidebar_width: 260,
              outline_visible: false,
              sidebar_view_mode: 'files',
              status_bar_visible: true,
              source_mode_enabled: false,
              focus_mode_enabled: false,
              typewriter_mode_enabled: false,
            },
            geometry: null,
          },
        ],
        workspace: null,
      } as SessionData;

      // Should not throw
      const migrated = migrateSession(oldSession);
      expect(migrated.version).toBe(SCHEMA_VERSION);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty windows array', () => {
      const emptySession: SessionData = {
        version: 1,
        timestamp: Date.now() / 1000,
        vmark_version: '0.3.24',
        windows: [],
        workspace: null,
      };

      const migrated = migrateSession(emptySession);
      expect(migrated.windows).toEqual([]);
    });

    it('should preserve workspace state', () => {
      const sessionWithWorkspace: SessionData = {
        version: 1,
        timestamp: Date.now() / 1000,
        vmark_version: '0.3.24',
        windows: [],
        workspace: {
          root_path: '/projects/myapp',
          is_workspace_mode: true,
          show_hidden_files: false,
        },
      };

      const migrated = migrateSession(sessionWithWorkspace);
      expect(migrated.workspace).toEqual(sessionWithWorkspace.workspace);
    });

    it('should preserve timestamp during migration', () => {
      const originalTimestamp = Date.now() / 1000 - 3600; // 1 hour ago
      const session: SessionData = {
        version: 1,
        timestamp: originalTimestamp,
        vmark_version: '0.3.24',
        windows: [],
        workspace: null,
      };

      const migrated = migrateSession(session);
      expect(migrated.timestamp).toBe(originalTimestamp);
    });
  });

  describe('Migration v2 -> v3 (WI-1A.13 — tab format fields)', () => {
    // Build a v2 session fixture without v3-only fields.
    function buildV2Session(): SessionData {
      return {
        version: 2,
        timestamp: 1747958400,
        vmark_version: '0.7.26',
        windows: [
          {
            window_label: 'main',
            is_main_window: true,
            active_tab_id: 'tab-1',
            tabs: [
              {
                id: 'tab-1',
                file_path: '/notes/draft.md',
                title: 'draft.md',
                is_pinned: false,
                document: {
                  content: '# draft',
                  saved_content: '# draft',
                  is_dirty: false,
                  is_missing: false,
                  is_divergent: false,
                  is_read_only: false,
                  line_ending: '\n',
                  cursor_info: null,
                  last_modified_timestamp: null,
                  is_untitled: false,
                  untitled_number: null,
                  undo_history: [],
                  redo_history: [],
                },
                // format_id / editing_enabled / active_schema_id intentionally
                // absent: this fixture represents pre-v3 on-disk data.
              } as unknown as SessionData['windows'][number]['tabs'][number],
            ],
            ui_state: {
              sidebar_visible: true,
              sidebar_width: 260,
              outline_visible: false,
              sidebar_view_mode: 'files',
              status_bar_visible: true,
              source_mode_enabled: false,
              focus_mode_enabled: false,
              typewriter_mode_enabled: false,
            },
            geometry: null,
          },
        ],
        workspace: null,
      };
    }

    it('backfills format_id to "markdown" for v2 tabs', () => {
      const migrated = migrateSession(buildV2Session());
      const tab = migrated.windows[0].tabs[0];
      expect(tab.format_id).toBe('markdown');
    });

    it('backfills editing_enabled to true for v2 tabs', () => {
      const migrated = migrateSession(buildV2Session());
      expect(migrated.windows[0].tabs[0].editing_enabled).toBe(true);
    });

    it('backfills active_schema_id to null for v2 tabs', () => {
      const migrated = migrateSession(buildV2Session());
      expect(migrated.windows[0].tabs[0].active_schema_id).toBeNull();
    });

    it('bumps the version to current SCHEMA_VERSION', () => {
      const migrated = migrateSession(buildV2Session());
      expect(migrated.version).toBe(SCHEMA_VERSION);
    });

    it('preserves all v2 document fields during migration', () => {
      const migrated = migrateSession(buildV2Session());
      const doc = migrated.windows[0].tabs[0].document;
      expect(doc.content).toBe('# draft');
      expect(doc.undo_history).toEqual([]);
      expect(doc.redo_history).toEqual([]);
    });

    it('passes through a v3 session unchanged', () => {
      const v3Session: SessionData = {
        version: 3,
        timestamp: 1747958400,
        vmark_version: '0.7.26',
        windows: [
          {
            window_label: 'main',
            is_main_window: true,
            active_tab_id: 'tab-y',
            tabs: [
              {
                id: 'tab-y',
                file_path: '/data/payload.json',
                title: 'payload.json',
                is_pinned: false,
                document: {
                  content: '{"a": 1}',
                  saved_content: '{"a": 1}',
                  is_dirty: false,
                  is_missing: false,
                  is_divergent: false,
                  is_read_only: false,
                  line_ending: '\n',
                  cursor_info: null,
                  last_modified_timestamp: null,
                  is_untitled: false,
                  untitled_number: null,
                  undo_history: [],
                  redo_history: [],
                },
                format_id: 'json',
                editing_enabled: false,
                active_schema_id: 'package-json',
              },
            ],
            ui_state: {
              sidebar_visible: true,
              sidebar_width: 260,
              outline_visible: false,
              sidebar_view_mode: 'files',
              status_bar_visible: true,
              source_mode_enabled: false,
              focus_mode_enabled: false,
              typewriter_mode_enabled: false,
            },
            geometry: null,
          },
        ],
        workspace: null,
      };

      const migrated = migrateSession(v3Session);
      expect(migrated).toEqual(v3Session);
    });

    it('migrates an entire v1 session through to v3 with format defaults', () => {
      const v1Session = {
        version: 1,
        timestamp: 1700000000,
        vmark_version: '0.3.24',
        windows: [
          {
            window_label: 'main',
            is_main_window: true,
            active_tab_id: 'tab-1',
            tabs: [
              {
                id: 'tab-1',
                file_path: '/notes/old.md',
                title: 'old.md',
                is_pinned: false,
                document: {
                  content: 'legacy',
                  saved_content: 'legacy',
                  is_dirty: false,
                  is_missing: false,
                  is_divergent: false,
                  is_read_only: false,
                  line_ending: '\n',
                  cursor_info: null,
                  last_modified_timestamp: null,
                  is_untitled: false,
                  untitled_number: null,
                  // V1 documents lack undo/redo history — added by v1→v2 migration.
                },
              },
            ],
            ui_state: {
              sidebar_visible: true,
              sidebar_width: 260,
              outline_visible: false,
              sidebar_view_mode: 'files',
              status_bar_visible: true,
              source_mode_enabled: false,
              focus_mode_enabled: false,
              typewriter_mode_enabled: false,
            },
            geometry: null,
          },
        ],
        workspace: null,
      } as unknown as SessionData;

      const migrated = migrateSession(v1Session);
      expect(migrated.version).toBe(SCHEMA_VERSION);
      const tab = migrated.windows[0].tabs[0];
      // v1→v2 added the history arrays.
      expect(tab.document.undo_history).toEqual([]);
      expect(tab.document.redo_history).toEqual([]);
      // v2→v3 added the format fields with defaults.
      expect(tab.format_id).toBe('markdown');
      expect(tab.editing_enabled).toBe(true);
      expect(tab.active_schema_id).toBeNull();
    });

    it('rejects v4 (a future schema) with a typed error', () => {
      const futureSession = {
        version: 4,
        timestamp: 1747958400,
        vmark_version: '99.0.0',
        windows: [],
        workspace: null,
      } as unknown as SessionData;

      expect(() => migrateSession(futureSession)).toThrow(/Cannot migrate/);
    });
  });
});
