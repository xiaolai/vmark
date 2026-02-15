/**
 * Shared Media NodeView Helpers
 *
 * Purpose: Composable helper functions for block media NodeViews (image, audio, video).
 * Handles load/error event management, error display, load state CSS classes,
 * and node selection — the ~80% of logic that's identical across all three media types.
 *
 * Key decisions:
 *   - Composition over inheritance: helper functions with a config object,
 *     not a base class. This keeps each NodeView's unique logic (stopEvent,
 *     handleClick, element creation) simple and local.
 *   - attachMediaLoadHandlers returns a cleanup function for deterministic teardown
 *   - Config-driven class names allow image to use "image-loading"/"image-error"
 *     while audio/video use "media-loading"/"media-error"
 *
 * @coordinates-with plugins/blockImage/BlockImageNodeView.ts
 * @coordinates-with plugins/blockAudio/BlockAudioNodeView.ts
 * @coordinates-with plugins/blockVideo/BlockVideoNodeView.ts
 * @module plugins/shared/mediaNodeViewHelpers
 */

import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";

/**
 * Configuration for media load state management.
 * Different media types use different event names and CSS class prefixes.
 */
export interface MediaLoadConfig {
  /** DOM event to listen for on successful load: "load" for images, "loadedmetadata" for audio/video */
  loadEvent: "load" | "loadedmetadata";
  /** CSS class applied during loading (e.g., "image-loading" or "media-loading") */
  loadingClass: string;
  /** CSS class applied on error (e.g., "image-error" or "media-error") */
  errorClass: string;
}

/**
 * Attach load/error event handlers to a media element.
 *
 * On success: removes loading/error classes and calls onLoaded callback.
 * On error: sets error class on container, then calls optional onError callback
 * for media-type-specific behavior (e.g., image opacity, title management).
 *
 * @returns Cleanup function that removes both event listeners
 */
export function attachMediaLoadHandlers(
  element: HTMLMediaElement | HTMLImageElement,
  container: HTMLElement,
  config: MediaLoadConfig,
  onLoaded: () => void,
  onErrorCb?: () => void,
): () => void {
  const onLoad = () => {
    container.classList.remove(config.loadingClass, config.errorClass);
    onLoaded();
    cleanup();
  };

  const onError = () => {
    container.classList.remove(config.loadingClass);
    container.classList.add(config.errorClass);
    onErrorCb?.();
    cleanup();
  };

  element.addEventListener(config.loadEvent, onLoad);
  element.addEventListener("error", onError);

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    element.removeEventListener(config.loadEvent, onLoad);
    element.removeEventListener("error", onError);
  }

  return cleanup;
}

/**
 * Set error state on a media container: applies error CSS class and sets
 * a tooltip with the error message and original src.
 */
export function showMediaError(
  container: HTMLElement,
  element: HTMLElement,
  originalSrc: string,
  message: string,
  config: MediaLoadConfig,
): void {
  container.classList.remove(config.loadingClass);
  container.classList.add(config.errorClass);
  element.title = `${message}: ${originalSrc}`;
}

/**
 * Clear all loading/error CSS classes from a media container.
 */
export function clearMediaLoadState(
  container: HTMLElement,
  config: MediaLoadConfig,
): void {
  container.classList.remove(config.loadingClass, config.errorClass);
}

/**
 * Create a NodeSelection on the given node position and dispatch it
 * without adding to editor history (cosmetic selection, not undoable).
 */
export function selectMediaNode(
  editor: Editor,
  getPos: () => number | undefined,
): void {
  const pos = getPos();
  if (pos === undefined) return;

  try {
    const { view } = editor;
    const selection = NodeSelection.create(view.state.doc, pos);
    const tr = view.state.tr.setSelection(selection);
    view.dispatch(tr.setMeta("addToHistory", false));
  } catch {
    // Ignore selection errors (e.g., stale position after concurrent edits)
  }
}
