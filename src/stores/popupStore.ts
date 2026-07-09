/**
 * Popup Store — T09 consolidation.
 *
 * Merges 15 legacy popup/picker/editing stores into a single Zustand
 * store with one namespaced slice per popup. Each slice preserves its
 * original field shape; actions are prefixed with the slice name to
 * disambiguate the many `openPopup` / `closePopup` collisions.
 * New popups add slices directly (no legacy shim): `editorContextMenu`
 * (the editor right-click menu) was born here post-consolidation.
 *
 * Slice mapping (was → is):
 *   - blockMathEditingStore     → state.blockMathEditing
 *   - dropZoneStore             → state.dropZone
 *   - footnotePopupStore        → state.footnotePopup
 *   - geniePickerStore          → state.geniePicker
 *   - headingPickerStore        → state.headingPicker
 *   - imageContextMenuStore     → state.imageContextMenu
 *   - imagePasteToastStore      → state.imagePasteToast
 *   - inlineMathEditingStore    → state.inlineMathEditing
 *   - linkCreatePopupStore      → state.linkCreatePopup
 *   - linkPopupStore            → state.linkPopup
 *   - mathPopupStore            → state.mathPopup
 *   - mediaPopupStore           → state.mediaPopup
 *   - sourceMathPopupStore      → state.sourceMathPopup
 *   - sourcePeekStore           → state.sourcePeek
 *   - wikiLinkPopupStore        → state.wikiLinkPopup
 *
 * Slice TYPE definitions and initial-state objects live in
 * `./popupStore/slices.ts` (leaf of the import graph); the combined
 * store type and action-group interfaces in `./popupStore/types.ts`;
 * action implementations in three action-group files
 * (`./popupStore/editingActions.ts`, `./popupStore/pickerActions.ts`,
 * `./popupStore/linkMediaActions.ts`) so every file stays under the ~300
 * LOC guideline and imports flow one direction (no cycles). The action
 * creators receive this factory's `set`/`get`, so all actions still
 * close over one factory call and behavior is unchanged.
 *
 * @module stores/popupStore
 */

import { create } from "zustand";
import {
  initialBlockMathEditing,
  initialDropZone,
  initialEditorContextMenu,
  initialFootnotePopup,
  initialGeniePicker,
  initialHeadingPicker,
  initialImageContextMenu,
  initialImagePasteToast,
  initialInlineMathEditing,
  initialLinkCreatePopup,
  initialLinkPopup,
  initialMathPopup,
  initialMediaPopup,
  initialSourceMathPopup,
  initialSourcePeek,
  initialWikiLinkPopup,
} from "./popupStore/slices";
import type { PopupStore } from "./popupStore/types";
import { createEditingPopupActions } from "./popupStore/editingActions";
import { createPickerPopupActions } from "./popupStore/pickerActions";
import { createLinkMediaPopupActions } from "./popupStore/linkMediaActions";

// Re-export shared types so consumers can keep importing from
// "@/stores/popupStore" without changes.
export type {
  InlineMathEditingCallbacks,
  MediaNodeType,
  PickerMode,
  SourcePeekRange,
} from "./popupStore/slices";
export type { PopupStore } from "./popupStore/types";

export const usePopupStore = create<PopupStore>((set, get) => ({
  blockMathEditing: initialBlockMathEditing,
  dropZone: initialDropZone,
  editorContextMenu: initialEditorContextMenu,
  footnotePopup: initialFootnotePopup,
  geniePicker: initialGeniePicker,
  headingPicker: initialHeadingPicker,
  imageContextMenu: initialImageContextMenu,
  imagePasteToast: initialImagePasteToast,
  inlineMathEditing: initialInlineMathEditing,
  linkCreatePopup: initialLinkCreatePopup,
  linkPopup: initialLinkPopup,
  mathPopup: initialMathPopup,
  mediaPopup: initialMediaPopup,
  sourceMathPopup: initialSourceMathPopup,
  sourcePeek: initialSourcePeek,
  wikiLinkPopup: initialWikiLinkPopup,

  ...createEditingPopupActions(set, get),
  ...createPickerPopupActions(set, get),
  ...createLinkMediaPopupActions(set, get),
}));
