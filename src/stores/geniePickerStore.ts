/**
 * Genie Picker Store — slice projection of usePopupStore.
 * Routes to popupStore's `geniePicker` slice.
 *
 * @module stores/geniePickerStore
 */

import { usePopupStore, type PickerMode } from "./popupStore";
import { createSliceShim } from "./_shimHelper";
import type { GenieScope } from "@/types/aiGenies";

export type { PickerMode };

export const useGeniePickerStore = createSliceShim("geniePicker", {
  openPicker: (options?: { filterScope?: GenieScope }) =>
    usePopupStore.getState().genieOpenPicker(options),
  closePicker: () => usePopupStore.getState().genieClosePicker(),
  setMode: (mode: PickerMode) => usePopupStore.getState().genieSetMode(mode),
  startProcessing: (prompt: string) =>
    usePopupStore.getState().genieStartProcessing(prompt),
  appendResponse: (chunk: string) =>
    usePopupStore.getState().genieAppendResponse(chunk),
  setPreview: (fullText: string) =>
    usePopupStore.getState().genieSetPreview(fullText),
  setPickerError: (message: string) =>
    usePopupStore.getState().genieSetPickerError(message),
  resetToInput: () => usePopupStore.getState().genieResetToInput(),
});
