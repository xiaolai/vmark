/**
 * Image Context Menu Store — backward-compat shim (T09).
 * Routes to popupStore's `imageContextMenu` slice.
 *
 * @module stores/imageContextMenuStore
 */

import { usePopupStore } from "./popupStore";
import { createSliceShim } from "./_shimHelper";

export const useImageContextMenuStore = createSliceShim("imageContextMenu", {
  openMenu: (data: {
    position: { x: number; y: number };
    imageSrc: string;
    imageNodePos: number;
  }) => usePopupStore.getState().imageContextOpenMenu(data),
  closeMenu: () => usePopupStore.getState().imageContextCloseMenu(),
});
