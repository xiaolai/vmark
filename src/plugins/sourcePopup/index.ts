/**
 * Source Popup Infrastructure
 *
 * Shared infrastructure for popup views in Source mode (CodeMirror 6).
 */

export { SourcePopupView } from "./SourcePopupView";
export type {
  PopupStoreBase,
  StoreApi,
  PopupPositionConfig,
} from "./SourcePopupView";

export {
  createSourcePopupPlugin,
  createPositionBasedDetector,
} from "./createSourcePopupPlugin";
export type { PopupTriggerConfig } from "./createSourcePopupPlugin";

export {
  getAnchorRectFromRange,
  getEditorBounds,
  getEditorContainer,
  getPopupHost,
  getPopupHostForDom,
  toHostCoords,
  toHostCoordsForDom,
  isPositionVisible,
  getLineNumber,
  scrollIntoViewIfNeeded,
  posToLineCol,
  lineColToPos,
} from "./sourcePopupUtils";
