/**
 * Purpose: the state PORTs for popups that exist on BOTH editing surfaces.
 *
 * A link, a footnote, an image: each is edited by a WYSIWYG popup and by a
 * Source-mode twin, and both drive the same host state. The declared shape
 * therefore belongs to neither plugin — it is the contract between the two
 * of them and the host (ADR-015).
 *
 * Here rather than in `linkPopup/types.ts` for a concrete reason: importing
 * a sibling plugin's module is what `plugin-isolation` forbids, and the
 * existing per-plugin exemptions for `sourceLinkPopup` and
 * `sourceImagePopup` exist only because their ports had nowhere neutral to
 * live. `plugins/shared/` is that neutral place, so a new source-twin does
 * not need a new exemption.
 *
 * @coordinates-with plugins/linkPopup, plugins/sourceLinkPopup
 * @coordinates-with plugins/footnotePopup, plugins/sourceFootnotePopup
 * @coordinates-with plugins/wikiLinkPopup, plugins/sourceWikiLinkPopup
 * @coordinates-with plugins/mediaPopup, plugins/sourceImagePopup
 * @module plugins/shared/popupPorts
 */

import type { PopupStoreBase } from "./types";
import type { ImageDimensions } from "@/types/image";

/** Anchoring a popup REQUIRES a rect, though the resting state may have none. */
type Anchor = NonNullable<PopupStoreBase["anchorRect"]>;

/** The link popup's state, driven from both surfaces. */
export interface LinkPopupState extends PopupStoreBase {
  href: string;
  linkFrom: number;
  linkTo: number;
  setHref: (href: string) => void;
  /**
   * Remap the tracked range after a doc change while the popup is open
   * (Source-mode remap path — WI-1/D1). Optional: a store without it forces
   * the guard onto its fail-safe close path instead of remapping.
   */
  setLinkRange?: (linkFrom: number, linkTo: number) => void;
  openPopup: (args: {
    href: string;
    linkFrom: number;
    linkTo: number;
    anchorRect: Anchor;
  }) => void;
}

/** The footnote popup's state, driven from both surfaces. */
export interface FootnotePopupState extends PopupStoreBase {
  content: string;
  label: string;
  definitionPos: number | null;
  referencePos: number | null;
  autoFocus: boolean;
  setContent: (content: string) => void;
  /** Opening is part of the port too — the extensions' own handlers open it. */
  openPopup: (
    label: string,
    content: string,
    anchorRect: Anchor,
    definitionPos: number | null,
    referencePos: number | null,
    autoFocus?: boolean,
  ) => void;
}

/** The wiki-link popup's state, driven from both surfaces. */
export interface WikiLinkPopupState extends PopupStoreBase {
  target: string;
  nodePos: number | null;
  updateTarget: (target: string) => void;
  openPopup: (rect: Anchor, target: string, pos: number) => void;
}

/** Which kind of media node the popup is editing. */
export type MediaNodeType = "image" | "block_image" | "block_video" | "block_audio";

/**
 * The media popup's state, driven from both surfaces.
 *
 * One popup for four node types: the WYSIWYG side edits all of them, the
 * Source side only images. The port carries all four because the STATE is
 * shared — narrowing it per surface would need two stores for one popup.
 */
export interface MediaPopupState extends PopupStoreBase {
  mediaSrc: string;
  mediaAlt: string;
  mediaTitle: string;
  mediaNodePos: number;
  mediaNodeType: MediaNodeType;
  mediaDimensions: ImageDimensions | null;
  mediaPoster: string;
  setSrc: (src: string) => void;
  setAlt: (alt: string) => void;
  setTitle: (title: string) => void;
  setNodeType: (type: MediaNodeType) => void;
  setDimensions: (dims: ImageDimensions | null) => void;
  setPoster: (poster: string) => void;
  openPopup: (data: {
    mediaSrc: string;
    mediaNodePos: number;
    mediaNodeType: MediaNodeType;
    anchorRect: Anchor;
    mediaAlt?: string;
    mediaTitle?: string;
    mediaDimensions?: ImageDimensions | null;
    mediaPoster?: string;
  }) => void;
}
