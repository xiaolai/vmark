/**
 * caretRestorePending — which editors still have a mount or show caret restore
 * waiting to run, so a selection read in that window is not taken for the
 * reader's.
 *
 * Purpose: an editor that mounts or is shown again puts the caret back where
 * the reader left it on a later frame or timer. Until then its selection is
 * wherever the editor happened to start, and the restore will move it with
 * nobody at the keyboard. The bridge's write re-verify asks here before it
 * treats a selection change as the reader's.
 *
 * Key decisions:
 *   - Keyed by editor identity (a Tiptap editor or a CodeMirror view): a
 *     remount is a new editor and starts with nothing pending.
 *   - Counted, not flagged: a mount restore and a show restore can overlap,
 *     and the editor is settled only when every one has run or been dropped.
 *   - `beginCaretRestore` returns the settle call and the caller owns it on
 *     every exit — ran, gave up, editor gone, timer cleared. Settling twice is
 *     a no-op, so a `finally` and a cancel can both call it. An entry that is
 *     never settled would silently disable the selection check for that
 *     editor's lifetime; the weak map at least lets it go with the editor.
 *
 * @coordinates-with services/editor/tiptapFocus.ts — the WYSIWYG restore
 * @coordinates-with components/Editor/sourceFocusRestore.ts — the Source restore
 * @coordinates-with services/mcpBridge/v2/selectionSurface.ts — the reader asks here
 * @module services/editor/caretRestorePending
 */

const pending = new WeakMap<object, number>();

/** Record a caret restore scheduled for `editor`; call the returned function once it has run or been dropped. */
export function beginCaretRestore(editor: object): () => void {
  pending.set(editor, (pending.get(editor) ?? 0) + 1);
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    const left = (pending.get(editor) ?? 1) - 1;
    if (left > 0) pending.set(editor, left);
    else pending.delete(editor);
  };
}

/** Whether a caret restore scheduled for `editor` has not yet run or been dropped. */
export function isCaretRestorePending(editor: object): boolean {
  return pending.has(editor);
}
