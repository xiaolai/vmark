/**
 * Source Peek Store — slice projection of usePopupStore.
 * Routes to popupStore's `sourcePeek` slice.
 *
 * @module stores/sourcePeekStore
 */

import { usePopupStore, type SourcePeekRange } from "./popupStore";
import { createSliceShim } from "./_shimHelper";

export type { SourcePeekRange };

export const useSourcePeekStore = createSliceShim("sourcePeek", {
  open: (payload: {
    markdown: string;
    range: SourcePeekRange;
    blockTypeName?: string;
  }) => usePopupStore.getState().sourcePeekOpen(payload),
  close: () => usePopupStore.getState().sourcePeekClose(),
  setMarkdown: (markdown: string) =>
    usePopupStore.getState().sourcePeekSetMarkdown(markdown),
  setParseError: (error: string | null) =>
    usePopupStore.getState().sourcePeekSetParseError(error),
  toggleLivePreview: () => usePopupStore.getState().sourcePeekToggleLivePreview(),
  markSaved: () => usePopupStore.getState().sourcePeekMarkSaved(),
  getOriginalMarkdown: () =>
    usePopupStore.getState().sourcePeekGetOriginalMarkdown(),
});
