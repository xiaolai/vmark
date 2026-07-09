/**
 * Popup-store shared types — combined store shape, action-group
 * interfaces, and action-creator helpers.
 *
 * Purpose: composes the 16 slice shapes from `./slices` with the three
 * action-group interfaces (declared here) into the `PopupStore` type,
 * and defines the `PopupSet`/`PopupGet` aliases the action-creator files
 * use so every action closes over the same store factory `set`/`get`.
 *
 * Action interfaces live here — not in the action files — so the
 * dependency flow is one-directional (action files import from types.ts;
 * types.ts imports only from the leaf `./slices` module — keeps the
 * depcruise no-circular rule green).
 *
 * @module stores/popupStore/types
 */

import type { StoreApi } from "zustand";
import type { AnchorRect, BoundaryRects } from "@/utils/popupPosition";
import type { HeadingWithId } from "@/utils/headingSlug";
import type { ImageDimensions } from "@/types/image";
import type { ImagePathResult } from "@/utils/imagePathDetection";
import type { GenieScope } from "@/types/aiGenies";
import type { EditorContextMenuSnapshot } from "@/types/editorContextMenu";
import type {
  BlockMathEditingSlice,
  DropZoneSlice,
  EditorContextMenuSlice,
  FootnotePopupSlice,
  GeniePickerSlice,
  HeadingPickerSlice,
  ImageContextMenuSlice,
  ImagePasteToastSlice,
  InlineMathEditingSlice,
  InlineMathEditingCallbacks,
  LinkCreatePopupSlice,
  LinkPopupSlice,
  MathPopupSlice,
  MediaPopupSlice,
  MediaNodeType,
  OnHeadingSelectCallback,
  PickerMode,
  SourceMathPopupSlice,
  SourcePeekRange,
  SourcePeekSlice,
  WikiLinkPopupSlice,
} from "./slices";

interface PopupStoreState {
  blockMathEditing: BlockMathEditingSlice;
  dropZone: DropZoneSlice;
  editorContextMenu: EditorContextMenuSlice;
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

/** Actions implemented in `./editingActions.ts`. */
export interface EditingPopupActions {
  /* blockMathEditing */
  blockMathStartEditing: (pos: number, content: string) => void;
  blockMathExitEditing: () => void;
  blockMathIsEditingAt: (pos: number) => boolean;

  /* dropZone */
  dropZoneSetDragging: (isDragging: boolean, hasImages?: boolean, imageCount?: number) => void;
  dropZoneReset: () => void;

  /* editorContextMenu */
  editorContextOpenMenu: (data: {
    position: { x: number; y: number };
    snapshot: EditorContextMenuSnapshot;
  }) => void;
  editorContextCloseMenu: () => void;

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
}

/** Actions implemented in `./pickerActions.ts`. */
export interface PickerPopupActions {
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
}

/** Actions implemented in `./linkMediaActions.ts`. */
export interface LinkMediaPopupActions {
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

export type PopupStore = PopupStoreState &
  EditingPopupActions &
  PickerPopupActions &
  LinkMediaPopupActions;

/** The store factory's `set`, passed into action-group creators. */
export type PopupSet = StoreApi<PopupStore>["setState"];
/** The store factory's `get`, passed into action-group creators. */
export type PopupGet = StoreApi<PopupStore>["getState"];
