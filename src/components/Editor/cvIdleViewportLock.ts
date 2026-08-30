/**
 * cv-idle viewport lock
 *
 * Purpose: toggle the `.cv-idle` class (the content-visibility optimization
 * for large WYSIWYG documents, #823) without moving what the reader sees
 * (#1340). Flipping the class swaps `contain-intrinsic-size` estimates for
 * real block heights (and back); when the blocks ABOVE the viewport change
 * height, the content under an unchanged scrollTop shifts — on a 60K+ char
 * document, applying Bold from the toolbar threw the selection out of view.
 *
 * Key decisions:
 *   - Anchor-based compensation: measure the first block intersecting the
 *     viewport before the class flip, re-measure after, and add the delta to
 *     the scroll container's scrollTop. Client rects already reflect any
 *     native scroll-anchoring adjustment the engine made during the forced
 *     layout, so the residual delta is exactly what remains to correct —
 *     self-correcting on Chromium/WebView2, and the whole fix on WebKit,
 *     which has no scroll anchoring at all.
 *   - The anchor search early-exits at the first block whose bottom clears
 *     the scroller's top edge — O(blocks above the viewport), so a full walk
 *     happens only with the reader at the document's very end. Each visited
 *     rect read is a cache hit once the first read has forced layout.
 *   - No scroller or no anchor (empty doc, everything above the viewport,
 *     detached or display:none container): just flip the class. A zero delta
 *     writes nothing.
 *   - The pre-toggle rect read happens while `.cv-idle` is still applied and
 *     the DOM is dirty from the edit, forcing one content-visibility layout
 *     pass. Deliberate: it runs only on the FIRST edit after an idle window
 *     (the per-keystroke hot path never gets here — see
 *     suppressCvIdleDuringEdit), typing transactions already force that same
 *     layout before onUpdate fires (ProseMirror's scrollToSelection reads
 *     caret coords during updateState), and the alternative — caching anchor
 *     geometry at idle time — mis-compensates any edit that changes heights
 *     above the viewport (find-and-replace, MCP document edits), trading
 *     correctness for a once-per-burst saving.
 *
 * @coordinates-with tiptapEditorHelpers.ts — suppressCvIdleDuringEdit wraps
 *   both of its class toggles (the edit-time strip and the idle re-add) here
 * @module components/Editor/cvIdleViewportLock
 */
import { findScrollContainer } from "@/services/editor/scrollPosition";

/**
 * Set the presence of `.cv-idle` on `container`, compensating the scroll
 * container so the block at the top of the viewport stays put.
 */
export function setCvIdlePreservingViewport(container: HTMLElement, enabled: boolean): void {
  const scroller = findScrollContainer(container);
  const anchor = scroller ? findViewportAnchor(container, scroller) : null;
  const beforeTop = anchor ? anchor.getBoundingClientRect().top : 0;

  container.classList.toggle("cv-idle", enabled);

  if (!scroller || !anchor) return;
  // Reading the rect here forces the layout the class flip invalidated, so
  // the delta is measured against settled geometry.
  const delta = anchor.getBoundingClientRect().top - beforeTop;
  if (delta !== 0) scroller.scrollTop += delta;
}

/**
 * The first `.ProseMirror > *` block, in document order, whose bottom edge
 * clears the scroller's top edge — i.e. the first block the reader can see.
 * Blocks fully above the viewport are skipped; blocks below it are never
 * measured.
 */
function findViewportAnchor(container: HTMLElement, scroller: HTMLElement): Element | null {
  const blocks = container.querySelector(".ProseMirror")?.children;
  if (!blocks || blocks.length === 0) return null;
  const viewportTop = scroller.getBoundingClientRect().top;
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].getBoundingClientRect().bottom > viewportTop) return blocks[i];
  }
  return null;
}
