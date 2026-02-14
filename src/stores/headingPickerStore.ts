/**
 * Heading Picker Store
 *
 * Purpose: State for the heading picker popup — shows a filterable list of
 *   document headings for bookmark link insertion [text](#heading-id).
 *
 * Key decisions:
 *   - onSelect callback is stored in state and invoked after picker closes
 *     (state reset happens first to ensure cleanup even if callback throws).
 *   - Headings include pre-computed slug IDs from headingSlug util.
 *
 * @coordinates-with bookmarkLink command — triggers picker with document headings
 * @module stores/headingPickerStore
 */

import { create } from "zustand";
import type { HeadingWithId } from "@/utils/headingSlug";
import type { AnchorRect, BoundaryRects } from "@/utils/popupPosition";

type OnSelectCallback = (id: string, text: string) => void;

interface OpenPickerOptions {
  anchorRect?: AnchorRect;
  containerBounds?: BoundaryRects;
}

interface HeadingPickerState {
  isOpen: boolean;
  headings: HeadingWithId[];
  anchorRect: AnchorRect | null;
  containerBounds: BoundaryRects | null;
  onSelect: OnSelectCallback | null;
}

interface HeadingPickerActions {
  openPicker: (headings: HeadingWithId[], onSelect: OnSelectCallback, options?: OpenPickerOptions) => void;
  closePicker: () => void;
  selectHeading: (heading: HeadingWithId) => void;
}

type HeadingPickerStore = HeadingPickerState & HeadingPickerActions;

const initialState: HeadingPickerState = {
  isOpen: false,
  headings: [],
  anchorRect: null,
  containerBounds: null,
  onSelect: null,
};

export const useHeadingPickerStore = create<HeadingPickerStore>((set, get) => ({
  ...initialState,

  openPicker: (headings, onSelect, options) =>
    set({
      isOpen: true,
      headings,
      anchorRect: options?.anchorRect ?? null,
      containerBounds: options?.containerBounds ?? null,
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
