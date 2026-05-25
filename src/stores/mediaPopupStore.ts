/**
 * Media Popup Store — slice projection of usePopupStore.
 * Routes to popupStore's `mediaPopup` slice.
 *
 * @module stores/mediaPopupStore
 */

import { usePopupStore, type MediaNodeType } from "./popupStore";
import { createSliceShim } from "./_shimHelper";
import type { ImageDimensions } from "@/types/image";
import type { AnchorRect } from "@/utils/popupPosition";

export type { MediaNodeType };

export const useMediaPopupStore = createSliceShim("mediaPopup", {
  openPopup: (data: {
    mediaSrc: string;
    mediaNodePos: number;
    mediaNodeType: MediaNodeType;
    anchorRect: AnchorRect;
    mediaAlt?: string;
    mediaTitle?: string;
    mediaDimensions?: ImageDimensions | null;
    mediaPoster?: string;
  }) => usePopupStore.getState().mediaOpenPopup(data),
  closePopup: () => usePopupStore.getState().mediaClosePopup(),
  setSrc: (src: string) => usePopupStore.getState().mediaSetSrc(src),
  setAlt: (alt: string) => usePopupStore.getState().mediaSetAlt(alt),
  setTitle: (title: string) => usePopupStore.getState().mediaSetTitle(title),
  setNodeType: (type: MediaNodeType) =>
    usePopupStore.getState().mediaSetNodeType(type),
  setDimensions: (dims: ImageDimensions | null) =>
    usePopupStore.getState().mediaSetDimensions(dims),
  setPoster: (poster: string) =>
    usePopupStore.getState().mediaSetPoster(poster),
});
