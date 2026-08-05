/**
 * The one way to toggle the Universal Toolbar (#1204).
 *
 * Showing the toolbar is not a single flag flip: it displaces the StatusBar
 * and closes the FindBar first, because all three compete for the same strip
 * at the bottom of the window. That sequence used to live inside
 * `useUniversalToolbar`'s keydown handler, which was fine while the shortcut
 * was the only entry point. Adding a View-menu item gives it a second caller,
 * and a copy of the sequence in the command would drift from the copy in the
 * hook — the toolbar would open over a still-visible StatusBar from one path
 * and not the other.
 *
 * @coordinates-with hooks/useUniversalToolbar.ts — the keyboard entry point
 * @coordinates-with services/commands/viewCommands.ts — the menu entry point
 * @module services/editor/universalToolbarToggle
 */
import { useUIStore } from "@/stores/uiStore";

/**
 * Show the toolbar (displacing the StatusBar and closing search) or hide it
 * again. Safe to call from any surface — it reads current state itself.
 */
export function toggleUniversalToolbar(): void {
  const ui = useUIStore.getState();
  if (!ui.universalToolbarVisible) {
    // Opening: the StatusBar and FindBar share this strip, so they yield.
    ui.displaceStatusBar();
    useUIStore.getState().searchClose();
  }
  ui.toggleUniversalToolbar();
}
