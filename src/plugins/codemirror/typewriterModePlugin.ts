/**
 * Typewriter Mode Plugin for CodeMirror (Source Mode)
 *
 * Keeps the cursor vertically centered on screen as you type.
 * The page scrolls to keep your writing position at a comfortable eye level.
 *
 * Mirrors the behavior of the Milkdown typewriter mode plugin.
 */

import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";

// Threshold for scrolling (pixels from target position)
const SCROLL_THRESHOLD = 30;
// Number of initial updates to skip (avoid jarring scroll on load)
const SKIP_INITIAL_UPDATES = 3;
// Target position: cursor at 40% from top
const TARGET_POSITION = 0.4;

/**
 * Creates a ViewPlugin that keeps cursor centered vertically.
 */
export function createSourceTypewriterPlugin() {
  return ViewPlugin.fromClass(
    class {
      private updateCount = 0;
      private rafId: number | null = null;

      update(update: ViewUpdate) {
        // Check if typewriter mode is enabled
        if (!useEditorStore.getState().typewriterModeEnabled) return;

        // Only scroll if selection changed
        if (!update.selectionSet) return;

        // Skip initial updates to avoid jarring scroll on load
        this.updateCount++;
        if (this.updateCount <= SKIP_INITIAL_UPDATES) return;

        // Cancel any pending scroll to handle rapid cursor movement
        if (this.rafId !== null) {
          cancelAnimationFrame(this.rafId);
        }

        // Use requestAnimationFrame to batch scroll updates
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;

          try {
            const view = update.view;
            const { from } = view.state.selection.main;

            // Get cursor position in viewport coordinates
            const coords = view.coordsAtPos(from);
            if (!coords) return;

            // Find the scrollable container
            const scrollContainer =
              (view.dom.closest(".editor-content") as HTMLElement) ||
              view.dom.parentElement;
            if (!scrollContainer) return;

            // Get container dimensions
            const containerRect = scrollContainer.getBoundingClientRect();
            const containerHeight = containerRect.height;

            // Target: keep cursor at 40% from top (comfortable reading position)
            const targetY = containerRect.top + containerHeight * TARGET_POSITION;

            // Calculate how much to scroll
            const scrollOffset = coords.top - targetY;

            // Only scroll if the offset is significant (avoid jitter)
            if (Math.abs(scrollOffset) > SCROLL_THRESHOLD) {
              scrollContainer.scrollBy({
                top: scrollOffset,
                behavior: "smooth",
              });
            }
          } catch {
            // coordsAtPos can throw if position is invalid
          }
        });
      }

      destroy() {
        // Clean up pending animation frame
        if (this.rafId !== null) {
          cancelAnimationFrame(this.rafId);
        }
      }
    }
  );
}
