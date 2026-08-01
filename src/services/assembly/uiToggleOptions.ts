/**
 * Purpose: bind the focus-mode and typewriter-mode plugins to the UI store.
 *
 * Host-side glue. Both plugins used to call `useUIStore.getState()` and
 * `useUIStore.subscribe()` themselves, which is the coupling that stops a
 * plugin shipping as a standalone extension (ADR-015). They declare what they
 * need — "is it on" and "tell me when that changes" — and this answers.
 *
 * The subscription matters as much as the getter: both plugins must REDRAW
 * when the toggle flips, not merely read the new value the next time they
 * happen to run.
 *
 * @coordinates-with plugins/focusMode/tiptap.ts — FocusModeOptions
 * @coordinates-with plugins/typewriterMode/tiptap.ts — TypewriterModeOptions
 * @module services/assembly/uiToggleOptions
 */

import { useUIStore } from "@/stores/uiStore";

/** Options binding focus mode to the UI store. */
export const focusModeHostOptions = {
  isEnabled: () => useUIStore.getState().focusModeEnabled,
  onChange: (listener: () => void) => useUIStore.subscribe(listener),
};

/** Options binding typewriter mode to the UI store. */
export const typewriterModeHostOptions = {
  isEnabled: () => useUIStore.getState().typewriterModeEnabled,
};
