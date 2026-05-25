/**
 * Popup Store — T09 consolidation.
 *
 * Merges 15 legacy popup/picker/editing stores into a single Zustand
 * store with one namespaced slice per popup. Each slice preserves its
 * original field shape; actions are prefixed with the slice name to
 * disambiguate the many `openPopup` / `closePopup` collisions.
 *
 * Slice mapping (was → is):
 *   - blockMathEditingStore     → state.blockMathEditing
 *   - dropZoneStore             → state.dropZone
 *   - footnotePopupStore        → state.footnotePopup
 *   - geniePickerStore          → state.geniePicker
 *   - headingPickerStore        → state.headingPicker
 *   - imageContextMenuStore     → state.imageContextMenu
 *   - imagePasteToastStore      → state.imagePasteToast
 *   - inlineMathEditingStore    → state.inlineMathEditing
 *   - linkCreatePopupStore      → state.linkCreatePopup
 *   - linkPopupStore            → state.linkPopup
 *   - mathPopupStore            → state.mathPopup
 *   - mediaPopupStore           → state.mediaPopup
 *   - sourceMathPopupStore      → state.sourceMathPopup
 *   - sourcePeekStore           → state.sourcePeek
 *   - wikiLinkPopupStore        → state.wikiLinkPopup
 *
 * Slice TYPE definitions and initial-state objects live in
 * `./popupStore/slices.ts` so this composition root stays close to the
 * project's ~300 LOC guideline. Action implementations remain here so
 * `set` and `get` stay scoped to one factory call.
 *
 * @module stores/popupStore
 */

import { create } from "zustand";
import type { AnchorRect, BoundaryRects } from "@/utils/popupPosition";
import type { HeadingWithId } from "@/utils/headingSlug";
import type { ImageDimensions } from "@/types/image";
import type { ImagePathResult } from "@/utils/imagePathDetection";
import type { GenieScope } from "@/types/aiGenies";
import {
  initialBlockMathEditing,
  initialDropZone,
  initialFootnotePopup,
  initialGeniePicker,
  initialHeadingPicker,
  initialImageContextMenu,
  initialImagePasteToast,
  initialInlineMathEditing,
  initialLinkCreatePopup,
  initialLinkPopup,
  initialMathPopup,
  initialMediaPopup,
  initialSourceMathPopup,
  initialSourcePeek,
  initialWikiLinkPopup,
  type BlockMathEditingSlice,
  type DropZoneSlice,
  type FootnotePopupSlice,
  type GeniePickerSlice,
  type HeadingPickerSlice,
  type ImageContextMenuSlice,
  type ImagePasteToastSlice,
  type InlineMathEditingSlice,
  type InlineMathEditingCallbacks,
  type LinkCreatePopupSlice,
  type LinkPopupSlice,
  type MathPopupSlice,
  type MediaPopupSlice,
  type MediaNodeType,
  type OnHeadingSelectCallback,
  type PickerMode,
  type SourceMathPopupSlice,
  type SourcePeekRange,
  type SourcePeekSlice,
  type WikiLinkPopupSlice,
} from "./popupStore/slices";

// Re-export shared types so consumers can keep importing from
// "@/stores/popupStore" without changes.
export type {
  InlineMathEditingCallbacks,
  MediaNodeType,
  PickerMode,
  SourcePeekRange,
};

interface PopupStoreState {
  blockMathEditing: BlockMathEditingSlice;
  dropZone: DropZoneSlice;
  footnotePopup: FootnotePopupSlice;
  geniePicker: GeniePickerSlice;
  headingPicker: HeadingPickerSlice;
  imageContextMenu: ImageContextMenuSlice;
  imagePasteToast: ImagePasteToastSlice;
  inlineMathEditing: InlineMathEditingSlice;
  linkCreatePopup: LinkCreatePopupSlice;
  linkPopup: LinkPopupSlice;
  mathPopup: MathPopupSlice;
  mediaPopup: MediaPopupSlice;
  sourceMathPopup: SourceMathPopupSlice;
  sourcePeek: SourcePeekSlice;
  wikiLinkPopup: WikiLinkPopupSlice;
}

interface PopupStoreActions {
  /* blockMathEditing */
  blockMathStartEditing: (pos: number, content: string) => void;
  blockMathExitEditing: () => void;
  blockMathIsEditingAt: (pos: number) => boolean;

  /* dropZone */
  dropZoneSetDragging: (isDragging: boolean, hasImages?: boolean, imageCount?: number) => void;
  dropZoneReset: () => void;

  /* footnotePopup */
  footnoteOpenPopup: (
    label: string,
    content: string,
    anchorRect: AnchorRect,
    definitionPos: number | null,
    referencePos: number | null,
    autoFocus?: boolean,
  ) => void;
  footnoteSetContent: (content: string) => void;
  footnoteClosePopup: () => void;

  /* geniePicker */
  genieOpenPicker: (options?: { filterScope?: GenieScope }) => void;
  genieClosePicker: () => void;
  genieSetMode: (mode: PickerMode) => void;
  genieStartProcessing: (prompt: string) => void;
  genieAppendResponse: (chunk: string) => void;
  genieSetPreview: (fullText: string) => void;
  genieSetPickerError: (message: string) => void;
  genieResetToInput: () => void;

  /* headingPicker */
  headingOpenPicker: (
    headings: HeadingWithId[],
    onSelect: OnHeadingSelectCallback,
    options?: { anchorRect?: AnchorRect; containerBounds?: BoundaryRects },
  ) => void;
  headingClosePicker: () => void;
  headingSelectHeading: (heading: HeadingWithId) => void;

  /* imageContextMenu */
  imageContextOpenMenu: (data: {
    position: { x: number; y: number };
    imageSrc: string;
    imageNodePos: number;
  }) => void;
  imageContextCloseMenu: () => void;

  /* imagePasteToast */
  imagePasteShowToast: (data: {
    imagePath: string;
    imageType: "url" | "localPath";
    anchorRect: AnchorRect;
    editorDom: HTMLElement;
    onConfirm: () => void;
    onDismiss: () => void;
  }) => void;
  imagePasteShowMultiToast: (data: {
    imageResults: ImagePathResult[];
    anchorRect: AnchorRect;
    editorDom: HTMLElement;
    onConfirm: () => void;
    onDismiss: () => void;
  }) => void;
  imagePasteHideToast: () => void;
  imagePasteConfirm: () => void;
  imagePasteDismiss: () => void;

  /* inlineMathEditing */
  inlineMathStartEditing: (pos: number, callbacks: InlineMathEditingCallbacks) => void;
  inlineMathStopEditing: (pos: number) => void;
  inlineMathIsEditingAt: (pos: number) => boolean;
  inlineMathClear: (pos: number) => void;

  /* linkCreatePopup */
  linkCreateOpenPopup: (data: {
    text: string;
    rangeFrom: number;
    rangeTo: number;
    anchorRect: AnchorRect;
    showTextInput: boolean;
  }) => void;
  linkCreateClosePopup: () => void;
  linkCreateSetText: (text: string) => void;
  linkCreateSetUrl: (url: string) => void;

  /* linkPopup */
  linkOpenPopup: (data: {
    href: string;
    linkFrom: number;
    linkTo: number;
    anchorRect: AnchorRect;
  }) => void;
  linkClosePopup: () => void;
  linkSetHref: (href: string) => void;

  /* mathPopup */
  mathOpenPopup: (rect: AnchorRect, latex: string, pos: number) => void;
  mathClosePopup: () => void;
  mathUpdateLatex: (latex: string) => void;

  /* mediaPopup */
  mediaOpenPopup: (data: {
    mediaSrc: string;
    mediaNodePos: number;
    mediaNodeType: MediaNodeType;
    anchorRect: AnchorRect;
    mediaAlt?: string;
    mediaTitle?: string;
    mediaDimensions?: ImageDimensions | null;
    mediaPoster?: string;
  }) => void;
  mediaClosePopup: () => void;
  mediaSetSrc: (src: string) => void;
  mediaSetAlt: (alt: string) => void;
  mediaSetTitle: (title: string) => void;
  mediaSetNodeType: (type: MediaNodeType) => void;
  mediaSetDimensions: (dims: ImageDimensions | null) => void;
  mediaSetPoster: (poster: string) => void;

  /* sourceMathPopup */
  sourceMathOpenPopup: (
    rect: AnchorRect,
    latex: string,
    mathFrom: number,
    mathTo: number,
    isBlock: boolean,
  ) => void;
  sourceMathClosePopup: () => void;
  sourceMathUpdateLatex: (latex: string) => void;

  /* sourcePeek */
  sourcePeekOpen: (payload: {
    markdown: string;
    range: SourcePeekRange;
    blockTypeName?: string;
  }) => void;
  sourcePeekClose: () => void;
  sourcePeekSetMarkdown: (markdown: string) => void;
  sourcePeekSetParseError: (error: string | null) => void;
  sourcePeekToggleLivePreview: () => void;
  sourcePeekMarkSaved: () => void;
  sourcePeekGetOriginalMarkdown: () => string | null;

  /* wikiLinkPopup */
  wikiLinkOpenPopup: (rect: AnchorRect, target: string, pos: number) => void;
  wikiLinkClosePopup: () => void;
  wikiLinkUpdateTarget: (target: string) => void;
}

export type PopupStore = PopupStoreState & PopupStoreActions;

export const usePopupStore = create<PopupStore>((set, get) => ({
  blockMathEditing: initialBlockMathEditing,
  dropZone: initialDropZone,
  footnotePopup: initialFootnotePopup,
  geniePicker: initialGeniePicker,
  headingPicker: initialHeadingPicker,
  imageContextMenu: initialImageContextMenu,
  imagePasteToast: initialImagePasteToast,
  inlineMathEditing: initialInlineMathEditing,
  linkCreatePopup: initialLinkCreatePopup,
  linkPopup: initialLinkPopup,
  mathPopup: initialMathPopup,
  mediaPopup: initialMediaPopup,
  sourceMathPopup: initialSourceMathPopup,
  sourcePeek: initialSourcePeek,
  wikiLinkPopup: initialWikiLinkPopup,

  /* blockMathEditing */
  blockMathStartEditing: (pos, content) =>
    set({ blockMathEditing: { editingPos: pos, originalContent: content } }),
  blockMathExitEditing: () => set({ blockMathEditing: initialBlockMathEditing }),
  blockMathIsEditingAt: (pos) => get().blockMathEditing.editingPos === pos,

  /* dropZone */
  dropZoneSetDragging: (isDragging, hasImages = false, imageCount = 0) =>
    set({ dropZone: { isDragging, hasImages, imageCount } }),
  dropZoneReset: () => set({ dropZone: initialDropZone }),

  /* footnotePopup */
  footnoteOpenPopup: (label, content, anchorRect, definitionPos, referencePos, autoFocus = false) =>
    set({
      footnotePopup: {
        isOpen: true,
        label,
        content,
        anchorRect,
        definitionPos,
        referencePos,
        autoFocus,
      },
    }),
  footnoteSetContent: (content) =>
    set((s) => ({ footnotePopup: { ...s.footnotePopup, content } })),
  footnoteClosePopup: () => set({ footnotePopup: initialFootnotePopup }),

  /* geniePicker */
  genieOpenPicker: (options) =>
    set({
      geniePicker: {
        ...initialGeniePicker,
        isOpen: true,
        filterScope: options?.filterScope ?? null,
      },
    }),
  genieClosePicker: () => set({ geniePicker: initialGeniePicker }),
  genieSetMode: (mode) =>
    set((s) => ({ geniePicker: { ...s.geniePicker, mode } })),
  genieStartProcessing: (prompt) =>
    set((s) => ({
      geniePicker: {
        ...s.geniePicker,
        mode: "processing",
        submittedPrompt: prompt,
        responseText: "",
        pickerError: null,
      },
    })),
  genieAppendResponse: (chunk) =>
    set((s) => ({
      geniePicker: {
        ...s.geniePicker,
        responseText: s.geniePicker.responseText + chunk,
      },
    })),
  genieSetPreview: (fullText) =>
    set((s) => ({
      geniePicker: { ...s.geniePicker, mode: "preview", responseText: fullText },
    })),
  genieSetPickerError: (message) =>
    set((s) => ({
      geniePicker: { ...s.geniePicker, mode: "error", pickerError: message },
    })),
  genieResetToInput: () =>
    set((s) => ({
      geniePicker: {
        ...s.geniePicker,
        mode: "search",
        submittedPrompt: null,
        responseText: "",
        pickerError: null,
      },
    })),

  /* headingPicker */
  headingOpenPicker: (headings, onSelect, options) =>
    set({
      headingPicker: {
        isOpen: true,
        headings,
        anchorRect: options?.anchorRect ?? null,
        containerBounds: options?.containerBounds ?? null,
        onSelect,
      },
    }),
  headingClosePicker: () => set({ headingPicker: initialHeadingPicker }),
  headingSelectHeading: (heading) => {
    const { onSelect } = get().headingPicker;
    set({ headingPicker: initialHeadingPicker });
    if (onSelect) onSelect(heading.id, heading.text);
  },

  /* imageContextMenu */
  imageContextOpenMenu: (data) =>
    set({
      imageContextMenu: {
        isOpen: true,
        position: data.position,
        imageSrc: data.imageSrc,
        imageNodePos: data.imageNodePos,
      },
    }),
  imageContextCloseMenu: () => set({ imageContextMenu: initialImageContextMenu }),

  /* imagePasteToast */
  imagePasteShowToast: (data) =>
    set({
      imagePasteToast: {
        isOpen: true,
        imagePath: data.imagePath,
        imageType: data.imageType,
        imagePaths: [],
        imageResults: [],
        isMultiple: false,
        imageCount: 1,
        anchorRect: data.anchorRect,
        editorDom: data.editorDom,
        onConfirm: data.onConfirm,
        onDismiss: data.onDismiss,
      },
    }),
  imagePasteShowMultiToast: (data) =>
    set({
      imagePasteToast: {
        isOpen: true,
        imagePath: "",
        imageType: "localPath",
        imagePaths: data.imageResults.map((r) => r.path),
        imageResults: data.imageResults,
        isMultiple: true,
        imageCount: data.imageResults.length,
        anchorRect: data.anchorRect,
        editorDom: data.editorDom,
        onConfirm: data.onConfirm,
        onDismiss: data.onDismiss,
      },
    }),
  imagePasteHideToast: () => set({ imagePasteToast: initialImagePasteToast }),
  imagePasteConfirm: () => {
    const { onConfirm } = get().imagePasteToast;
    if (onConfirm) onConfirm();
    set({ imagePasteToast: initialImagePasteToast });
  },
  imagePasteDismiss: () => {
    const { onDismiss } = get().imagePasteToast;
    if (onDismiss) onDismiss();
    set({ imagePasteToast: initialImagePasteToast });
  },

  /* inlineMathEditing */
  inlineMathStartEditing: (pos, callbacks) => {
    const { editingNodePos, activeCallbacks } = get().inlineMathEditing;
    if (editingNodePos !== null && editingNodePos !== pos && activeCallbacks) {
      activeCallbacks.forceExit();
    }
    set({
      inlineMathEditing: { editingNodePos: pos, activeCallbacks: callbacks },
    });
  },
  inlineMathStopEditing: (pos) => {
    if (get().inlineMathEditing.editingNodePos === pos) {
      set({ inlineMathEditing: initialInlineMathEditing });
    }
  },
  inlineMathIsEditingAt: (pos) => get().inlineMathEditing.editingNodePos === pos,
  inlineMathClear: (pos) => {
    if (get().inlineMathEditing.editingNodePos === pos) {
      set({ inlineMathEditing: initialInlineMathEditing });
    }
  },

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
        parseError: null,
        hasUnsavedChanges: false,
        blockTypeName: blockTypeName ?? null,
      },
    }),
  sourcePeekClose: () => set({ sourcePeek: { ...initialSourcePeek } }),
  sourcePeekSetMarkdown: (markdown) => {
    const { originalMarkdown } = get().sourcePeek;
    set((s) => ({
      sourcePeek: {
        ...s.sourcePeek,
        markdown,
        hasUnsavedChanges: markdown !== originalMarkdown,
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
    set((s) => ({ sourcePeek: { ...s.sourcePeek, hasUnsavedChanges: false } })),
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
}));
