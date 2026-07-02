/**
 * Popup-store link/media/math action group — linkCreatePopup, linkPopup,
 * mathPopup, mediaPopup, sourceMathPopup, sourcePeek, and wikiLinkPopup.
 *
 * Purpose: action implementations for the link, media, math, and
 * source-peek slices of the popup store. Extracted verbatim from
 * `../popupStore.ts` (pure code motion; behavior unchanged). The
 * `LinkMediaPopupActions` interface lives in `./types.ts`
 * (one-directional imports — no cycles). The composition root spreads
 * `createLinkMediaPopupActions(set, get)` into the store factory.
 *
 * @module stores/popupStore/linkMediaActions
 */

import {
  initialLinkCreatePopup,
  initialLinkPopup,
  initialMathPopup,
  initialMediaPopup,
  initialSourceMathPopup,
  initialSourcePeek,
  initialWikiLinkPopup,
} from "./slices";
import type { LinkMediaPopupActions, PopupGet, PopupSet } from "./types";

export function createLinkMediaPopupActions(
  set: PopupSet,
  get: PopupGet,
): LinkMediaPopupActions {
  return {
    /* linkCreatePopup */
    linkCreateOpenPopup: (data) =>
      set({
        linkCreatePopup: {
          isOpen: true,
          text: data.text,
          url: "",
          rangeFrom: data.rangeFrom,
          rangeTo: data.rangeTo,
          anchorRect: data.anchorRect,
          showTextInput: data.showTextInput,
        },
      }),
    linkCreateClosePopup: () => set({ linkCreatePopup: initialLinkCreatePopup }),
    linkCreateSetText: (text) =>
      set((s) => ({ linkCreatePopup: { ...s.linkCreatePopup, text } })),
    linkCreateSetUrl: (url) =>
      set((s) => ({ linkCreatePopup: { ...s.linkCreatePopup, url } })),

    /* linkPopup */
    linkOpenPopup: (data) =>
      set({
        linkPopup: {
          isOpen: true,
          href: data.href,
          linkFrom: data.linkFrom,
          linkTo: data.linkTo,
          anchorRect: data.anchorRect,
        },
      }),
    linkClosePopup: () => set({ linkPopup: initialLinkPopup }),
    linkSetHref: (href) => set((s) => ({ linkPopup: { ...s.linkPopup, href } })),

    /* mathPopup */
    mathOpenPopup: (rect, latex, pos) =>
      set({
        mathPopup: { isOpen: true, anchorRect: rect, latex, nodePos: pos },
      }),
    mathClosePopup: () => set({ mathPopup: initialMathPopup }),
    mathUpdateLatex: (latex) =>
      set((s) => ({ mathPopup: { ...s.mathPopup, latex } })),

    /* mediaPopup */
    mediaOpenPopup: (data) =>
      set({
        mediaPopup: {
          isOpen: true,
          mediaSrc: data.mediaSrc,
          mediaAlt: data.mediaAlt ?? "",
          mediaTitle: data.mediaTitle ?? "",
          mediaNodePos: data.mediaNodePos,
          mediaNodeType: data.mediaNodeType,
          mediaDimensions: data.mediaDimensions ?? null,
          mediaPoster: data.mediaPoster ?? "",
          anchorRect: data.anchorRect,
        },
      }),
    mediaClosePopup: () => set({ mediaPopup: initialMediaPopup }),
    mediaSetSrc: (src) =>
      set((s) => ({ mediaPopup: { ...s.mediaPopup, mediaSrc: src } })),
    mediaSetAlt: (alt) =>
      set((s) => ({ mediaPopup: { ...s.mediaPopup, mediaAlt: alt } })),
    mediaSetTitle: (title) =>
      set((s) => ({ mediaPopup: { ...s.mediaPopup, mediaTitle: title } })),
    mediaSetNodeType: (type) =>
      set((s) => ({ mediaPopup: { ...s.mediaPopup, mediaNodeType: type } })),
    mediaSetDimensions: (dims) =>
      set((s) => ({ mediaPopup: { ...s.mediaPopup, mediaDimensions: dims } })),
    mediaSetPoster: (poster) =>
      set((s) => ({ mediaPopup: { ...s.mediaPopup, mediaPoster: poster } })),

    /* sourceMathPopup */
    sourceMathOpenPopup: (rect, latex, mathFrom, mathTo, isBlock) =>
      set({
        sourceMathPopup: {
          isOpen: true,
          anchorRect: rect,
          latex,
          originalLatex: latex,
          mathFrom,
          mathTo,
          isBlock,
        },
      }),
    sourceMathClosePopup: () => set({ sourceMathPopup: initialSourceMathPopup }),
    sourceMathUpdateLatex: (latex) =>
      set((s) => ({ sourceMathPopup: { ...s.sourceMathPopup, latex } })),

    /* sourcePeek */
    sourcePeekOpen: ({ markdown, range, blockTypeName }) =>
      set({
        sourcePeek: {
          ...initialSourcePeek,
          isOpen: true,
          editingPos: range.from,
          range,
          markdown,
          originalMarkdown: markdown,
          savedMarkdown: markdown,
          parseError: null,
          hasUnsavedChanges: false,
          blockTypeName: blockTypeName ?? null,
        },
      }),
    sourcePeekClose: () => set({ sourcePeek: { ...initialSourcePeek } }),
    sourcePeekSetMarkdown: (markdown) => {
      const { savedMarkdown } = get().sourcePeek;
      set((s) => ({
        sourcePeek: {
          ...s.sourcePeek,
          markdown,
          hasUnsavedChanges: markdown !== savedMarkdown,
          parseError: null,
        },
      }));
    },
    sourcePeekSetParseError: (error) =>
      set((s) => ({ sourcePeek: { ...s.sourcePeek, parseError: error } })),
    sourcePeekToggleLivePreview: () =>
      set((s) => ({
        sourcePeek: { ...s.sourcePeek, livePreview: !s.sourcePeek.livePreview },
      })),
    sourcePeekMarkSaved: () =>
      set((s) => ({
        sourcePeek: {
          ...s.sourcePeek,
          // Rebaseline the dirty check to the just-saved content; the revert
          // target (`originalMarkdown`) is intentionally left untouched.
          savedMarkdown: s.sourcePeek.markdown,
          hasUnsavedChanges: false,
        },
      })),
    sourcePeekGetOriginalMarkdown: () => get().sourcePeek.originalMarkdown,

    /* wikiLinkPopup */
    wikiLinkOpenPopup: (rect, target, pos) =>
      set({
        wikiLinkPopup: {
          isOpen: true,
          anchorRect: rect,
          target,
          nodePos: pos,
        },
      }),
    wikiLinkClosePopup: () => set({ wikiLinkPopup: initialWikiLinkPopup }),
    wikiLinkUpdateTarget: (target) =>
      set((s) => ({ wikiLinkPopup: { ...s.wikiLinkPopup, target } })),
  };
}
