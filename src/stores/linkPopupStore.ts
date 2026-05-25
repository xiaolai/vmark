/**
 * Link Popup Store — backward-compat shim (T09).
 * Routes to popupStore's `linkPopup` slice.
 *
 * @module stores/linkPopupStore
 */

import { usePopupStore } from "./popupStore";
import { createSliceShim } from "./_shimHelper";
import type { AnchorRect } from "@/utils/popupPosition";

export const useLinkPopupStore = createSliceShim("linkPopup", {
  openPopup: (data: {
    href: string;
    linkFrom: number;
    linkTo: number;
    anchorRect: AnchorRect;
  }) => usePopupStore.getState().linkOpenPopup(data),
  closePopup: () => usePopupStore.getState().linkClosePopup(),
  setHref: (href: string) => usePopupStore.getState().linkSetHref(href),
});
