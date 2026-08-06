/**
 * Purpose: the user's key bindings, for plugins that build their own keymap.
 *
 * The fourth seam, kept separate from its siblings for the same reason they
 * are separate from each other: `hostSettings` answers "what did the user
 * configure", `hostDocument` "what document am I in", `hostPopups` "please
 * open this surface", and this one "what chord did the user bind to X".
 *
 * A plugin that builds a keymap needs BOTH halves — the current chord and a
 * signal when it changes — because a rebind has to rebuild the keymap of every
 * mounted view. `multiCursor` is the motivating case; a keymap is assembled
 * deep inside a CodeMirror `ViewPlugin`, where an extension option cannot
 * reach.
 *
 * The default returns "" for every id, which `bindIfKey`-style callers already
 * treat as "unbound" and skip. So a plugin lifted out of this repo gets an
 * editor with no shortcuts rather than a crash — the same shape as
 * `hostPopups`' no-ops.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @module plugins/shared/hostShortcuts
 */

/** Key bindings a plugin needs to build its keymap. */
export interface HostShortcuts {
  /** The chord bound to `id`, or "" when unbound. */
  getShortcut: (id: string) => string;
  /**
   * Subscribe to rebinds; returns an unsubscribe.
   *
   * A plugin must REBUILD its keymap when a chord changes, not merely read the
   * new value the next time it happens to run.
   */
  onChange: (listener: () => void) => () => void;
}

/** Nothing bound — callers skip an empty chord, so this yields no keymap. */
const DEFAULTS: HostShortcuts = {
  getShortcut: () => "",
  onChange: () => () => {},
};

let bound: HostShortcuts = DEFAULTS;

/** Bind the host's keybindings. Called once, at app startup. */
export function bindHostShortcuts(shortcuts: Partial<HostShortcuts>): void {
  bound = { ...DEFAULTS, ...shortcuts };
}

/** Restore defaults. Tests only. */
export function resetHostShortcuts(): void {
  bound = DEFAULTS;
}

/** The bound keybindings, read through accessors so they are never stale. */
export const hostShortcuts: HostShortcuts = {
  getShortcut: (id) => bound.getShortcut(id),
  onChange: (listener) => bound.onChange(listener),
};
