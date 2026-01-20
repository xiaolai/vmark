/**
 * Link Reference Dialog/Popup Store
 *
 * Manages state for the reference link insertion popup.
 * User provides identifier and URL to create a reference link
 * and its definition.
 */

import { create } from "zustand";
import type { AnchorRect } from "@/utils/popupPosition";

type OnInsertCallback = (identifier: string, url: string, title: string) => void;

interface LinkReferenceDialogState {
  isOpen: boolean;
  selectedText: string;
  anchorRect: AnchorRect | null;
  onInsert: OnInsertCallback | null;
}

interface LinkReferenceDialogActions {
  openDialog: (selectedText: string, onInsert: OnInsertCallback, anchorRect?: AnchorRect) => void;
  closeDialog: () => void;
  insert: (identifier: string, url: string, title: string) => void;
}

type LinkReferenceDialogStore = LinkReferenceDialogState & LinkReferenceDialogActions;

const initialState: LinkReferenceDialogState = {
  isOpen: false,
  selectedText: "",
  anchorRect: null,
  onInsert: null,
};

export const useLinkReferenceDialogStore = create<LinkReferenceDialogStore>((set, get) => ({
  ...initialState,

  openDialog: (selectedText, onInsert, anchorRect) =>
    set({
      isOpen: true,
      selectedText,
      anchorRect: anchorRect ?? null,
      onInsert,
    }),

  closeDialog: () => set(initialState),

  insert: (identifier, url, title) => {
    const { onInsert } = get();
    // Reset state before callback to ensure cleanup even if callback throws
    set(initialState);
    if (onInsert) {
      onInsert(identifier, url, title);
    }
  },
}));
