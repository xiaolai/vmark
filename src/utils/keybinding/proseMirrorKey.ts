/**
 * Purpose: Convert a shortcut-store chord string into the key names ProseMirror's
 * keydownHandler expects. Pure leaf util shared by the WYSIWYG keymap
 * (editorPlugins/keymapUtils) and the multi-cursor keymap (multiCursor/keymap)
 * so neither plugin imports the other.
 *
 * The shortcut store uses normalized arrow names (Up, Down, Left, Right); the
 * ProseMirror keydownHandler expects browser key names (ArrowUp, ArrowDown,
 * ArrowLeft, ArrowRight). Modifiers and all other keys pass through unchanged.
 *
 * The base-key token is matched case-INSENSITIVELY (the shortcuts store and the
 * canonicalizer both accept `Mod-Alt-up` / `arrowup` etc.), and an already-prefixed
 * `ArrowUp` is idempotent — so a lowercase/mixed-case rebind still produces the
 * exact `KeyboardEvent.key` ProseMirror matches (audit-fix #3).
 */
// Match an arrow token as a whole "-"-delimited segment: preceded by start-of-string
// or "-" (captured), an optional "arrow" prefix, the direction, and followed by
// end-of-string or "-" (lookahead — not consumed, so adjacent segments like
// "Up-Down" both normalize). Case-insensitive; a bare "Ctrl"/"PageUp" never matches.
const ARROW_SEGMENT = /(^|-)(?:arrow)?(up|down|left|right)(?=$|-)/gi;

export function toProseMirrorKey(key: string): string {
  return key.replace(
    ARROW_SEGMENT,
    (_m, pre: string, dir: string) =>
      pre + "Arrow" + dir.charAt(0).toUpperCase() + dir.slice(1).toLowerCase(),
  );
}
