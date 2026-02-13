/**
 * Shared test helpers for multi-cursor tests.
 *
 * Provides a minimal ProseMirror schema and state creation utilities.
 */
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { MultiSelection } from "../MultiSelection";

/** Minimal schema: single paragraph with text. */
export const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

/** Create a doc with a single paragraph containing `text`. */
export function createDoc(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
}

/** Create an EditorState with a single paragraph. */
export function createState(text: string) {
  return EditorState.create({
    doc: createDoc(text),
    schema,
    plugins: [multiCursorPlugin()],
  });
}

/**
 * Create an EditorState with a MultiSelection at the given positions.
 *
 * Positions use ProseMirror's absolute numbering:
 * - For `<doc><p>hello</p></doc>`: pos 1 = before 'h', pos 6 = after 'o'
 */
export function createMultiCursorState(
  text: string,
  positions: Array<{ from: number; to: number }>
) {
  const state = createState(text);
  const doc = state.doc;
  const ranges = positions.map((p) => {
    const $from = doc.resolve(p.from);
    const $to = doc.resolve(p.to);
    return new SelectionRange($from, $to);
  });
  const multiSel = new MultiSelection(ranges, 0);
  return state.apply(state.tr.setSelection(multiSel));
}
