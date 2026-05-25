/**
 * Block Math Editing Store — slice projection of usePopupStore.
 *
 * Routes to the merged popupStore's `blockMathEditing` slice. Preserves
 * the original `useBlockMathEditingStore` API so consumers don't change.
 *
 * @module stores/blockMathEditingStore
 */

import { usePopupStore } from "./popupStore";
import { createSliceShim } from "./_shimHelper";

export const useBlockMathEditingStore = createSliceShim("blockMathEditing", {
  startEditing: (pos: number, content: string) =>
    usePopupStore.getState().blockMathStartEditing(pos, content),
  exitEditing: () => usePopupStore.getState().blockMathExitEditing(),
  isEditingAt: (pos: number) => usePopupStore.getState().blockMathIsEditingAt(pos),
});
