/**
 * Purpose: the image-paste toast's state PORT.
 *
 * Declared by the plugin rather than imported from the app's store, so the
 * toast can be lifted out of this repo; the host supplies something that
 * satisfies it (ADR-015). Its own module because the view and the entry point
 * both need it, and because `ImagePasteToastView.ts` sits at its size cap.
 *
 * @coordinates-with plugins/imagePasteToast/ImagePasteToastView.ts
 * @module plugins/imagePasteToast/types
 */

/**
 * The toast state this view needs — the plugin's PORT (ADR-015).
 *
 * Declared here rather than imported from the app's store, so the plugin can
 * be lifted out of this repo. The host supplies something satisfying it.
 */
interface ImagePasteToastState {
  isOpen: boolean;
  anchorRect: { top: number; left: number; right: number; bottom: number } | null;
  editorDom: HTMLElement | null;
  imageCount: number;
  imagePath: string;
  /** Narrowed, not `string`: the view branches on it. */
  imageType: "url" | "localPath";
  isMultiple: boolean;
  hideToast: () => void;
  confirm: () => void;
  dismiss: () => void;
}

/** A store-like handle over that state. */
export interface ImagePasteToastStore {
  getState: () => ImagePasteToastState;
  subscribe: (listener: (state: ImagePasteToastState) => void) => () => void;
}
