/**
 * Inline Math Editing Store — slice projection of usePopupStore.
 * Routes to popupStore's `inlineMathEditing` slice.
 *
 * @module stores/inlineMathEditingStore
 */

import { usePopupStore, type InlineMathEditingCallbacks } from "./popupStore";
import { createSliceShim } from "./_shimHelper";

export type { InlineMathEditingCallbacks };

export const useInlineMathEditingStore = createSliceShim("inlineMathEditing", {
  startEditing: (pos: number, callbacks: InlineMathEditingCallbacks) =>
    usePopupStore.getState().inlineMathStartEditing(pos, callbacks),
  stopEditing: (pos: number) =>
    usePopupStore.getState().inlineMathStopEditing(pos),
  isEditingAt: (pos: number) =>
    usePopupStore.getState().inlineMathIsEditingAt(pos),
  clear: (pos: number) => usePopupStore.getState().inlineMathClear(pos),
});
