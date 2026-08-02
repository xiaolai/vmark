/**
 * Purpose: the wiki-link popup's state PORT.
 *
 * Its own module, like the other popup ports, so the plugin declares the
 * shape it needs and the host passes a store satisfying it (ADR-015) —
 * and so `WikiLinkPopupView.ts` stays under its size limit.
 *
 * @coordinates-with plugins/wikiLinkPopup/WikiLinkPopupView.ts — the consumer
 * @coordinates-with stores/wikiLinkPopupStore.ts — the app's implementation
 * @module plugins/wikiLinkPopup/types
 */

import type { PopupStoreBase } from "@/plugins/shared";

/**
 * Wiki link popup state — the plugin's PORT, not the app's store.
 *
 * Declared here so the plugin can ship standalone; the host passes a store
 * satisfying it (ADR-015).
 */
export interface WikiLinkPopupState extends PopupStoreBase {
  target: string;
  nodePos: number | null;
  updateTarget: (target: string) => void;
  openPopup: (
    rect: NonNullable<PopupStoreBase["anchorRect"]>,
    target: string,
    pos: number
  ) => void;
}
