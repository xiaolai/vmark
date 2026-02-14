/**
 * Selection Pulse Animation Utility
 *
 * Purpose: Provides visual feedback when auto-selecting text (e.g., toolbar shortcut
 * word selection). Adds a temporary CSS class that triggers a pulse animation.
 *
 * Key decisions:
 *   - WeakMap for timer tracking allows GC when elements are removed from DOM
 *   - Re-triggering on the same element resets the timer to prevent class removal mid-animation
 *   - 180ms default matches the CSS transition duration for smooth feel
 *
 * @coordinates-with toolbarActions/ — triggers pulse when auto-selecting word for formatting
 * @module utils/selectionPulse
 */

const pulseTimers = new WeakMap<HTMLElement, number>();

/**
 * Trigger a selection pulse animation on an element.
 *
 * @param element - The element to add the pulse class to
 * @param className - CSS class that triggers the animation
 * @param durationMs - How long before removing the class (default: 180ms)
 *
 * @example
 * // Trigger pulse on ProseMirror editor
 * triggerSelectionPulse(view.dom, "pm-selection-pulse");
 *
 * // Trigger pulse on CodeMirror editor
 * triggerSelectionPulse(view.dom, "cm-selection-pulse");
 */
export function triggerSelectionPulse(
  element: HTMLElement,
  className: string,
  durationMs = 180
): void {
  const existing = pulseTimers.get(element);
  if (existing) {
    window.clearTimeout(existing);
  }

  element.classList.add(className);

  const timer = window.setTimeout(() => {
    element.classList.remove(className);
    pulseTimers.delete(element);
  }, durationMs);

  pulseTimers.set(element, timer);
}
