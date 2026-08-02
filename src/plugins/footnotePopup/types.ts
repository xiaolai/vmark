/**
 * Purpose: the footnote popup's state PORT.
 *
 * Its own module because BOTH halves of the plugin need it — the view that
 * renders the popup and the extension that opens it — and because a plugin
 * declaring the shape it needs, rather than importing the app's store type,
 * is what lets it ship standalone (ADR-015).
 *
 * @coordinates-with plugins/footnotePopup/FootnotePopupView.ts
 * @coordinates-with plugins/footnotePopup/tiptap.ts
 * @module plugins/footnotePopup/types
 */

import type { PopupStoreBase } from "@/plugins/shared";

/** The footnote popup's state, as the plugin declares it. */
export interface FootnotePopupState extends PopupStoreBase {
  content: string;
  label: string;
  definitionPos: number | null;
  referencePos: number | null;
  autoFocus: boolean;
  setContent: (content: string) => void;
  /** Opening is part of the port too — the extension's own handlers open it. */
  openPopup: (
    label: string,
    content: string,
    // NonNullable: opening REQUIRES an anchor, though the resting state may
    // have none. The compiler caught this at the host boundary.
    anchorRect: NonNullable<PopupStoreBase["anchorRect"]>,
    definitionPos: number | null,
    referencePos: number | null,
    autoFocus?: boolean,
  ) => void;
}
