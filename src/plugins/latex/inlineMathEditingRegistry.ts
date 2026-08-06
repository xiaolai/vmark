/**
 * Purpose: which inline-math node is currently open for editing.
 *
 * The latex plugin owns this state; the app merely happened to store it. Only
 * `MathInlineNodeView` reads or writes it, and only to answer one question —
 * "am I the node being edited, and if not, whose editor do I have to close?"
 *
 * So the default here is not a stub: it is the whole implementation, holding
 * one position and one callback pair. The app passes its own shared instance
 * (`appInlineMathEditingRegistry` in `services/assembly/hostAdapters.ts`) so
 * every editor sees the same state, but a plugin lifted out of this repo has
 * working inline-math editing with no host at all (ADR-015).
 *
 * Key decisions:
 *   - `startEditing` on a DIFFERENT position force-exits the previous editor
 *     first. Two open math editors would both hold a live ProseMirror
 *     position, and the second edit would invalidate the first.
 *   - `stopEditing` and `clear` are the same operation. They read differently
 *     at the call site — one is "user finished", one is "node destroyed" — but
 *     both mean "release the registry if it still points at me". Keeping them
 *     as two names with one body preserves the call-site meaning.
 *   - Both are position-guarded: a stale destroy must not clear an editor that
 *     has since opened somewhere else.
 *
 * @coordinates-with plugins/latex/MathInlineNodeView.ts — the only consumer
 * @coordinates-with plugins/latex/tiptapInlineMath.ts — passes the host's registry
 * @module plugins/latex/inlineMathEditingRegistry
 */

/** What the registry can do to an editor that is already open. */
interface InlineMathEditingCallbacks {
  forceExit: () => void;
  getNodePos: () => number | undefined;
}

/** The editing registry an inline-math node view talks to. */
export interface InlineMathEditingRegistry {
  startEditing: (pos: number, callbacks: InlineMathEditingCallbacks) => void;
  stopEditing: (pos: number) => void;
  isEditingAt: (pos: number) => boolean;
  clear: (pos: number) => void;
}

/**
 * A standalone registry. This is the plugin's real implementation, not a stub —
 * see the module header for why the default carries the behaviour.
 */
export function createInlineMathEditingRegistry(): InlineMathEditingRegistry {
  let editingNodePos: number | null = null;
  let activeCallbacks: InlineMathEditingCallbacks | null = null;

  const clearAt = (pos: number) => {
    if (editingNodePos === pos) {
      editingNodePos = null;
      activeCallbacks = null;
    }
  };

  return {
    startEditing(pos, callbacks) {
      if (editingNodePos !== null && editingNodePos !== pos && activeCallbacks) {
        activeCallbacks.forceExit();
      }
      editingNodePos = pos;
      activeCallbacks = callbacks;
    },
    stopEditing: clearAt,
    isEditingAt: (pos) => editingNodePos === pos,
    clear: clearAt,
  };
}
