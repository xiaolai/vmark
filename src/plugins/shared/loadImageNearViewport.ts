/**
 * Purpose: start an image node view's fetch and decode only once the image
 * nears the visible part of the editor's scroll container. A 0.5 MB document
 * with 338 local images fetched and decoded every one at open (~315 MiB as
 * RGBA) and starved the main thread for seconds (#1565).
 *
 * Key decisions:
 *   - Deferred through `whenNearViewport`, not the engine's `loading="lazy"`:
 *     a native lazy image is invisible to the two readers that must know about
 *     it. Navigation scrolls settle on the root's pending/busy marks, and an
 *     image growing from its placeholder mid-scroll moves the target (#1458);
 *     print flushes the deferred renders before reading the live DOM.
 *   - The render stays "busy" until the image loads or fails, because its
 *     height only changes then. A stalled remote image is waited on for at
 *     most LOAD_SETTLE_TIMEOUT_MS, so it cannot hold up a scroll or a print,
 *     and cancelling (the image was deleted or its source replaced) stops the
 *     wait at once.
 *   - `assign` may be async: a local path is RESOLVED near the viewport too,
 *     because resolving it costs two path IPCs per image at open. The render
 *     stays busy across the resolution, at most LOAD_SETTLE_TIMEOUT_MS from
 *     its start, so a resolution that never answers cannot hold up a print;
 *     a cancel releases it at once rather than when the resolution answers.
 *   - With no scroll container (the off-screen export surface) the `src` is
 *     assigned at once: export waits for every image to complete.
 *
 * @coordinates-with plugins/shared/nearViewport.ts — the viewport deferral
 * @coordinates-with plugins/shared/editorScrollRoot.ts — which container counts
 * @coordinates-with plugins/blockImage/BlockImageNodeView.ts — a caller
 * @coordinates-with plugins/imageView/plugin.ts — a caller
 * @module plugins/shared/loadImageNearViewport
 */

import { editorScrollRoot } from "./editorScrollRoot";
import { whenNearViewport } from "./nearViewport";

/** Longest a loading image keeps the scroller busy. */
export const LOAD_SETTLE_TIMEOUT_MS = 5000;

/**
 * Wait for `img` to load, fail or time out. `promise` is undefined when it is
 * already complete; `stop` ends the wait early and is safe to call twice.
 */
function imageSettled(img: HTMLImageElement): { promise?: Promise<void>; stop: () => void } {
  if (img.complete) return { stop: () => {} };
  let stop = () => {};
  const promise = new Promise<void>((resolve) => {
    stop = () => {
      clearTimeout(timer);
      img.removeEventListener("load", stop);
      img.removeEventListener("error", stop);
      resolve();
    };
    const timer = setTimeout(stop, LOAD_SETTLE_TIMEOUT_MS);
    img.addEventListener("load", stop);
    img.addEventListener("error", stop);
  });
  return { promise, stop };
}

/**
 * Run `assign` — which sets `img.src`, or resolves a path and then sets it —
 * once `img` nears the viewport of the editor whose DOM is `editorDom`, or at
 * once outside a scrolling editor.
 *
 * Returns a cancel function; call it when the source changes or the view is
 * destroyed. After `assign` ran it only ends the wait; an async `assign` must
 * itself drop a result that arrives after the cancel.
 */
export function loadImageNearViewport(
  img: HTMLImageElement,
  editorDom: Element | null,
  assign: () => void | Promise<void>,
): () => void {
  let stopWaiting = () => {};
  const cancelRender = whenNearViewport(img, editorScrollRoot(editorDom), () => {
    const assigned = assign();
    if (!(assigned instanceof Promise)) {
      const settled = imageSettled(img);
      stopWaiting = settled.stop;
      return settled.promise;
    }
    return new Promise<void>((resolve) => {
      let done = false;
      let stopImage = () => {};
      // Ends the whole wait — deadline, cancel or settled — once, and with it
      // any load wait already started.
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(deadline);
        stopImage();
        resolve();
      };
      const deadline = setTimeout(finish, LOAD_SETTLE_TIMEOUT_MS);
      stopWaiting = finish;
      // The callers handle their own errors; one that escapes still ends the
      // wait, and is reported as `nearViewport` reports a render's error —
      // thrown from a microtask, not left as an unhandled rejection.
      assigned
        .then(() => {
          if (done) return; // cancelled, or past the deadline
          const settled = imageSettled(img);
          stopImage = settled.stop;
          return settled.promise;
        })
        .then(finish, (error: unknown) => {
          finish();
          queueMicrotask(() => { throw error; });
        });
    });
  });
  return () => {
    cancelRender();
    stopWaiting();
  };
}
