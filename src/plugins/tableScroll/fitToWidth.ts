/**
 * Per-Table Fit-to-Width Helpers
 *
 * Purpose: Ephemeral per-table fit-to-width toggle via DOM class on the
 * table scroll wrapper. State resets on mode switch or editor remount
 * by design — no markdown representation exists.
 *
 * @coordinates-with tableActions.tiptap.ts — toggleFitToWidth uses these helpers
 * @coordinates-with TiptapTableContextMenu.ts — reads state to show correct label
 * @module plugins/tableScroll/fitToWidth
 */

const FIT_CLASS = "table-fit-to-width";

/** Check if a table wrapper is in fit-to-width mode. */
export function isWrapperFitToWidth(wrapper: HTMLElement): boolean {
  return wrapper.classList.contains(FIT_CLASS);
}

/** Set fit-to-width mode on a table wrapper. */
export function setWrapperFitToWidth(wrapper: HTMLElement, value: boolean): void {
  if (value) {
    wrapper.classList.add(FIT_CLASS);
  } else {
    wrapper.classList.remove(FIT_CLASS);
  }
}

/** Toggle fit-to-width mode on a table wrapper. Returns the new state. */
export function toggleWrapperFitToWidth(wrapper: HTMLElement): boolean {
  const newState = !isWrapperFitToWidth(wrapper);
  setWrapperFitToWidth(wrapper, newState);
  return newState;
}
