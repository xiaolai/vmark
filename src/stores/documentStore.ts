/**
 * Document Store
 *
 * Purpose: Per-tab document state — content, dirty tracking, file path,
 *   cursor position, line endings, and external-change detection.
 *
 * Pipeline: Editor keystroke → setContent(tabId, text) → isDirty computed
 *   from savedContent comparison → useAutoSave reads isDirty → saveToPath()
 *   → markSaved()/markAutoSaved() → isDirty = false
 *
 * Key decisions:
 *   - State keyed by tab ID (not window label) so documents survive tab moves.
 *   - Three content snapshots per doc: `content` (current), `savedContent`
 *     (last save), `lastDiskContent` (what's on disk after normalization).
 *     This three-way tracking enables external-change detection.
 *   - isDivergent flag tracks "keep my changes" state after external file
 *     modification — local content intentionally differs from disk.
 *   - isMissing flag tracks externally-deleted files for UI warning.
 *   - Uses guarded updateDoc() helper — no-ops if tab ID doesn't exist.
 *
 * Known limitations:
 *   - No persistence — document content is only saved via explicit save
 *     actions, not via store middleware.
 *   - documentId counter is per-session — not globally unique.
 *
 * @coordinates-with tabStore.ts — tab ID is the key into documents map
 * @coordinates-with useAutoSave.ts — reads isDirty to trigger auto-save
 * @coordinates-with useFileWatcher.ts — calls markMissing/markDivergent on external changes
 * @module stores/documentStore
 */

import { create } from "zustand";
import type { CursorInfo } from "@/types/cursorSync";
import type { HardBreakStyle, LineEnding } from "@/utils/linebreakDetection";

// Re-export for backwards compatibility
export type { CursorInfo } from "@/types/cursorSync";

/** Per-tab document state — content snapshots, dirty tracking, file path, and external-change flags. */
export interface DocumentState {
  content: string;
  savedContent: string;
  /** Content as written to disk (post-normalization). Used for external-change detection. */
  lastDiskContent: string;
  filePath: string | null;
  isDirty: boolean;
  documentId: number;
  cursorInfo: CursorInfo | null;
  /** Currently selected text in the active editor; empty when no selection. */
  selectedText: string;
  lastAutoSave: number | null;
  /** True when the file was deleted externally - show warning UI */
  isMissing: boolean;
  /** True when user chose "Keep my changes" after external modification - local differs from disk */
  isDivergent: boolean;
  /** True when document is in read-only mode — blocks new edits but allows save */
  readOnly: boolean;
  lineEnding: LineEnding;
  hardBreakStyle: HardBreakStyle;
  /**
   * Per-document editor mode (ADR-009). Defaults to "wysiwyg"; the
   * window-scoped `useUIStore.sourceMode` is the public toggle and is
   * mirrored into the active document's mode on toggle. Persisting
   * per-doc mode makes "two tabs in one window, different modes" a
   * representable state; selectors layered on top of this enable
   * future per-tab mode switching without further schema changes.
   */
  mode: "wysiwyg" | "source";
}

interface DocumentStore {
  // Documents keyed by tab ID (changed from window label)
  documents: Record<string, DocumentState>;

  // Actions - now take tabId instead of windowLabel
  initDocument: (tabId: string, content?: string, filePath?: string | null, savedContent?: string) => void;
  setContent: (tabId: string, content: string) => void;
  loadContent: (
    tabId: string,
    content: string,
    filePath?: string | null,
    meta?: { lineEnding?: LineEnding; hardBreakStyle?: HardBreakStyle }
  ) => void;
  setFilePath: (tabId: string, path: string | null) => void;
  markMissing: (tabId: string) => void;
  clearMissing: (tabId: string) => void;
  markDivergent: (tabId: string) => void;

  setReadOnly: (tabId: string, readOnly: boolean) => void;
  toggleReadOnly: (tabId: string) => void;
  isReadOnly: (tabId: string) => boolean;

  markSaved: (tabId: string, lastDiskContent?: string) => void;
  markAutoSaved: (tabId: string, lastDiskContent?: string) => void;
  /**
   * Silently refresh the stored disk snapshot without touching content, dirty
   * state, or any UI flags. Used when a cloud sync engine rewrote the file with
   * a benign change (line endings/BOM/trailing newline) so that subsequent
   * byte-for-byte comparisons match.
   */
  updateLastDiskContent: (tabId: string, diskContent: string) => void;
  setCursorInfo: (tabId: string, info: CursorInfo | null) => void;
  /** Per-doc editor mode (ADR-009). */
  setMode: (tabId: string, mode: "wysiwyg" | "source") => void;
  setSelectedText: (tabId: string, text: string) => void;
  setLineMetadata: (
    tabId: string,
    meta: { lineEnding?: LineEnding; hardBreakStyle?: HardBreakStyle }
  ) => void;
  removeDocument: (tabId: string) => void;

  // Selectors
  getDocument: (tabId: string) => DocumentState | undefined;
  getAllDirtyDocuments: () => string[]; // Returns tabIds
}

const createInitialDocument = (content = "", filePath: string | null = null): DocumentState => ({
  content,
  savedContent: content,
  lastDiskContent: content,
  filePath,
  isDirty: false,
  documentId: 0,
  cursorInfo: null,
  selectedText: "",
  lastAutoSave: null,
  isMissing: false,
  isDivergent: false,
  readOnly: false,
  lineEnding: "unknown",
  hardBreakStyle: "unknown",
  mode: "wysiwyg",
});

/**
 * Helper to update a document by tabId.
 * Returns unchanged state if document doesn't exist.
 */
function updateDoc(
  state: { documents: Record<string, DocumentState> },
  tabId: string,
  updater: (doc: DocumentState) => Partial<DocumentState>
): { documents: Record<string, DocumentState> } {
  const doc = state.documents[tabId];
  if (!doc) return state;
  return {
    documents: {
      ...state.documents,
      [tabId]: { ...doc, ...updater(doc) },
    },
  };
}

/**
 * Compute post-save state. Compares written disk content against current editor
 * content to handle TOCTOU races (user edits during async save).
 */
function buildPostSaveState(doc: DocumentState, lastDiskContent: string | undefined) {
  const diskContent = lastDiskContent ?? doc.content;
  return {
    savedContent: diskContent,
    lastDiskContent: diskContent,
    isDirty: doc.content !== diskContent,
    isDivergent: false,
  };
}

/** Manages per-tab document content, dirty tracking, and external-change detection. Use selectors, not destructuring. */
export const useDocumentStore = create<DocumentStore>((set, get) => ({
  documents: {},

  initDocument: (tabId, content = "", filePath = null, savedContent?) => {
    const doc = createInitialDocument(content, filePath);
    if (savedContent !== undefined) {
      doc.savedContent = savedContent;
      doc.lastDiskContent = savedContent;
      doc.isDirty = savedContent !== content;
    }
    set((state) => ({
      documents: { ...state.documents, [tabId]: doc },
    }));
  },

  setContent: (tabId, content) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        content,
        isDirty: doc.savedContent !== content,
      }))
    ),

  loadContent: (tabId, content, filePath, meta) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        content,
        savedContent: content,
        lastDiskContent: content,
        filePath: filePath === undefined ? doc.filePath : filePath,
        isDirty: false,
        isDivergent: false, // Reload from disk clears divergent state
        documentId: doc.documentId + 1,
        selectedText: "",
        lineEnding: meta?.lineEnding ?? doc.lineEnding,
        hardBreakStyle: meta?.hardBreakStyle ?? doc.hardBreakStyle,
      }))
    ),

  setFilePath: (tabId, path) =>
    set((state) => updateDoc(state, tabId, () => ({ filePath: path }))),

  markMissing: (tabId) =>
    set((state) => updateDoc(state, tabId, () => ({ isMissing: true }))),

  clearMissing: (tabId) =>
    set((state) => updateDoc(state, tabId, () => ({ isMissing: false }))),

  markDivergent: (tabId) =>
    set((state) => updateDoc(state, tabId, () => ({ isDivergent: true }))),

  setReadOnly: (tabId, readOnly) =>
    set((state) => updateDoc(state, tabId, () => ({ readOnly }))),

  toggleReadOnly: (tabId) =>
    set((state) => updateDoc(state, tabId, (doc) => ({ readOnly: !doc.readOnly }))),

  isReadOnly: (tabId) => {
    const doc = get().documents[tabId];
    return doc?.readOnly ?? false;
  },

  markSaved: (tabId, lastDiskContent) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => buildPostSaveState(doc, lastDiskContent))
    ),

  markAutoSaved: (tabId, lastDiskContent) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        ...buildPostSaveState(doc, lastDiskContent),
        lastAutoSave: Date.now(),
      }))
    ),

  updateLastDiskContent: (tabId, diskContent) =>
    set((state) => updateDoc(state, tabId, () => ({ lastDiskContent: diskContent }))),

  setCursorInfo: (tabId, info) =>
    set((state) => updateDoc(state, tabId, () => ({ cursorInfo: info }))),

  setMode: (tabId, mode) =>
    set((state) => updateDoc(state, tabId, () => ({ mode }))),

  setSelectedText: (tabId, text) =>
    set((state) => {
      const doc = state.documents[tabId];
      if (!doc || doc.selectedText === text) return state;
      return updateDoc(state, tabId, () => ({ selectedText: text }));
    }),

  setLineMetadata: (tabId, meta) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        lineEnding: meta.lineEnding ?? doc.lineEnding,
        hardBreakStyle: meta.hardBreakStyle ?? doc.hardBreakStyle,
      }))
    ),

  removeDocument: (tabId) =>
    set((state) => {
      const { [tabId]: _, ...rest } = state.documents;
      return { documents: rest };
    }),

  getDocument: (tabId) => get().documents[tabId],

  getAllDirtyDocuments: () => {
    const { documents } = get();
    return Object.entries(documents)
      .filter(([_, doc]) => doc.isDirty)
      .map(([tabId]) => tabId);
  },
}));

// ============================================================================
// File Load Progress (T09 — formerly fileLoadStore.ts)
// ============================================================================

interface FileLoadState {
  active: boolean;
  filename: string;
  /** Bytes. Displayed via utils/fileSizeThresholds.formatFileSize. */
  sizeBytes: number;
  /** Monotonic token identifying the current load. Consumers pass it back to
   *  `endLoad(loadId)` so a stale editor-mount completion cannot clear an
   *  already-replaced indicator. */
  loadId: number;
  /** Returns the loadId of the newly started load. */
  startLoad: (filename: string, sizeBytes: number) => number;
  /**
   * Clear the indicator. When called with no argument, clears unconditionally
   * (used by error paths that already know they are the owner). When called
   * with a loadId, only clears if it matches the currently active load.
   */
  endLoad: (loadId?: number) => void;
}

export const useFileLoadStore = create<FileLoadState>((set, get) => ({
  active: false,
  filename: "",
  sizeBytes: 0,
  loadId: 0,
  startLoad: (filename, sizeBytes) => {
    const nextId = get().loadId + 1;
    set({ active: true, filename, sizeBytes, loadId: nextId });
    return nextId;
  },
  endLoad: (loadId) => {
    if (loadId !== undefined && loadId !== get().loadId) return;
    set({ active: false, filename: "", sizeBytes: 0 });
  },
}));

// ============================================================================
// Large File Session (T09 — formerly largeFileSessionStore.ts)
// ============================================================================

interface LargeFileSessionState {
  /** Tab IDs that were auto-opened in Source mode because of size. */
  forcedSourceTabs: Record<string, true>;
  markForcedSource: (tabId: string) => void;
  clearForcedSource: (tabId: string) => void;
  isForcedSource: (tabId: string) => boolean;
}

export const useLargeFileSessionStore = create<LargeFileSessionState>((set, get) => ({
  forcedSourceTabs: {},
  markForcedSource: (tabId) =>
    set((state) => ({ forcedSourceTabs: { ...state.forcedSourceTabs, [tabId]: true } })),
  clearForcedSource: (tabId) =>
    set((state) => {
      if (!state.forcedSourceTabs[tabId]) return state;
      const next = { ...state.forcedSourceTabs };
      delete next[tabId];
      return { forcedSourceTabs: next };
    }),
  isForcedSource: (tabId) => Boolean(get().forcedSourceTabs[tabId]),
}));

// ============================================================================
// Revisions (T09 — formerly revisionStore.ts)
// ============================================================================

/**
 * Generate a random alphanumeric string.
 */
function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a new revision ID.
 */
export function generateRevisionId(): string {
  return `rev-${randomString(8)}`;
}

interface RevisionState {
  /** Current document revision */
  currentRevision: string;
  /** Timestamp of last revision change */
  lastUpdated: number;
}

interface RevisionActions {
  /** Update revision after a document change */
  updateRevision: () => string;
  /** Set a specific revision (used on document load) */
  setRevision: (revision: string) => void;
  /** Get the current revision */
  getRevision: () => string;
  /** Check if a revision matches current */
  isCurrentRevision: (revision: string) => boolean;
}

const initialRevision = generateRevisionId();

/** Manages document revision IDs for optimistic concurrency control in MCP operations. Use selectors, not destructuring. */
export const useRevisionStore = create<RevisionState & RevisionActions>(
  (set, get) => ({
    currentRevision: initialRevision,
    lastUpdated: Date.now(),

    updateRevision: () => {
      const newRevision = generateRevisionId();
      set({
        currentRevision: newRevision,
        lastUpdated: Date.now(),
      });
      return newRevision;
    },

    setRevision: (revision: string) => {
      set({
        currentRevision: revision,
        lastUpdated: Date.now(),
      });
    },

    getRevision: () => {
      return get().currentRevision;
    },

    isCurrentRevision: (revision: string) => {
      return get().currentRevision === revision;
    },
  })
);

// ============================================================================
// Unified History (T09 — formerly unifiedHistoryStore.ts)
// ============================================================================

/** A cross-mode undo checkpoint — captures markdown, editor mode, and cursor position at a mode switch. */
export interface HistoryCheckpoint {
  /** The markdown content at this checkpoint */
  markdown: string;
  /** Which mode was active when this checkpoint was created */
  mode: "source" | "wysiwyg";
  /** Cursor position for restoration */
  cursorInfo: CursorInfo | null;
  /** Timestamp for debugging */
  timestamp: number;
}

interface DocumentHistory {
  undoStack: HistoryCheckpoint[];
  redoStack: HistoryCheckpoint[];
}

interface UnifiedHistoryState {
  /** History stacks per document (keyed by tabId) */
  documents: Record<string, DocumentHistory>;
  /** Maximum number of checkpoints to keep per document */
  maxCheckpoints: number;
  /** Whether we're currently restoring from a checkpoint (prevents re-checkpointing) */
  isRestoring: boolean;
}

interface UnifiedHistoryActions {
  /**
   * Create a checkpoint before switching modes.
   * Called when user toggles between Source and WYSIWYG.
   */
  createCheckpoint: (tabId: string, checkpoint: Omit<HistoryCheckpoint, "timestamp">) => void;

  /**
   * Pop the most recent checkpoint for undo.
   * Returns null if no checkpoints available.
   */
  popUndo: (tabId: string) => HistoryCheckpoint | null;

  /**
   * Pop the most recent checkpoint for redo.
   * Returns null if no checkpoints available.
   */
  popRedo: (tabId: string) => HistoryCheckpoint | null;

  /**
   * Push current state to redo stack (called when undoing to a checkpoint).
   */
  pushRedo: (tabId: string, checkpoint: Omit<HistoryCheckpoint, "timestamp">) => void;

  /**
   * Push current state to undo stack WITHOUT clearing redo stack.
   * Used by performUnifiedRedo to save current state before restoring.
   */
  pushUndo: (tabId: string, checkpoint: Omit<HistoryCheckpoint, "timestamp">) => void;

  /**
   * Check if there's a checkpoint available for undo.
   */
  canUndoCheckpoint: (tabId: string) => boolean;

  /**
   * Check if there's a checkpoint available for redo.
   */
  canRedoCheckpoint: (tabId: string) => boolean;

  /**
   * Set restoring flag (prevents checkpoint creation during restore).
   */
  setRestoring: (value: boolean) => void;

  /**
   * Clear history for a specific document (called on tab close).
   */
  clearDocument: (tabId: string) => void;

  /**
   * Clear all history (called on app reset).
   */
  clearAll: () => void;
}

const MAX_CHECKPOINTS = 50;

const emptyHistory: DocumentHistory = { undoStack: [], redoStack: [] };

/** Manages cross-mode undo/redo checkpoints for seamless history across WYSIWYG and Source modes. Use selectors, not destructuring. */
export const useUnifiedHistoryStore = create<UnifiedHistoryState & UnifiedHistoryActions>(
  (set, get) => ({
    documents: {},
    maxCheckpoints: MAX_CHECKPOINTS,
    isRestoring: false,

    createCheckpoint: (tabId, checkpoint) => {
      // Don't create checkpoint while restoring
      if (get().isRestoring) return;

      // Skip if content hasn't changed since last checkpoint (deduplication)
      const docHistory = get().documents[tabId];
      if (docHistory && docHistory.undoStack.length > 0) {
        const last = docHistory.undoStack[docHistory.undoStack.length - 1];
        if (last.markdown === checkpoint.markdown) return;
      }

      const newCheckpoint: HistoryCheckpoint = {
        ...checkpoint,
        timestamp: Date.now(),
      };

      set((state) => {
        const currentHistory = state.documents[tabId] || emptyHistory;
        const newUndoStack = [...currentHistory.undoStack, newCheckpoint];
        // Trim to max size
        if (newUndoStack.length > state.maxCheckpoints) {
          newUndoStack.shift();
        }
        return {
          documents: {
            ...state.documents,
            [tabId]: {
              undoStack: newUndoStack,
              // Clear redo on new checkpoint (new branch of history)
              redoStack: [],
            },
          },
        };
      });
    },

    popUndo: (tabId) => {
      let checkpoint: HistoryCheckpoint | null = null;
      set((state) => {
        const current = state.documents[tabId] || emptyHistory;
        if (current.undoStack.length === 0) return state;
        checkpoint = current.undoStack[current.undoStack.length - 1];
        return {
          documents: {
            ...state.documents,
            [tabId]: {
              ...current,
              undoStack: current.undoStack.slice(0, -1),
            },
          },
        };
      });
      return checkpoint;
    },

    popRedo: (tabId) => {
      let checkpoint: HistoryCheckpoint | null = null;
      set((state) => {
        const current = state.documents[tabId] || emptyHistory;
        if (current.redoStack.length === 0) return state;
        checkpoint = current.redoStack[current.redoStack.length - 1];
        return {
          documents: {
            ...state.documents,
            [tabId]: {
              ...current,
              redoStack: current.redoStack.slice(0, -1),
            },
          },
        };
      });
      return checkpoint;
    },

    pushRedo: (tabId, checkpoint) => {
      const newCheckpoint: HistoryCheckpoint = {
        ...checkpoint,
        timestamp: Date.now(),
      };

      set((state) => {
        const docHistory = state.documents[tabId] || emptyHistory;
        const newRedoStack = [...docHistory.redoStack, newCheckpoint];
        if (newRedoStack.length > state.maxCheckpoints) {
          newRedoStack.shift();
        }
        return {
          documents: {
            ...state.documents,
            [tabId]: {
              ...docHistory,
              redoStack: newRedoStack,
            },
          },
        };
      });
    },

    pushUndo: (tabId, checkpoint) => {
      const newCheckpoint: HistoryCheckpoint = {
        ...checkpoint,
        timestamp: Date.now(),
      };

      set((state) => {
        const docHistory = state.documents[tabId] || emptyHistory;
        const newUndoStack = [...docHistory.undoStack, newCheckpoint];
        if (newUndoStack.length > state.maxCheckpoints) {
          newUndoStack.shift();
        }
        return {
          documents: {
            ...state.documents,
            [tabId]: {
              ...docHistory,
              undoStack: newUndoStack,
            },
          },
        };
      });
    },

    canUndoCheckpoint: (tabId) => {
      const docHistory = get().documents[tabId];
      return docHistory ? docHistory.undoStack.length > 0 : false;
    },

    canRedoCheckpoint: (tabId) => {
      const docHistory = get().documents[tabId];
      return docHistory ? docHistory.redoStack.length > 0 : false;
    },

    setRestoring: (value) => {
      set({ isRestoring: value });
    },

    clearDocument: (tabId) => {
      set((state) => {
        const { [tabId]: _, ...rest } = state.documents;
        return { documents: rest };
      });
    },

    clearAll: () => {
      set({ documents: {}, isRestoring: false });
    },
  })
);

// ============================================================================
// Lint Diagnostics (T09 — formerly lintStore.ts)
// ============================================================================

import { lintMarkdown, type LintDiagnostic } from "@/lib/lintEngine";
import { lintYaml } from "@/lib/lintEngine/yaml";
import { checkLocalLinks } from "@/lib/markdownLinkCheck/check";
import { useSettingsStore } from "@/stores/settingsStore";

interface LintState {
  /** Diagnostics keyed by tabId */
  diagnosticsByTab: Record<string, LintDiagnostic[]>;
  /** Currently selected diagnostic index per tab for navigation */
  selectedIndexByTab: Record<string, number>;
}

/**
 * Per-tab tokens for async link-check ordering. Each runLinkCheck call
 * increments `next` and stamps `byTab[tabId]`. When a Promise resolves,
 * we compare the captured token to the current `byTab[tabId]`; if they
 * differ, a newer call started during our await window and we drop our
 * result. This eliminates the stale-overwrite race Codex flagged.
 *
 * Module-level (not in zustand state) because it's plumbing, not UI
 * state — no component reads it.
 */
const linkCheckTokens = {
  next: 0,
  byTab: {} as Record<string, number>,
};

interface LintActions {
  /** Run markdown lint on source for a specific tab */
  runLint: (tabId: string, source: string) => LintDiagnostic[];
  /**
   * Run YAML lint on source for a specific tab. Replaces ALL prior
   * diagnostics for the tab — YAML files are exclusive; they don't
   * also run markdown rules.
   */
  runYamlLint: (tabId: string, source: string) => LintDiagnostic[];
  /**
   * Run async link-existence check for a specific tab. Append-only —
   * does NOT clear sync diagnostics; merges results in. Returns
   * the merged set. No-op when filePath is null (untitled).
   */
  runLinkCheck: (
    tabId: string,
    source: string,
    filePath: string | null,
  ) => Promise<LintDiagnostic[]>;
  /** Clear diagnostics for a specific tab */
  clearDiagnostics: (tabId: string) => void;
  /** Clear all tabs */
  clearAllDiagnostics: () => void;
  /** Navigate to next diagnostic (wraps around) */
  selectNext: (tabId: string) => void;
  /** Navigate to previous diagnostic (wraps around) */
  selectPrev: (tabId: string) => void;
}

export const useLintStore = create<LintState & LintActions>((set, get) => ({
  diagnosticsByTab: {},
  selectedIndexByTab: {},

  runLint: (tabId, source) => {
    const diagnostics = lintMarkdown(source);

    set((state) => ({
      diagnosticsByTab: { ...state.diagnosticsByTab, [tabId]: diagnostics },
      selectedIndexByTab: { ...state.selectedIndexByTab, [tabId]: 0 },
    }));

    return diagnostics;
  },

  runYamlLint: (tabId, source) => {
    // Bumping the link-check token here too: a runLinkCheck() that
    // started while this tab was being treated as markdown should
    // not later overwrite our YAML diagnostics. Uniform invalidation.
    linkCheckTokens.next++;
    delete linkCheckTokens.byTab[tabId];
    const diagnostics = lintYaml(source);
    set((state) => ({
      diagnosticsByTab: { ...state.diagnosticsByTab, [tabId]: diagnostics },
      selectedIndexByTab: { ...state.selectedIndexByTab, [tabId]: 0 },
    }));
    return diagnostics;
  },

  runLinkCheck: async (tabId, source, filePath) => {
    if (!filePath) return [];
    // Codex audit HIGH-1 fix: per-tab token guards against stale async
    // results overwriting newer ones. Increment the token before the
    // fs.exists race; only commit results when the token matches at
    // settle time. Older completions resolve their promise but don't
    // touch the store.
    const myToken = ++linkCheckTokens.next;
    linkCheckTokens.byTab[tabId] = myToken;
    const linkDiags = await checkLocalLinks(source, filePath);
    if (linkCheckTokens.byTab[tabId] !== myToken) {
      // A newer link-check started while we were awaiting fs.exists.
      // Drop this result on the floor — the newer call will commit.
      return get().diagnosticsByTab[tabId] ?? [];
    }
    // Merge: REPLACE prior link-check diagnostics (M001/M002) for this
    // tab, preserve other rules' diagnostics. This ensures content
    // changes that fix a broken link clear the old diagnostic, and
    // re-runs with different params replace by content rather than
    // dedupe by id.
    const result = await new Promise<LintDiagnostic[]>((resolve) => {
      set((state) => {
        const existing = state.diagnosticsByTab[tabId] ?? [];
        const nonLinkCheck = existing.filter(
          (d) => d.ruleId !== "M001" && d.ruleId !== "M002",
        );
        const merged = [...nonLinkCheck, ...linkDiags].sort(
          (a, b) => a.line - b.line || a.column - b.column,
        );
        resolve(merged);
        return {
          diagnosticsByTab: { ...state.diagnosticsByTab, [tabId]: merged },
        };
      });
    });
    return result;
  },

  clearDiagnostics: (tabId) => {
    // Invalidate any in-flight runLinkCheck promise for this tab —
    // bumping `next` and clearing byTab[tabId] makes any pending
    // completion's token comparison fail, so it drops its result
    // instead of repopulating the cleared tab. Codex audit HIGH-1
    // partial finding.
    linkCheckTokens.next++;
    delete linkCheckTokens.byTab[tabId];
    set((state) => {
      const { [tabId]: _, ...rest } = state.diagnosticsByTab;
      const { [tabId]: __, ...indexRest } = state.selectedIndexByTab;
      return {
        diagnosticsByTab: rest,
        selectedIndexByTab: indexRest,
      };
    });
  },

  clearAllDiagnostics: () => {
    // Same invalidation: nuke all per-tab tokens so every in-flight
    // runLinkCheck Promise drops its result on settle.
    linkCheckTokens.next++;
    linkCheckTokens.byTab = {};
    set({ diagnosticsByTab: {}, selectedIndexByTab: {} });
  },

  selectNext: (tabId) => {
    set((state) => {
      const diagnostics = state.diagnosticsByTab[tabId];
      if (!diagnostics || diagnostics.length === 0) return state;
      const current = state.selectedIndexByTab[tabId] ?? 0;
      return {
        selectedIndexByTab: {
          ...state.selectedIndexByTab,
          [tabId]: (current + 1) % diagnostics.length,
        },
      };
    });
  },

  selectPrev: (tabId) => {
    set((state) => {
      const diagnostics = state.diagnosticsByTab[tabId];
      if (!diagnostics || diagnostics.length === 0) return state;
      const current = state.selectedIndexByTab[tabId] ?? 0;
      return {
        selectedIndexByTab: {
          ...state.selectedIndexByTab,
          [tabId]: current <= 0 ? diagnostics.length - 1 : current - 1,
        },
      };
    });
  },
}));

// Clear all diagnostics when lint is disabled in settings
let prevLintEnabled = useSettingsStore.getState().markdown?.lintEnabled;
useSettingsStore.subscribe((state) => {
  const enabled = state.markdown?.lintEnabled;
  if (prevLintEnabled && !enabled) {
    useLintStore.getState().clearAllDiagnostics();
  }
  prevLintEnabled = enabled;
});
