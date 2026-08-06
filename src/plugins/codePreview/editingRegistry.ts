/**
 * Purpose: which fenced block is open for editing, rather than previewed.
 *
 * The codePreview plugin owns this state; the app merely happened to hold it.
 * Nothing outside this plugin reads or writes it — the same situation the
 * latex inline-math registry was in.
 *
 * A binder rather than an extension option because four modules need it
 * (the extension, the keymap, the decoration builder and the edit-mode
 * helpers), and three of them are reached from ProseMirror callbacks rather
 * than from the extension's own entry point.
 *
 * The default is the whole implementation, not a stub: `editingPos` is read
 * on every decoration pass, so a throwing port would make any editor built
 * without the app's assembly unusable, and "nothing is being edited" is an
 * honest answer for a standalone plugin.
 *
 * @coordinates-with plugins/codePreview/tiptap.ts — reads editingPos per pass
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @module plugins/codePreview/editingRegistry
 */

import type { StoreApi } from "zustand";

/** The block-editing state, as the plugin declares it. */
interface BlockMathEditingState {
  editingPos: number | null;
  /** Content captured at open — the revert target when the user escapes. */
  originalContent: string | null;
  startEditing: (pos: number, content: string) => void;
  exitEditing: () => void;
  isEditingAt: (pos: number) => boolean;
}

export type BlockMathEditingStore = StoreApi<BlockMathEditingState>;

/** A standalone registry — the plugin's real implementation. */
function createStandaloneRegistry(): BlockMathEditingStore {
  let state: BlockMathEditingState;
  const listeners = new Set<(s: BlockMathEditingState, prev: BlockMathEditingState) => void>();
  const set = (patch: Partial<BlockMathEditingState>) => {
    const prev = state;
    state = { ...state, ...patch };
    for (const l of listeners) l(state, prev);
  };
  state = {
    editingPos: null,
    originalContent: null,
    startEditing: (pos, content) => set({ editingPos: pos, originalContent: content }),
    exitEditing: () => set({ editingPos: null, originalContent: null }),
    // Compared against null, not truthiness: position 0 is a real position.
    isEditingAt: (pos) => state.editingPos !== null && state.editingPos === pos,
  };
  return {
    getState: () => state,
    setState: (
      patch:
        | Partial<BlockMathEditingState>
        | ((s: BlockMathEditingState) => Partial<BlockMathEditingState>)
    ) => set(typeof patch === "function" ? patch(state) : patch),
    subscribe: (listener: (s: BlockMathEditingState, prev: BlockMathEditingState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getInitialState: () => state,
  } as unknown as BlockMathEditingStore;
}

let bound: BlockMathEditingStore = createStandaloneRegistry();

/** Bind the host's registry. Called once, at app startup. */
export function bindBlockMathEditingStore(store: BlockMathEditingStore): void {
  bound = store;
}

/** The bound registry. */
export function blockMathEditing(): BlockMathEditingStore {
  return bound;
}
