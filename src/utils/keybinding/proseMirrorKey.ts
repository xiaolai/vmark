/**
 * Purpose: Convert a shortcut-store chord string into the key names ProseMirror's
 * keydownHandler expects. Pure leaf util shared by the WYSIWYG keymap
 * (editorPlugins/keymapUtils) and the multi-cursor keymap (multiCursor/keymap)
 * so neither plugin imports the other.
 *
 * The shortcut store uses normalized arrow names (Up, Down, Left, Right); the
 * ProseMirror keydownHandler expects browser key names (ArrowUp, ArrowDown,
 * ArrowLeft, ArrowRight). Modifiers and all other keys pass through unchanged.
 */
export function toProseMirrorKey(key: string): string {
  return key
    .replace(/\bUp\b/g, "ArrowUp")
    .replace(/\bDown\b/g, "ArrowDown")
    .replace(/\bLeft\b/g, "ArrowLeft")
    .replace(/\bRight\b/g, "ArrowRight");
}
