/**
 * Toolbar Navigation - Keyboard handling
 *
 * Pure functions for calculating focus positions during keyboard navigation.
 * No React/DOM dependencies - just index calculations.
 *
 * @module components/Editor/UniversalToolbar/toolbarNavigation
 */
import { TOOLBAR_GROUPS } from "./toolbarGroups";

/**
 * Get flat list of button indices grouped by their parent group.
 * Used for group-aware navigation (Ctrl+Arrow).
 */
function getGroupRanges(): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let offset = 0;

  for (const group of TOOLBAR_GROUPS) {
    const buttonCount = group.buttons.filter((b) => b.type !== "separator").length;
    if (buttonCount > 0) {
      ranges.push({ start: offset, end: offset + buttonCount - 1 });
      offset += buttonCount;
    }
  }

  return ranges;
}

/**
 * Get the next button index, wrapping at the end.
 *
 * @param current - Current button index
 * @param total - Total number of buttons
 * @returns Next button index
 */
export function getNextButtonIndex(current: number, total: number): number {
  return (current + 1) % total;
}

/**
 * Get the previous button index, wrapping at the start.
 *
 * @param current - Current button index
 * @param total - Total number of buttons
 * @returns Previous button index
 */
export function getPrevButtonIndex(current: number, total: number): number {
  return (current - 1 + total) % total;
}

/**
 * Get the first button index of the next group.
 * Used for Ctrl+Right / Option+Right navigation.
 *
 * @param current - Current button index
 * @returns First button index of next group
 */
export function getNextGroupFirstIndex(current: number): number {
  const ranges = getGroupRanges();

  // Find which group we're in
  let currentGroupIndex = 0;
  for (let i = 0; i < ranges.length; i++) {
    if (current >= ranges[i].start && current <= ranges[i].end) {
      currentGroupIndex = i;
      break;
    }
  }

  // Move to next group (wrap)
  const nextGroupIndex = (currentGroupIndex + 1) % ranges.length;
  return ranges[nextGroupIndex].start;
}

/**
 * Get the last button index of the previous group.
 * Used for Ctrl+Left / Option+Left navigation.
 *
 * @param current - Current button index
 * @returns Last button index of previous group
 */
export function getPrevGroupLastIndex(current: number): number {
  const ranges = getGroupRanges();

  // Find which group we're in
  let currentGroupIndex = 0;
  for (let i = 0; i < ranges.length; i++) {
    if (current >= ranges[i].start && current <= ranges[i].end) {
      currentGroupIndex = i;
      break;
    }
  }

  // Move to previous group (wrap)
  const prevGroupIndex = (currentGroupIndex - 1 + ranges.length) % ranges.length;
  return ranges[prevGroupIndex].end;
}

/**
 * Get the first button index (for Home key).
 */
export function getFirstButtonIndex(): number {
  return 0;
}

/**
 * Get the last button index (for End key).
 *
 * @param total - Total number of buttons
 */
export function getLastButtonIndex(total: number): number {
  return total - 1;
}
