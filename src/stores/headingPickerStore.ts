/**
 * Heading Picker Store
 *
 * Manages state for the heading picker that appears when inserting bookmark links.
 * User selects a heading to create a link like [text](#heading-id).
 */

import { create } from "zustand";
import type { HeadingWithId } from "@/utils/headingSlug";
import type { AnchorRect } from "@/utils/popupPosition";

type OnSelectCallback = (id: string, text: string) => void;

interface HeadingPickerState {
  isOpen: boolean;
  headings: HeadingWithId[];
  anchorRect: AnchorRect | null;
  onSelect: OnSelectCallback | null;
}

interface HeadingPickerActions {
  openPicker: (headings: HeadingWithId[], onSelect: OnSelectCallback, anchorRect?: AnchorRect) => void;
  closePicker: () => void;
  selectHeading: (heading: HeadingWithId) => void;
}

type HeadingPickerStore = HeadingPickerState & HeadingPickerActions;

const initialState: HeadingPickerState = {
  isOpen: false,
  headings: [],
  anchorRect: null,
  onSelect: null,
};

export const useHeadingPickerStore = create<HeadingPickerStore>((set, get) => ({
  ...initialState,

  openPicker: (headings, onSelect, anchorRect) =>
    set({
      isOpen: true,
      headings,
      anchorRect: anchorRect ?? null,
      onSelect,
    }),

  closePicker: () => set(initialState),

  selectHeading: (heading) => {
    const { onSelect } = get();
    // Reset state before callback to ensure cleanup even if callback throws
    set(initialState);
    if (onSelect) {
      onSelect(heading.id, heading.text);
    }
  },
}));
