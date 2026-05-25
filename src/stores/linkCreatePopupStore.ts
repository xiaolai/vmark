/**
 * Link Create Popup Store — backward-compat shim (T09).
 * Routes to popupStore's `linkCreatePopup` slice.
 *
 * @module stores/linkCreatePopupStore
 */

import { usePopupStore } from "./popupStore";
import { createSliceShim } from "./_shimHelper";
import type { AnchorRect } from "@/utils/popupPosition";

export const useLinkCreatePopupStore = createSliceShim("linkCreatePopup", {
  openPopup: (data: {
    text: string;
    rangeFrom: number;
    rangeTo: number;
    anchorRect: AnchorRect;
    showTextInput: boolean;
  }) => usePopupStore.getState().linkCreateOpenPopup(data),
  closePopup: () => usePopupStore.getState().linkCreateClosePopup(),
  setText: (text: string) => usePopupStore.getState().linkCreateSetText(text),
  setUrl: (url: string) => usePopupStore.getState().linkCreateSetUrl(url),
});
