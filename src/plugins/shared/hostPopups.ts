/**
 * Purpose: the editor CHROME a plugin asks the host to show — or dismiss.
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

import type { MediaNodeType } from "./popupPorts";
import type { HeadingWithId } from "@/utils/headingSlug";
import type { BoundaryRects } from "@/utils/popupPosition";
import type { ImagePathResult } from "@/utils/imagePathDetection";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";

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
  mediaNodeType: MediaNodeType;
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

/** What the link EDIT popup needs. */
interface LinkPopupRequest {
  href: string;
  linkFrom: number;
  linkTo: number;
  anchorRect: { top: number; left: number; right: number; bottom: number };
}

/** What the link CREATE popup needs. */
interface LinkCreateRequest {
  text: string;
  rangeFrom: number;
  rangeTo: number;
  anchorRect: { top: number; left: number; right: number; bottom: number };
  showTextInput: boolean;
}

/** What the wiki-link popup needs. */
interface WikiLinkPopupRequest {
  anchorRect: { top: number; left: number; right: number; bottom: number };
  target: string;
  nodePos: number;
}

/** What the heading picker needs. */
interface HeadingPickerRequest {
  headings: HeadingWithId[];
  onSelect: (id: string, text: string) => void;
  anchorRect?: { top: number; left: number; right: number; bottom: number };
  containerBounds?: BoundaryRects;
}

/** Shared by both toast shapes. */
interface ImagePasteToastBase {
  anchorRect: { top: number; left: number; right: number; bottom: number };
  editorDom: HTMLElement;
  onConfirm: () => void;
  onDismiss?: () => void;
}

/** One pasted image: the path and how to read it are both required. */
interface SingleImagePasteToast extends ImagePasteToastBase {
  imagePath: string;
  imageType: "url" | "localPath";
  imageResults?: never;
}

/** A batch: the results are required, and the single-image fields are not. */
interface MultiImagePasteToast extends ImagePasteToastBase {
  imageResults: ImagePathResult[];
  imagePath?: never;
  imageType?: never;
}

type ImagePasteToastRequest = SingleImagePasteToast | MultiImagePasteToast;

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
  openLinkPopup: (request: LinkPopupRequest) => void;
  openLinkCreatePopup: (request: LinkCreateRequest) => void;
  openWikiLinkPopup: (request: WikiLinkPopupRequest) => void;
  openHeadingPicker: (request: HeadingPickerRequest) => void;
  /**
   * Whether any link-editing surface is already open.
   *
   * A QUERY, unlike the rest, and it exists because the smart-link shortcut
   * must not stack a second popup on top of one the user is already using.
   * Asking the host "is anything open?" keeps the plugin from having to know
   * which four surfaces those are.
   */
  anyLinkSurfaceOpen: () => boolean;
  /**
   * Open the editor's right-click menu.
   *
   * `snapshot` is typed from `@/types/editorContextMenu` — a types module, not
   * a sibling plugin — so the boundary is compiler-checked without dragging
   * plugin-land into this one.
   */
  openEditorContextMenu: (request: {
    position: { x: number; y: number };
    snapshot: EditorContextMenuSnapshot;
  }) => void;
  /**
   * Offer the user a pasted image, singly or in a batch.
   *
   * One member rather than two, because the two toasts differ only in how
   * many images they describe — but a DISCRIMINATED UNION rather than one
   * shape with optional fields. Optionals let a caller omit `imagePath` on a
   * single-image toast, which the host store requires; the compiler caught
   * exactly that when the binding's cast was removed.
   */
  showImagePasteToast: (request: ImagePasteToastRequest) => void;
}

/** No chrome — a standalone plugin still renders, it just cannot offer edits. */
const DEFAULTS: HostPopups = {
  openMediaPopup: () => {},
  openImageMenu: () => {},
  openFootnotePopup: () => {},
  // No toolbar to close, so Escape was NOT consumed — falling through is the
  // correct standalone behaviour, and `true` here would swallow the key.
  dismissUniversalToolbar: () => false,
  openLinkPopup: () => {},
  openLinkCreatePopup: () => {},
  openWikiLinkPopup: () => {},
  openHeadingPicker: () => {},
  // Nothing is open when there is no chrome, so the shortcut proceeds.
  anyLinkSurfaceOpen: () => false,
  openEditorContextMenu: () => {},
  showImagePasteToast: () => {},
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
  openLinkPopup: (request) => bound.openLinkPopup(request),
  openLinkCreatePopup: (request) => bound.openLinkCreatePopup(request),
  openWikiLinkPopup: (request) => bound.openWikiLinkPopup(request),
  openHeadingPicker: (request) => bound.openHeadingPicker(request),
  anyLinkSurfaceOpen: () => bound.anyLinkSurfaceOpen(),
  openEditorContextMenu: (request) => bound.openEditorContextMenu(request),
  showImagePasteToast: (request) => bound.showImagePasteToast(request),
};
