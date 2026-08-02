/**
 * Purpose: the editor CHROME a plugin asks the host to show.
 *
 * The third seam, and the first for ACTIONS rather than values.
 * `hostSettings` answers "what did the user configure" and `hostDocument`
 * "what document am I in"; this one is "please open this surface".
 *
 * A node view is constructed by ProseMirror, not by the host, so an extension
 * option cannot reach it without threading the option through every node-view
 * constructor in the plugin. Three media node views (`block_audio`,
 * `block_video`, `block_image`) each reach a popup store directly for the same
 * reason: a double-click has to open the media editor, and the popup lives in
 * the app.
 *
 * Defaults are NO-OPS, and that is the right default for chrome: a plugin
 * lifted out of this repo renders its content and simply has no popup to
 * offer, rather than crashing on a store that is not there. Content is the
 * plugin's job; chrome is the host's.
 *
 * @coordinates-with services/assembly/bindHostSettings.ts — the app's binding
 * @module plugins/shared/hostPopups
 */

/**
 * What the media popup needs to edit a media node.
 *
 * Mirrors the request the three media node views actually send. Written
 * against the CALL SITES rather than guessed — the first draft omitted
 * `anchorRect` and `mediaAlt` and the compiler said so, the same way it did
 * for the paste and copy unions.
 */
export interface MediaPopupRequest {
  mediaSrc: string;
  mediaNodePos: number;
  mediaNodeType: string;
  /** Where to anchor the popup, in viewport coordinates. */
  anchorRect: { top: number; left: number; right: number; bottom: number };
  mediaAlt?: string;
  mediaTitle?: string;
  mediaDimensions?: { width: number; height: number } | null;
  mediaPoster?: string;
}

/** What the image context menu needs. */
export interface ImageMenuRequest {
  position: { x: number; y: number };
  imageSrc: string;
  imageNodePos: number;
}

/** What the footnote popup needs to edit a footnote. */
export interface FootnotePopupRequest {
  label: string;
  content: string;
  anchorRect: { top: number; left: number; right: number; bottom: number };
  definitionPos: number | null;
  referencePos: number | null;
  autoFocus?: boolean;
}

/** Editor chrome a plugin can ask the host to present. */
export interface HostPopups {
  openMediaPopup: (request: MediaPopupRequest) => void;
  openImageMenu: (request: ImageMenuRequest) => void;
  /**
   * Open the footnote editor.
   *
   * Here rather than as a `footnotePopup` extension option because the ASKER
   * is a different plugin: the toolbar's "insert footnote" action lives in
   * `toolbarActions` and must open a surface `footnotePopup` owns. Routing it
   * through an option would mean `toolbarActions` importing the store, moving
   * the coupling rather than removing it.
   */
  openFootnotePopup: (request: FootnotePopupRequest) => void;
  /**
   * Close the universal toolbar if it is open; report whether it was.
   *
   * The one CLOSE in a seam otherwise about opening, and it returns a boolean
   * because the caller is an Escape handler: it must know whether it consumed
   * the key or should fall through to collapsing the selection.
   */
  dismissUniversalToolbar: () => boolean;
}

/** No chrome — a standalone plugin still renders, it just cannot offer edits. */
const DEFAULTS: HostPopups = {
  openMediaPopup: () => {},
  openImageMenu: () => {},
  openFootnotePopup: () => {},
  // No toolbar to close, so Escape was NOT consumed — falling through is the
  // correct standalone behaviour, and `true` here would swallow the key.
  dismissUniversalToolbar: () => false,
};

let bound: HostPopups = DEFAULTS;

/** Bind the host's popups. Called once, at app startup. */
export function bindHostPopups(popups: Partial<HostPopups>): void {
  bound = { ...DEFAULTS, ...popups };
}

/** Restore defaults. Tests only. */
export function resetHostPopups(): void {
  bound = DEFAULTS;
}

/** The bound popups, read through accessors so they are never captured stale. */
export const hostPopups: HostPopups = {
  openMediaPopup: (request) => bound.openMediaPopup(request),
  openImageMenu: (request) => bound.openImageMenu(request),
  openFootnotePopup: (request) => bound.openFootnotePopup(request),
  dismissUniversalToolbar: () => bound.dismissUniversalToolbar(),
};
