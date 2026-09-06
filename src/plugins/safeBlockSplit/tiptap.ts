/**
 * Safe block split for cross-block selections.
 *
 * Purpose: stop Enter from throwing when the selection spans two blocks.
 *
 * Tiptap's own `splitBlock` (`@tiptap/core`, `src/commands/splitBlock.ts`)
 * evaluates `canSplit` against the PRE-deletion document, then calls
 * `tr.deleteSelection()`, then splits at the mapped position without
 * recomputing eligibility. Deleting a selection that spans two empty
 * paragraphs changes the insertion depth, so the earlier answer no longer
 * describes the document being split, and ProseMirror raises
 * `TransformError: Inserted content deeper than insertion position`. The Enter
 * edit is aborted (audit 20260906, F5).
 *
 * Reproduced on the full VMark stack AND on vanilla StarterKit, and still
 * present in 3.31.3, so this is an upstream defect VMark works around rather
 * than one it caused.
 *
 * The remedy is simply to use ProseMirror's own `splitBlock`
 * (`prosemirror-commands`), which does the same work in the correct ORDER —
 * it deletes the selection into a transaction and then asks `canSplit` about
 * `tr.doc`. No reimplementation, no forked transform logic.
 *
 * Scope is deliberately minimal: this fires ONLY for a non-empty selection
 * whose ends sit in different parent blocks, which is exactly the shape that
 * throws. A collapsed cursor — the overwhelmingly common Enter — never reaches
 * here, so list continuation, task items, code blocks, AI suggestions and the
 * media node views keep their existing Enter behavior untouched. Its priority
 * sits below `listContinuation` (1000) so list handling still gets first
 * refusal, and above StarterKit's default so the broken path is not reached.
 *
 * @coordinates-with plugins/listContinuation/tiptap.ts — higher-priority Enter
 * @coordinates-with src/test/splitBlockSelection.test.ts — the regression pins
 * @module plugins/safeBlockSplit/tiptap
 */
import { Extension } from "@tiptap/core";
import { keymap } from "@tiptap/pm/keymap";
import { splitBlock } from "@tiptap/pm/commands";
import { TextSelection, type Command } from "@tiptap/pm/state";
import { guardProseMirrorCommand } from "@/utils/imeGuard";

/**
 * Handle Enter only for the selection shape that would otherwise throw.
 *
 * Returning `false` for everything else is what keeps this safe: the key falls
 * through to the handlers that already own it.
 */
const handleCrossBlockEnter: Command = (state, dispatch, view) => {
  const { selection } = state;
  // Collapsed cursor: the ordinary case, and not the broken one.
  if (selection.empty) return false;
  // Node and cell selections have their own handlers and their own semantics.
  if (!(selection instanceof TextSelection)) return false;

  const { $from, $to } = selection;
  // Both ends inside one block splits correctly today — leave it alone.
  if ($from.sameParent($to)) return false;

  return splitBlock(state, dispatch, view);
};

/** Enter on a cross-block selection, ordered so the split cannot throw. */
export const safeBlockSplitExtension = Extension.create({
  name: "safeBlockSplit",
  priority: 999,
  addProseMirrorPlugins() {
    return [
      keymap({
        Enter: guardProseMirrorCommand(handleCrossBlockEnter),
      }),
    ];
  },
});
