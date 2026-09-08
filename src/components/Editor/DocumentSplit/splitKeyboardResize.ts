/**
 * splitKeyboardResize — the keyboard half of the split divider (audit
 * 20260907, #277): which fraction a key asks for, or `null` for a key the
 * divider does not own. Pure, so the arrow step and the Home/End jumps are
 * pinned without rendering.
 *
 * Panes sit left | right, so only Left/Right (and Home/End) resize; Up/Down
 * stay with the browser — the stacked orientation had no writer and was
 * removed (WI-FL3.10). The clamp is DERIVED from the store constants, not
 * restated: Home/End and the ARIA range were once hardcoded as 0.2/0.8, so a
 * change to the store bounds would have moved the drag limit while leaving
 * the keyboard jump pointing at the old ones — silently, and only for
 * keyboard and screen-reader users.
 *
 * @coordinates-with ./SplitDivider.tsx — the only consumer
 * @coordinates-with src/stores/paneStoreTypes.ts — the fraction bounds
 * @module components/Editor/DocumentSplit/splitKeyboardResize
 */
import { MIN_PANE_FRACTION, MAX_PANE_FRACTION } from "@/stores/paneStoreTypes";

export const KEYBOARD_STEP = 0.05;

/** The fraction `key` asks for from `fraction`, or `null` when the key is not a resize key. */
export function keyboardResizeTarget(key: string, fraction: number): number | null {
  switch (key) {
    case "ArrowLeft":
      return fraction - KEYBOARD_STEP;
    case "ArrowRight":
      return fraction + KEYBOARD_STEP;
    case "Home":
      return MIN_PANE_FRACTION;
    case "End":
      return MAX_PANE_FRACTION;
    default:
      return null;
  }
}
