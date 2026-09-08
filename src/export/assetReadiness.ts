/**
 * Asset readiness — what "settled" means for each kind of async content.
 *
 * Purpose: the PREDICATES, with no notion of time. `waitForAssets` polls them;
 * `ExportSurface` asks one of them directly. They were inside the poller, which
 * put two unrelated kinds of reasoning in one file — "has this image finished"
 * and "how do four nested timers race a deadline" — and reading either meant
 * scrolling through the other (audit 20260907 round 3, #706).
 *
 * @coordinates-with src/export/waitForAssets.ts — the poller over these
 * @coordinates-with src/export/ExportSurface.tsx — asks `isImageSettled` directly
 * @module export/assetReadiness
 */

/** Per-category readiness flags for async content (fonts, images, math, mermaid). */
export interface StabilityStatus {
  fontsReady: boolean;
  imagesReady: boolean;
  mathReady: boolean;
  mermaidReady: boolean;
  allReady: boolean;
}

/**
 * Class set by ImageNodeView (and BlockImageNodeView) on the underlying `<img>`
 * once async path resolution has terminally failed. Treated as a final state by
 * the stability poller so we don't burn the full timeout waiting on something
 * that will never finish (issue #837 follow-up).
 */
const IMAGE_ERROR_CLASS = "image-error";

/**
 * Decide whether a single image counts as "settled" for export readiness.
 *
 * Three states matter:
 *   - **Loaded**: non-empty `src` AND `img.complete === true` → settled.
 *   - **Errored**: NodeView marked the element with `image-error` after a
 *     failed resolve → settled (further waiting won't change anything).
 *   - **Pending**: empty `src` (NodeView still resolving the path) OR the
 *     browser is still fetching the asset → not settled.
 *
 * Empty `src` alone is NOT settled because `img.complete` returns `true` for
 * empty src, which would cause the poller to extract HTML before ImageNodeView
 * finished setting the real `asset://` URL — the original bug from #837.
 *
 * Exported for unit tests so the predicate stays in lockstep with the
 * NodeView lifecycle even when the rest of the pipeline can't be exercised.
 */
export function isImageSettled(img: HTMLImageElement): boolean {
  if (img.classList.contains(IMAGE_ERROR_CLASS)) return true;
  const src = img.getAttribute("src") ?? "";
  if (!src) return false;
  return img.complete;
}

/**
 * Check if all images in a container have loaded or errored.
 */
export function checkImages(container: HTMLElement): { ready: boolean; pending: number } {
  const images = container.querySelectorAll("img");
  let pending = 0;

  for (const img of images) {
    if (!isImageSettled(img)) {
      pending++;
    }
  }

  return { ready: pending === 0, pending };
}

/**
 * The LaTeX preview while its render is pending: `createLatexPreviewWidget`
 * sets both classes, and replaces the placeholder class on success and on
 * failure (`mermaid-error`). The LIFECYCLE CLASS is the signal, never the
 * placeholder's text (audit #349): the text is localized, so a non-English
 * placeholder read as ready, and the terminal error ("Failed to render math")
 * read as pending until the timeout.
 */
const MATH_PENDING_SELECTOR = ".code-block-preview-placeholder.latex-preview";

/** Check if Math (KaTeX) has finished rendering. */
function checkMathReady(container: HTMLElement): boolean {
  return container.querySelector(MATH_PENDING_SELECTOR) === null;
}

/**
 * Check if Mermaid diagrams have finished rendering.
 *
 * An error state is FINAL, so a failed diagram counts as ready: waiting on one
 * that will never render burns the whole export timeout for nothing.
 */
function checkMermaidReady(container: HTMLElement): boolean {
  // Loading placeholders (mermaid and graphviz share this gate).
  return container.querySelectorAll(".mermaid-loading, .graphviz-loading").length === 0;
}

/**
 * Get current stability status for a container.
 */
export function getStabilityStatus(container: HTMLElement): StabilityStatus {
  const imagesCheck = checkImages(container);
  // document.fonts is typed non-optional but the Font Loading API can be
  // absent at runtime; waitForFonts already treats that as "ready", and the
  // polling path must not throw where waitForFonts would not.
  const fonts: FontFaceSet | undefined = document.fonts;
  const fontsReady = !fonts || fonts.status === "loaded";
  const imagesReady = imagesCheck.ready;
  const mathReady = checkMathReady(container);
  const mermaidReady = checkMermaidReady(container);

  return {
    fontsReady,
    imagesReady,
    mathReady,
    mermaidReady,
    allReady: fontsReady && imagesReady && mathReady && mermaidReady,
  };
}
