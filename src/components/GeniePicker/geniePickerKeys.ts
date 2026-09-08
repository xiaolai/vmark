/**
 * The genie picker's input-mode key map (audit R3 #614).
 *
 * Purpose: the picker's `onKeyDown` was a 76-line callback holding a mode
 * branch, a control-ownership guard and an eight-arm `else if` chain over key
 * names, with the index arithmetic inline. Nothing in it could be checked
 * without rendering the overlay, and the wrap-around arithmetic — the part
 * most likely to be wrong at the ends of the list — was the least visible.
 *
 * The table below is what a key MEANS; the component still performs it. Keys
 * absent from the table are the browser's (typing, in particular).
 *
 * @coordinates-with src/components/GeniePicker/GeniePicker.tsx — the consumer
 * @module components/GeniePicker/geniePickerKeys
 */
import type { GenieScope } from "@/types/aiGenies";

/** Scope cycling order; `null` (every scope) is the fourth stop. */
export const SCOPES: readonly GenieScope[] = ["selection", "block", "document"];

export type PickerKeyIntent =
  | "close"
  | "previous"
  | "next"
  | "first"
  | "last"
  | "submit"
  | "cycle-scope";

/** What `key` means while the picker is taking input, or null to leave it alone. */
export function inputModeIntent(key: string, shiftKey: boolean): PickerKeyIntent | null {
  switch (key) {
    case "Escape":
      return "close";
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Tab":
      return "cycle-scope";
    // Shift+Enter is a newline in the prompt textarea, not a submission.
    case "Enter":
      return shiftKey ? null : "submit";
    default:
      return null;
  }
}

/**
 * The selected index after `intent`, wrapped within `length`.
 *
 * An EMPTY list keeps index 0 rather than producing -1 or NaN: the picker
 * renders a freeform prompt in that state, and a negative index would be
 * written into `aria-activedescendant`.
 */
export function nextSelectedIndex(
  current: number,
  intent: PickerKeyIntent,
  length: number,
): number {
  if (length <= 0) return 0;
  switch (intent) {
    case "next":
      return (current + 1) % length;
    case "previous":
      return (current - 1 + length) % length;
    case "first":
      return 0;
    case "last":
      return length - 1;
    default:
      return current;
  }
}

/** The scope after one Tab: selection → block → document → every scope → … */
export function nextScope(current: GenieScope | null): GenieScope | null {
  const index = current ? SCOPES.indexOf(current) : -1;
  const next = (index + 1) % (SCOPES.length + 1);
  return next === SCOPES.length ? null : SCOPES[next];
}
