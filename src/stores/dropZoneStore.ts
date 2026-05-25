/**
 * Drop Zone Store — backward-compat shim (T09).
 * Routes to popupStore's `dropZone` slice.
 *
 * @module stores/dropZoneStore
 */

import { usePopupStore } from "./popupStore";
import { createSliceShim } from "./_shimHelper";

export const useDropZoneStore = createSliceShim("dropZone", {
  setDragging: (isDragging: boolean, hasImages?: boolean, imageCount?: number) =>
    usePopupStore.getState().dropZoneSetDragging(isDragging, hasImages, imageCount),
  reset: () => usePopupStore.getState().dropZoneReset(),
});
