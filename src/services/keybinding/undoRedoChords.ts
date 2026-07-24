/**
 * Undo/redo chords — the single source of truth (ADR-018, WI-4.3).
 *
 * Both editor keymaps bind undo/redo from HERE instead of hardcoding the chords
 * independently, so the WYSIWYG (`editorPlugins.tiptap.ts`) and Source
 * (`sourceEditorKeymap.ts`) definitions can never drift apart.
 *
 * These are structural editor mechanics, not rebindable shortcuts: the chords
 * are deliberately absent from `shortcutDefinitions.ts`, and the keymaps call
 * `performUnifiedUndo`/`performUnifiedRedo` directly (unified cross-mode history)
 * rather than routing through the CommandBus. On macOS `Mod-y` is reserved for
 * the AI genie picker (`aiPrompts`), so `Mod-y` → redo binds only off-mac.
 *
 * @coordinates-with plugins/editorPlugins.tiptap.ts — WYSIWYG keymap
 * @coordinates-with services/assembly/sourceEditorKeymap.ts — Source keymap
 * @module services/keybinding/undoRedoChords
 */

/** Undo chord (both platforms). */
export const UNDO_CHORD = "Mod-z";
/** Primary redo chord (both platforms). */
export const REDO_CHORD = "Mod-Shift-z";
/** Windows/Linux redo convention; reserved for `aiPrompts` on macOS. */
export const REDO_CHORD_WINLINUX = "Mod-y";

/**
 * The redo chords for the current platform. `Mod-y` is added off-mac only —
 * on macOS it belongs to the AI genie picker.
 */
export function redoChords(isMac: boolean): readonly string[] {
  return isMac ? [REDO_CHORD] : [REDO_CHORD, REDO_CHORD_WINLINUX];
}
