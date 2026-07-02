/**
 * Popup-store slice definitions — per-popup state shape and initial values.
 *
 * Extracted from `../popupStore.ts` so every popup-store file stays
 * under the project's ~300 LOC guideline. This module is the leaf of the
 * popup-store import graph. Action interfaces and the combined store
 * type live in types.ts; action implementations live in the sibling
 * action-group files (editingActions.ts, pickerActions.ts,
 * linkMediaActions.ts); the composition root stays in `popupStore.ts`.
 *
 * @module stores/popupStore/slices
 */

import type { AnchorRect, BoundaryRects } from "@/utils/popupPosition";
import type { HeadingWithId } from "@/utils/headingSlug";
import type { ImageDimensions } from "@/types/image";
import type { ImagePathResult } from "@/utils/imagePathDetection";
import type { GenieScope } from "@/types/aiGenies";

/* ─────────────────────── shared/exported types ───────────────────────── */

export type MediaNodeType = "image" | "block_image" | "block_video" | "block_audio";

export type PickerMode = "search" | "freeform" | "processing" | "preview" | "error";

export interface InlineMathEditingCallbacks {
  forceExit: () => void;
  getNodePos: () => number | undefined;
}

export interface SourcePeekRange {
  from: number;
  to: number;
}

/* ───────────────────────────── slices ────────────────────────────────── */

export interface BlockMathEditingSlice {
  editingPos: number | null;
  originalContent: string | null;
}
export const initialBlockMathEditing: BlockMathEditingSlice = {
  editingPos: null,
  originalContent: null,
};

export interface DropZoneSlice {
  isDragging: boolean;
  hasImages: boolean;
  imageCount: number;
}
export const initialDropZone: DropZoneSlice = {
  isDragging: false,
  hasImages: false,
  imageCount: 0,
};

export interface FootnotePopupSlice {
  isOpen: boolean;
  label: string;
  content: string;
  anchorRect: AnchorRect | null;
  definitionPos: number | null;
  referencePos: number | null;
  autoFocus: boolean;
}
export const initialFootnotePopup: FootnotePopupSlice = {
  isOpen: false,
  label: "",
  content: "",
  anchorRect: null,
  definitionPos: null,
  referencePos: null,
  autoFocus: false,
};

export interface GeniePickerSlice {
  isOpen: boolean;
  filterScope: GenieScope | null;
  mode: PickerMode;
  submittedPrompt: string | null;
  responseText: string;
  pickerError: string | null;
}
export const initialGeniePicker: GeniePickerSlice = {
  isOpen: false,
  filterScope: null,
  mode: "search",
  submittedPrompt: null,
  responseText: "",
  pickerError: null,
};

export type OnHeadingSelectCallback = (id: string, text: string) => void;
export interface HeadingPickerSlice {
  isOpen: boolean;
  headings: HeadingWithId[];
  anchorRect: AnchorRect | null;
  containerBounds: BoundaryRects | null;
  onSelect: OnHeadingSelectCallback | null;
}
export const initialHeadingPicker: HeadingPickerSlice = {
  isOpen: false,
  headings: [],
  anchorRect: null,
  containerBounds: null,
  onSelect: null,
};

export interface ImageContextMenuSlice {
  isOpen: boolean;
  position: { x: number; y: number } | null;
  imageSrc: string;
  imageNodePos: number;
}
export const initialImageContextMenu: ImageContextMenuSlice = {
  isOpen: false,
  position: null,
  imageSrc: "",
  imageNodePos: -1,
};

export interface ImagePasteToastSlice {
  isOpen: boolean;
  imagePath: string;
  imageType: "url" | "localPath";
  imagePaths: string[];
  imageResults: ImagePathResult[];
  isMultiple: boolean;
  imageCount: number;
  anchorRect: AnchorRect | null;
  editorDom: HTMLElement | null;
  onConfirm: (() => void) | null;
  onDismiss: (() => void) | null;
}
export const initialImagePasteToast: ImagePasteToastSlice = {
  isOpen: false,
  imagePath: "",
  imageType: "url",
  imagePaths: [],
  imageResults: [],
  isMultiple: false,
  imageCount: 0,
  anchorRect: null,
  editorDom: null,
  onConfirm: null,
  onDismiss: null,
};

export interface InlineMathEditingSlice {
  editingNodePos: number | null;
  activeCallbacks: InlineMathEditingCallbacks | null;
}
export const initialInlineMathEditing: InlineMathEditingSlice = {
  editingNodePos: null,
  activeCallbacks: null,
};

export interface LinkCreatePopupSlice {
  isOpen: boolean;
  text: string;
  url: string;
  rangeFrom: number;
  rangeTo: number;
  anchorRect: AnchorRect | null;
  showTextInput: boolean;
}
export const initialLinkCreatePopup: LinkCreatePopupSlice = {
  isOpen: false,
  text: "",
  url: "",
  rangeFrom: 0,
  rangeTo: 0,
  anchorRect: null,
  showTextInput: true,
};

export interface LinkPopupSlice {
  isOpen: boolean;
  href: string;
  linkFrom: number;
  linkTo: number;
  anchorRect: AnchorRect | null;
}
export const initialLinkPopup: LinkPopupSlice = {
  isOpen: false,
  href: "",
  linkFrom: 0,
  linkTo: 0,
  anchorRect: null,
};

export interface MathPopupSlice {
  isOpen: boolean;
  anchorRect: AnchorRect | null;
  latex: string;
  nodePos: number | null;
}
export const initialMathPopup: MathPopupSlice = {
  isOpen: false,
  anchorRect: null,
  latex: "",
  nodePos: null,
};

export interface MediaPopupSlice {
  isOpen: boolean;
  mediaSrc: string;
  mediaAlt: string;
  mediaTitle: string;
  mediaNodePos: number;
  mediaNodeType: MediaNodeType;
  mediaDimensions: ImageDimensions | null;
  mediaPoster: string;
  anchorRect: AnchorRect | null;
}
export const initialMediaPopup: MediaPopupSlice = {
  isOpen: false,
  mediaSrc: "",
  mediaAlt: "",
  mediaTitle: "",
  mediaNodePos: -1,
  mediaNodeType: "block_video",
  mediaDimensions: null,
  mediaPoster: "",
  anchorRect: null,
};

export interface SourceMathPopupSlice {
  isOpen: boolean;
  anchorRect: AnchorRect | null;
  latex: string;
  originalLatex: string;
  mathFrom: number;
  mathTo: number;
  isBlock: boolean;
}
export const initialSourceMathPopup: SourceMathPopupSlice = {
  isOpen: false,
  anchorRect: null,
  latex: "",
  originalLatex: "",
  mathFrom: 0,
  mathTo: 0,
  isBlock: false,
};

export interface SourcePeekSlice {
  isOpen: boolean;
  editingPos: number | null;
  range: SourcePeekRange | null;
  markdown: string;
  /** The true original content captured at open — the revert target. */
  originalMarkdown: string | null;
  /**
   * The last-saved content — the dirty-check baseline. Distinct from
   * `originalMarkdown` so `markSaved` can rebaseline the unsaved-changes
   * comparison without moving the revert target.
   */
  savedMarkdown: string | null;
  livePreview: boolean;
  parseError: string | null;
  hasUnsavedChanges: boolean;
  blockTypeName: string | null;
}
export const initialSourcePeek: SourcePeekSlice = {
  isOpen: false,
  editingPos: null,
  range: null,
  markdown: "",
  originalMarkdown: null,
  savedMarkdown: null,
  livePreview: false,
  parseError: null,
  hasUnsavedChanges: false,
  blockTypeName: null,
};

export interface WikiLinkPopupSlice {
  isOpen: boolean;
  anchorRect: AnchorRect | null;
  target: string;
  nodePos: number | null;
}
export const initialWikiLinkPopup: WikiLinkPopupSlice = {
  isOpen: false,
  anchorRect: null,
  target: "",
  nodePos: null,
};
