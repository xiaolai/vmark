/**
 * Footnote Popup Store — backward-compat shim (T09).
 * Routes to popupStore's `footnotePopup` slice.
 *
 * @module stores/footnotePopupStore
 */

import { usePopupStore } from "./popupStore";
import { createSliceShim } from "./_shimHelper";
import type { AnchorRect } from "@/utils/popupPosition";

export const useFootnotePopupStore = createSliceShim("footnotePopup", {
  openPopup: (
    label: string,
    content: string,
    anchorRect: AnchorRect,
    definitionPos: number | null,
    referencePos: number | null,
    autoFocus?: boolean,
  ) =>
    usePopupStore
      .getState()
      .footnoteOpenPopup(label, content, anchorRect, definitionPos, referencePos, autoFocus),
  setContent: (content: string) => usePopupStore.getState().footnoteSetContent(content),
  closePopup: () => usePopupStore.getState().footnoteClosePopup(),
});
