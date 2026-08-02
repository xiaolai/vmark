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
 * @module plugins/shared/popupPorts
 */

import type { PopupStoreBase } from "./types";

/** Anchoring a popup REQUIRES a rect, though the resting state may have none. */
type Anchor = NonNullable<PopupStoreBase["anchorRect"]>;

/** The link popup's state, driven from both surfaces. */
export interface LinkPopupState extends PopupStoreBase {
  href: string;
  linkFrom: number;
  linkTo: number;
  setHref: (href: string) => void;
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
