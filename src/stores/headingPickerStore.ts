/**
 * Heading Picker Store — backward-compat shim (T09).
 * Routes to popupStore's `headingPicker` slice.
 *
 * @module stores/headingPickerStore
 */

import { usePopupStore } from "./popupStore";
import { createSliceShim } from "./_shimHelper";
import type { HeadingWithId } from "@/utils/headingSlug";
import type { AnchorRect, BoundaryRects } from "@/utils/popupPosition";

type OnSelectCallback = (id: string, text: string) => void;

export const useHeadingPickerStore = createSliceShim("headingPicker", {
  openPicker: (
    headings: HeadingWithId[],
    onSelect: OnSelectCallback,
    options?: { anchorRect?: AnchorRect; containerBounds?: BoundaryRects },
  ) => usePopupStore.getState().headingOpenPicker(headings, onSelect, options),
  closePicker: () => usePopupStore.getState().headingClosePicker(),
  selectHeading: (heading: HeadingWithId) =>
    usePopupStore.getState().headingSelectHeading(heading),
});
