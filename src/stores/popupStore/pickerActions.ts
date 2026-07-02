/**
 * Popup-store picker action group — footnotePopup, geniePicker, and
 * headingPicker.
 *
 * Purpose: action implementations for the picker-style slices of the
 * popup store. Extracted verbatim from `../popupStore.ts` (pure code
 * motion; behavior unchanged). The `PickerPopupActions` interface lives
 * in `./types.ts` (one-directional imports — no cycles). The composition
 * root spreads `createPickerPopupActions(set, get)` into the store
 * factory.
 *
 * @module stores/popupStore/pickerActions
 */

import {
  initialFootnotePopup,
  initialGeniePicker,
  initialHeadingPicker,
} from "./slices";
import type { PickerPopupActions, PopupGet, PopupSet } from "./types";

export function createPickerPopupActions(
  set: PopupSet,
  get: PopupGet,
): PickerPopupActions {
  return {
    /* footnotePopup */
    footnoteOpenPopup: (label, content, anchorRect, definitionPos, referencePos, autoFocus = false) =>
      set({
        footnotePopup: {
          isOpen: true,
          label,
          content,
          anchorRect,
          definitionPos,
          referencePos,
          autoFocus,
        },
      }),
    footnoteSetContent: (content) =>
      set((s) => ({ footnotePopup: { ...s.footnotePopup, content } })),
    footnoteClosePopup: () => set({ footnotePopup: initialFootnotePopup }),

    /* geniePicker */
    genieOpenPicker: (options) =>
      set({
        geniePicker: {
          ...initialGeniePicker,
          isOpen: true,
          filterScope: options?.filterScope ?? null,
        },
      }),
    genieClosePicker: () => set({ geniePicker: initialGeniePicker }),
    genieSetMode: (mode) =>
      set((s) => ({ geniePicker: { ...s.geniePicker, mode } })),
    genieStartProcessing: (prompt) =>
      set((s) => ({
        geniePicker: {
          ...s.geniePicker,
          mode: "processing",
          submittedPrompt: prompt,
          responseText: "",
          pickerError: null,
        },
      })),
    genieAppendResponse: (chunk) =>
      set((s) => ({
        geniePicker: {
          ...s.geniePicker,
          responseText: s.geniePicker.responseText + chunk,
        },
      })),
    genieSetPreview: (fullText) =>
      set((s) => ({
        geniePicker: { ...s.geniePicker, mode: "preview", responseText: fullText },
      })),
    genieSetPickerError: (message) =>
      set((s) => ({
        geniePicker: { ...s.geniePicker, mode: "error", pickerError: message },
      })),
    genieResetToInput: () =>
      set((s) => ({
        geniePicker: {
          ...s.geniePicker,
          mode: "search",
          submittedPrompt: null,
          responseText: "",
          pickerError: null,
        },
      })),

    /* headingPicker */
    headingOpenPicker: (headings, onSelect, options) =>
      set({
        headingPicker: {
          isOpen: true,
          headings,
          anchorRect: options?.anchorRect ?? null,
          containerBounds: options?.containerBounds ?? null,
          onSelect,
        },
      }),
    headingClosePicker: () => set({ headingPicker: initialHeadingPicker }),
    headingSelectHeading: (heading) => {
      const { onSelect } = get().headingPicker;
      set({ headingPicker: initialHeadingPicker });
      if (onSelect) onSelect(heading.id, heading.text);
    },
  };
}
