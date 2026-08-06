/**
 * Purpose: per-view hover bookkeeping for footnote previews.
 *
 * Split from `tiptap.ts` when threading the popup's state PORT through the
 * prop handlers pushed that file past its size baseline. It is a coherent unit
 * on its own — a `WeakMap` keyed by view plus the timer discipline around it —
 * and nothing outside the hover handlers touches it.
 *
 * @coordinates-with plugins/footnotePopup/tiptap.ts — the only consumer
 * @module plugins/footnotePopup/hoverState
 */

import type { EditorView } from "@tiptap/pm/view";


export const HOVER_OPEN_DELAY_MS = 150;
export const HOVER_CLOSE_DELAY_MS = 100;

type HoverState = {
  hoverTimeout: ReturnType<typeof setTimeout> | null;
  closeTimeout: ReturnType<typeof setTimeout> | null;
  currentRefElement: HTMLElement | null;
};

// Per-view hover state so multiple editor instances (e.g. main window and
// tear-off windows, or side-by-side editors) do not interfere with each
// other's hover timers. Previously these were module-scoped.
const hoverStates = new WeakMap<EditorView, HoverState>();

export function getHoverState(view: EditorView): HoverState {
  let state = hoverStates.get(view);
  if (!state) {
    state = { hoverTimeout: null, closeTimeout: null, currentRefElement: null };
    hoverStates.set(view, state);
  }
  return state;
}

export function clearHoverTimeout(state: HoverState) {
  if (state.hoverTimeout) {
    clearTimeout(state.hoverTimeout);
    state.hoverTimeout = null;
  }
}

export function clearCloseTimeout(state: HoverState) {
  if (state.closeTimeout) {
    clearTimeout(state.closeTimeout);
    state.closeTimeout = null;
  }
}

export function resetHoverState(view: EditorView) {
  const state = getHoverState(view);
  clearHoverTimeout(state);
  clearCloseTimeout(state);
  state.currentRefElement = null;
}
