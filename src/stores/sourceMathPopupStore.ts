/**
 * Source Math Popup Store — backward-compat shim (T09).
 * Routes to popupStore's `sourceMathPopup` slice.
 *
 * @module stores/sourceMathPopupStore
 */

import { usePopupStore } from "./popupStore";
import { createSliceShim } from "./_shimHelper";
import type { AnchorRect } from "@/utils/popupPosition";

export const useSourceMathPopupStore = createSliceShim("sourceMathPopup", {
  openPopup: (
    rect: AnchorRect,
    latex: string,
    mathFrom: number,
    mathTo: number,
    isBlock: boolean,
  ) =>
    usePopupStore
      .getState()
      .sourceMathOpenPopup(rect, latex, mathFrom, mathTo, isBlock),
  closePopup: () => usePopupStore.getState().sourceMathClosePopup(),
  updateLatex: (latex: string) =>
    usePopupStore.getState().sourceMathUpdateLatex(latex),
});
