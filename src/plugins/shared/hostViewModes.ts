/**
 * Purpose: the editor view modes a plugin decorates for.
 *
 * Focus mode, typewriter mode and diagram preview are USER TOGGLES, but not
 * settings: they are transient view state the user flips from a menu, and the
 * app keeps them in its UI store rather than its settings store. Plugins that
 * decorate need both halves — the current value, and a signal when it
 * changes, because a toggle must repaint immediately rather than at the next
 * transaction.
 *
 * Separate from `hostSettings` because the app's own split is real: these
 * are not persisted preferences, and binding them through the settings seam
 * would mean one `onChange` fanning out across two unrelated stores.
 *
 * All three default OFF — a standalone plugin decorates nothing extra, which
 * is the same thing a user who has never toggled them sees.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @module plugins/shared/hostViewModes
 */

/** The view toggles a plugin reads. */
export interface HostViewModes {
  focusMode: () => boolean;
  typewriterMode: () => boolean;
  diagramPreview: () => boolean;
  /**
   * Subscribe to any toggle changing; returns an unsubscribe.
   *
   * Deliberately not per-toggle: every consumer rebuilds its decorations
   * wholesale, and three subscriptions would be three chances to leak one.
   */
  onChange: (listener: () => void) => () => void;
}

/** Everything off — a plugin with no host decorates nothing extra. */
const DEFAULTS: HostViewModes = {
  focusMode: () => false,
  typewriterMode: () => false,
  diagramPreview: () => false,
  onChange: () => () => {},
};

let bound: HostViewModes = DEFAULTS;

/** Bind the host's view modes. Called once, at app startup. */
export function bindHostViewModes(modes: Partial<HostViewModes>): void {
  bound = { ...DEFAULTS, ...modes };
}

/** Restore defaults. Tests only. */
export function resetHostViewModes(): void {
  bound = DEFAULTS;
}

/** The bound toggles, read through accessors so they are never captured stale. */
export const hostViewModes: HostViewModes = {
  focusMode: () => bound.focusMode(),
  typewriterMode: () => bound.typewriterMode(),
  diagramPreview: () => bound.diagramPreview(),
  onChange: (listener) => bound.onChange(listener),
};
