/**
 * Math Popup Store — backward-compat shim (T09).
 * Routes to popupStore's `mathPopup` slice.
 *
 * @module stores/mathPopupStore
 */

import { usePopupStore } from "./popupStore";
import { createSliceShim } from "./_shimHelper";
import type { AnchorRect } from "@/utils/popupPosition";

export const useMathPopupStore = createSliceShim("mathPopup", {
  openPopup: (rect: AnchorRect, latex: string, pos: number) =>
    usePopupStore.getState().mathOpenPopup(rect, latex, pos),
  closePopup: () => usePopupStore.getState().mathClosePopup(),
  updateLatex: (latex: string) => usePopupStore.getState().mathUpdateLatex(latex),
});
