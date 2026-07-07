/**
 * Source Popup Infrastructure
 *
 * Shared infrastructure for popup views in Source mode (CodeMirror 6).
 */

export { SourcePopupView } from "./SourcePopupView";
export type { StoreApi } from "./SourcePopupView";  export { createSourcePopupPlugin } from "./createSourcePopupPlugin";

export { getPopupHost, getPopupHostForDom, toHostCoords, toHostCoordsForDom } from "./sourcePopupUtils";
