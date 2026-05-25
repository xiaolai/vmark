/**
 * Wiki Link Popup Store — slice projection of usePopupStore.
 * Routes to popupStore's `wikiLinkPopup` slice.
 *
 * @module stores/wikiLinkPopupStore
 */

import { usePopupStore } from "./popupStore";
import { createSliceShim } from "./_shimHelper";
import type { AnchorRect } from "@/utils/popupPosition";

export const useWikiLinkPopupStore = createSliceShim("wikiLinkPopup", {
  openPopup: (rect: AnchorRect, target: string, pos: number) =>
    usePopupStore.getState().wikiLinkOpenPopup(rect, target, pos),
  closePopup: () => usePopupStore.getState().wikiLinkClosePopup(),
  updateTarget: (target: string) => usePopupStore.getState().wikiLinkUpdateTarget(target),
});
