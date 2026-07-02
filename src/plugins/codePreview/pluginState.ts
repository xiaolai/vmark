/**
 * Code Preview Plugin State
 *
 * Purpose: Shared module-level state and constants for the code preview plugin —
 * plugin key, transaction meta keys, plugin state types, the active-view registry,
 * and the bounded preview render cache. Split from tiptap.ts for size.
 *
 * Key decisions:
 *   - Active EditorView instances are tracked in a module-level Set
 *     (`activeEditorViews`) populated via each plugin's `view()` lifecycle.
 *     refreshPreviews dispatches into every registered view, so split-pane or
 *     multi-window scenarios refresh consistently.
 *   - previewCache is bounded so editing diagram/latex/svg blocks doesn't grow
 *     the cache unbounded across a session (WI-4.4, R1). Entries are lightweight
 *     (rendered string / pending promise), so LRU eviction needs no disposal.
 *
 * @coordinates-with tiptap.ts — extension entry; re-exports the public constants
 * @coordinates-with editMode.ts — exitEditMode uses the view registry and cache
 * @coordinates-with previewDecorations.ts — decoration builder reads/writes the cache
 * @module plugins/codePreview/pluginState
 */

import { PluginKey } from "@tiptap/pm/state";
import type { EditorView, DecorationSet } from "@tiptap/pm/view";
import { LruCache } from "@/utils/lruCache";
import type { PreviewCacheEntry } from "./previewHelpers";

export const codePreviewPluginKey = new PluginKey("codePreview");

/** Meta key to signal editing state change */
export const EDITING_STATE_CHANGED = "codePreviewEditingChanged";
/** Meta key to signal settings changed (font size, etc.) */
export const SETTINGS_CHANGED = "codePreviewSettingsChanged";

export interface CodeBlockRange {
  from: number;
  to: number;
}

export interface CodePreviewState {
  decorations: DecorationSet;
  editingPos: number | null;
  codeBlockRanges: CodeBlockRange[];
}

// Registry of active editor views. Populated/cleared via each plugin's
// `view()` lifecycle. refreshPreviews() iterates this set so multi-editor
// scenarios (split windows, embedded editors) all get refreshed instead of
// only the most-recently-mounted instance. Never used to pick "a" view for
// document mutation — that could target the wrong document.
export const activeEditorViews = new Set<EditorView>();

// Bounded so editing diagram/latex/svg blocks doesn't grow the cache
// unbounded across a session (WI-4.4, R1). Entries are lightweight
// (rendered string / pending promise), so LRU eviction needs no disposal.
const PREVIEW_CACHE_MAX = 100;
export const previewCache = new LruCache<string, PreviewCacheEntry>(PREVIEW_CACHE_MAX);
