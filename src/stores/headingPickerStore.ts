/**
 * Heading Picker Store — heading-anchor picker popup state.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/headingPickerStore
 */

import { create } from "zustand";
import type { HeadingWithId } from "@/utils/headingSlug";
import type { AnchorRect, BoundaryRects } from "@/utils/popupPosition";

type OnSelectCallback = (id: string, text: string) => void;

interface HeadingPickerData {
  isOpen: boolean;
  headings: HeadingWithId[];
  anchorRect: AnchorRect | null;
  containerBounds: BoundaryRects | null;
  onSelect: OnSelectCallback | null;
}

interface HeadingPickerState extends HeadingPickerData {
  openPicker: (
    headings: HeadingWithId[],
    onSelect: OnSelectCallback,
    // Both `| undefined`: the caller forwards a DOM measurement that may not
    // exist; the implementation normalises each to `null`.
    options?: {
      anchorRect?: AnchorRect | undefined;
      containerBounds?: BoundaryRects | undefined;
    },
  ) => void;
  closePicker: () => void;
  selectHeading: (heading: HeadingWithId) => void;
}

const initialState: HeadingPickerData = {
  isOpen: false,
  headings: [],
  anchorRect: null,
  containerBounds: null,
  onSelect: null,
};

export const useHeadingPickerStore = create<HeadingPickerState>((set, get) => ({
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
  // Capture the callback, reset first, then invoke: a callback that opens a
  // new picker must not be clobbered by the reset, and a throwing callback
  // must not leave the picker stuck open.
  selectHeading: (heading) => {
    const { onSelect } = get();
    set(initialState);
    if (onSelect) onSelect(heading.id, heading.text);
  },
}));
