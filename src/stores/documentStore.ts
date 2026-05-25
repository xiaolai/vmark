/**
 * Document Store — public API barrel.
 *
 * Re-exports the 6 per-tab document-related Zustand stores from their
 * per-domain files in `./documentStore/`. The split keeps each file under
 * the ~300 LOC guideline while preserving the consolidated import path
 * that consumers and test mocks depend on:
 *
 *   import { useDocumentStore, useLintStore } from "@/stores/documentStore";
 *
 * Each underlying file owns one Zustand instance. The lint module
 * subscribes to settingsStore at import time so users disabling lint
 * also clears existing diagnostics — by importing through this barrel
 * once at app startup, that subscription wires up automatically.
 *
 * Sections:
 *   - useDocumentStore         — content, dirty tracking, file path, cursor,
 *                                line endings, external-change detection
 *   - useFileLoadStore         — in-flight large-file load coordination
 *   - useLargeFileSessionStore — per-tab "forced source mode" because file
 *                                exceeded the WYSIWYG threshold
 *   - useRevisionStore         — content-revision ID for MCP bridge tracking
 *   - useUnifiedHistoryStore   — cross-mode undo/redo checkpoint stack
 *   - useLintStore             — per-tab markdown / YAML lint diagnostics
 *
 * @coordinates-with tabStore.ts — tab ID is the key into the documents map
 * @coordinates-with useAutoSave.ts — reads isDirty to trigger auto-save
 * @coordinates-with useFileWatcher.ts — calls markMissing/markDivergent on external changes
 * @coordinates-with useTabModeSync.ts — mirrors per-doc mode → window sourceMode (ADR-009)
 * @coordinates-with services/persistence/hotExit/restoreHelpers.ts — restores mode, hardBreakStyle, lastDiskContent
 * @module stores/documentStore
 */

export {
  useDocumentStore,
  type DocumentState,
  type CursorInfo,
} from "./documentStore/document";
export { useFileLoadStore } from "./documentStore/fileLoad";
export { useLargeFileSessionStore } from "./documentStore/largeFileSession";
export {
  useRevisionStore,
  generateRevisionId,
} from "./documentStore/revision";
export {
  useUnifiedHistoryStore,
  type HistoryCheckpoint,
} from "./documentStore/unifiedHistory";
export { useLintStore } from "./documentStore/lint";
