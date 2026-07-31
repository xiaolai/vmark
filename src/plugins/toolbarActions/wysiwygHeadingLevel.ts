/**
 * WYSIWYG heading-level stepping.
 *
 * Purpose: the `increaseHeading` / `decreaseHeading` pair for WYSIWYG mode,
 * plus the level lookup they share.
 *
 * Key decisions:
 *   - "Heading level" is NUMERIC: increase means paragraph → H1 → … → H6, and
 *     decrease is its exact inverse. This matches the command's label
 *     ("Increase Heading Level"), the `]`/`[` accelerators, and Source mode,
 *     whose convention is implemented twice against WYSIWYG's once. The two
 *     surfaces previously stepped in OPPOSITE directions from the same button.
 *   - Both directions clamp rather than wrap, so repeated presses cannot cycle
 *     H6 back into a paragraph and silently destroy structure.
 *   - The pair must always be changed together or the operation stops being
 *     reversible.
 *   - Both functions return ProseMirror's `.run()` verdict — a schema can
 *     reject the conversion, and claiming success for a no-op misinformed the
 *     dispatcher.
 *
 * @coordinates-with wysiwygAdapter.ts — dispatches the two actions here
 * @coordinates-with sourceBlockActions.ts — the Source pair this mirrors
 * @module plugins/toolbarActions/wysiwygHeadingLevel
 */
import type { Editor as TiptapEditor } from "@tiptap/core";

/**
 * Get the heading level of the block containing the cursor, or null if not a heading.
 */
export function getCurrentHeadingLevel(editor: TiptapEditor): number | null {
  const { $from } = editor.state.selection;
  const parent = $from.parent;
  if (parent.type.name === "heading") {
    return parent.attrs.level as number;
  }
  return null;
}

/**
 * Increase heading LEVEL — paragraph -> H1, H1 -> H2, … H6 clamps.
 *
 * "Level" is a number, and increasing it adds a `#`. The two surfaces used to
 * read this word in opposite directions: Source incremented the level while
 * WYSIWYG made the heading more prominent, so from an H3 the same toolbar button
 * gave H4 in one mode and H2 in the other. Each was self-consistent, which is
 * why no single-surface test caught it.
 *
 * The numeric reading wins on three counts, and WYSIWYG is the side that moved:
 * the label says "Heading Level"; the accelerator is `Mod-Alt-]`, matching the
 * indent metaphor `]` already carries elsewhere; and Source's convention is
 * implemented twice (here and in `codemirror/sourceShortcutsHelpers`) against
 * WYSIWYG's once.
 *
 * Never wraps — repeated presses must not silently destroy or recreate
 * structure by cycling H6 back to a paragraph.
 */
export function increaseHeadingLevel(editor: TiptapEditor): boolean {
  const currentLevel = getCurrentHeadingLevel(editor);
  // `.run()` is ProseMirror's verdict on whether the conversion applied — a
  // schema can reject it. Discarding it reported success for a no-op.
  if (currentLevel === null) {
    return editor.chain().focus().setHeading({ level: 1 }).run();
  }
  if (currentLevel < 6) {
    return editor.chain().focus().setHeading({ level: (currentLevel + 1) as 2 | 3 | 4 | 5 | 6 }).run();
  }
  return false;
}

/**
 * Decrease heading LEVEL — H6 -> H5, … H1 -> paragraph, paragraph clamps.
 *
 * The exact inverse of `increaseHeadingLevel`; the pair must always be flipped
 * together or the operation stops being reversible.
 */
export function decreaseHeadingLevel(editor: TiptapEditor): boolean {
  const currentLevel = getCurrentHeadingLevel(editor);
  if (currentLevel === null) return false;
  if (currentLevel > 1) {
    return editor.chain().focus().setHeading({ level: (currentLevel - 1) as 1 | 2 | 3 | 4 | 5 }).run();
  }
  return editor.chain().focus().setParagraph().run();
}
