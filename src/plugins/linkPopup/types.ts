/**
 * Purpose: the link popup's state PORTs.
 *
 * Two of them, because the plugin drives two surfaces: the EDIT popup it
 * owns, and the CREATE popup it only has to dismiss when the user clicks
 * away. The second is deliberately just `PopupStoreBase` — "is it open, and
 * close it" is the whole of what this plugin needs to know about a popup it
 * does not own, and asking for more would couple them (ADR-015).
 *
 * @coordinates-with plugins/linkPopup/LinkPopupView.ts — the edit popup
 * @coordinates-with plugins/linkPopup/tiptap.ts — the click handler
 * @module plugins/linkPopup/types
 */

import type { PopupStoreBase } from "@/plugins/shared";

type AnchorRect = NonNullable<PopupStoreBase["anchorRect"]>;

/** The edit popup's state. */
export interface LinkPopupState extends PopupStoreBase {
  href: string;
  linkFrom: number;
  linkTo: number;
  setHref: (href: string) => void;
  openPopup: (args: {
    href: string;
    linkFrom: number;
    linkTo: number;
    anchorRect: AnchorRect;
  }) => void;
}
