/**
 * Editor Context Menu Store — right-click menu state for the editing
 * surfaces (opened by the per-surface triggers with a position + state
 * snapshot).
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): this
 * state was born inside the merged popup store (no legacy shim); it is
 * re-inlined here with the same open/close semantics under the
 * `openMenu`/`closeMenu` names the sibling context-menu store uses.
 *
 * @module stores/editorContextMenuStore
 */

import { create } from "zustand";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";

interface EditorContextMenuData {
  isOpen: boolean;
  position: { x: number; y: number } | null;
  snapshot: EditorContextMenuSnapshot | null;
}

interface EditorContextMenuState extends EditorContextMenuData {
  openMenu: (data: {
    position: { x: number; y: number };
    snapshot: EditorContextMenuSnapshot;
  }) => void;
  closeMenu: () => void;
}

const initialState: EditorContextMenuData = {
  isOpen: false,
  position: null,
  snapshot: null,
};

export const useEditorContextMenuStore = create<EditorContextMenuState>((set) => ({
  ...initialState,
  openMenu: (data) =>
    set({ isOpen: true, position: data.position, snapshot: data.snapshot }),
  closeMenu: () => set(initialState),
}));
