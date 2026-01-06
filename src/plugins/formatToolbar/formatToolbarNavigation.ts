/**
 * Format Toolbar Keyboard Navigation
 *
 * Keyboard navigation and focus management for the format toolbar.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import { useFormatToolbarStore } from "@/stores/formatToolbarStore";

/**
 * Get all focusable elements in a container.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

/**
 * Create a keydown handler for toolbar navigation.
 */
export function createKeydownHandler(
  container: HTMLElement,
  editorView: EditorView
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (!useFormatToolbarStore.getState().isOpen) return;
    if (container.style.display === "none") return;

    const activeEl = document.activeElement as HTMLElement;
    const focusInToolbar = container.contains(activeEl);

    // Escape closes toolbar
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      useFormatToolbarStore.getState().closeToolbar();
      editorView.focus();
      return;
    }

    // Cmd/Ctrl+E closes toolbar
    if (focusInToolbar && (e.key === "e" || e.key === "E") && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      useFormatToolbarStore.getState().closeToolbar();
      editorView.focus();
      return;
    }

    // Tab navigation within toolbar
    if (e.key === "Tab" && focusInToolbar) {
      const focusable = getFocusableElements(container);
      if (focusable.length === 0) return;

      const currentIndex = focusable.indexOf(activeEl);

      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const prevIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
        focusable[prevIndex].focus();
      } else {
        e.preventDefault();
        e.stopPropagation();
        const nextIndex = currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
        focusable[nextIndex].focus();
      }
    }
  };
}

/**
 * Keyboard navigation manager for the toolbar.
 */
export class KeyboardNavigationManager {
  private handler: ((e: KeyboardEvent) => void) | null = null;
  private container: HTMLElement;
  private editorView: EditorView;

  constructor(container: HTMLElement, editorView: EditorView) {
    this.container = container;
    this.editorView = editorView;
  }

  /**
   * Update container reference (when toolbar is rebuilt).
   */
  updateContainer(container: HTMLElement): void {
    this.container = container;
  }

  /**
   * Update editor view reference.
   */
  updateEditorView(editorView: EditorView): void {
    this.editorView = editorView;
  }

  /**
   * Setup keyboard navigation.
   */
  setup(): void {
    this.remove();
    this.handler = createKeydownHandler(this.container, this.editorView);
    document.addEventListener("keydown", this.handler, true);
  }

  /**
   * Remove keyboard navigation.
   */
  remove(): void {
    if (this.handler) {
      document.removeEventListener("keydown", this.handler, true);
      this.handler = null;
    }
  }
}
