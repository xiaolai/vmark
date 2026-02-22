/**
 * Shared Types for Popup Views
 *
 * Common type definitions used by popup view classes.
 */

import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { AnchorRect } from "@/utils/popupPosition";

/**
 * Minimal TipTap/ProseMirror-like editor view interface.
 * Uses concrete ProseMirror types for state and dispatch
 * to enforce type safety at all call sites.
 */
export type EditorViewLike = {
  dom: HTMLElement;
  state: EditorState;
  dispatch: (tr: Transaction) => void;
  focus: () => void;
};

/**
 * Minimal store interface for popup views.
 * Stores should have at least isOpen, anchorRect, and closePopup.
 */
export interface PopupStoreBase {
  isOpen: boolean;
  anchorRect: AnchorRect | null;
  closePopup: () => void;
}

/**
 * Store-like interface that provides getState and subscribe.
 */
export interface StoreApi<T> {
  getState: () => T;
  subscribe: (listener: (state: T) => void) => () => void;
}

/**
 * Configuration options for popup positioning.
 */
export interface PopupPositionConfig {
  width: number;
  height: number;
  gap?: number;
  preferAbove?: boolean;
}
