/**
 * contentApplied — which WYSIWYG editors hold the document they were opened for.
 *
 * Purpose: an editor mounts with an empty placeholder document and receives its
 * real content a task later (the deferred initial load), or later still when
 * the load waits behind an IME composition. Serializing it before then writes
 * the placeholder over the document's text, so the flush asks here first.
 *
 * Key decisions:
 *   - Keyed by editor identity: a remount is a new editor and starts unmarked.
 *   - Marked by the write itself, when it dispatches — a load that waits
 *     counts only once it has run, and one that is dropped never counts.
 *
 * @coordinates-with tiptapContentLoad.ts — the write that marks an editor
 * @coordinates-with useTiptapFlush.ts — the flush that asks
 * @module components/Editor/contentApplied
 */

import type { Editor as TiptapEditor } from "@tiptap/core";

const applied = new WeakSet<TiptapEditor>();

/** Record that `editor` now holds a document written by a content load. */
export function markContentApplied(editor: TiptapEditor): void {
  applied.add(editor);
}

/** Whether a content load has been written into `editor`. */
export function hasContentApplied(editor: TiptapEditor): boolean {
  return applied.has(editor);
}
