/**
 * Which key events the composition guard is allowed to claim.
 *
 * Purpose: ProseMirror calls `handleKeyDown` from two callers that ask two
 * different questions, and `true` means something different to each.
 *
 *   - `input.ts` passes a REAL, dispatched keydown. `true` means "handled —
 *     preventDefault it". This is the only question the guard wants to answer.
 *   - `domchange.ts` passes a key event it SYNTHESIZED and never dispatched,
 *     asking whether a DOM change should be reinterpreted as that keystroke.
 *     There `true` means "discard the parsed DOM change" — the opposite of
 *     protecting composed text.
 *
 * Key decisions:
 *   - An event is identified as synthesized by `target === null`. Per DOM, an
 *     event's target stays null until it is dispatched, so this tests the
 *     property that actually matters rather than how the event was built.
 *   - The test fails CLOSED: anything not positively identifiable as
 *     undispatched counts as a real keystroke and stays guarded.
 *   - The rule is key-agnostic on purpose. `domchange.ts` synthesizes Enter as
 *     well as Backspace; exempting only Backspace would leave the identical
 *     defect behind the Enter door.
 *
 * Known limitations:
 *   - A caller that hands the guard an undispatched event and genuinely wants
 *     it suppressed would not be served. No such caller exists: ProseMirror's
 *     synthesized events carry neither `isComposing` nor keyCode 229, so they
 *     were never IME keystrokes to begin with.
 *
 * Why it exists: committing a Chinese candidate into an otherwise empty table
 * cell makes WebKit tear out the cell's paragraph and drop the text under the
 * TR (prosemirror-view #188). The rebuilt paragraph loses its internal
 * `sourceLine` attribute, so the re-parsed diff spans the whole node and
 * shrinks — which matches `looksLikeBackspace`. The guard answered the
 * resulting synthetic Backspace with `true`, ProseMirror dropped the parsed
 * replacement, and the user's committed 路 was redrawn as `lu` (#1392).
 *
 * @coordinates-with plugins/compositionGuard/tiptap.ts — the only consumer
 * @coordinates-with utils/imeGuard.ts — supplies the IME keystroke test
 * @module plugins/compositionGuard/compositionKeys
 */

import { isImeKeyEvent } from "@/utils/imeGuard";

/** The fields the policy reads — a structural subset of KeyboardEvent. */
export type GuardedKeyEvent = Pick<KeyboardEvent, "isComposing" | "keyCode" | "target">;

/**
 * True when the event reached the guard by real DOM dispatch.
 *
 * Fails closed: a missing `target` is treated as dispatched, so an event this
 * function cannot classify keeps its IME protection.
 */
export function isDispatchedKeyEvent(event: GuardedKeyEvent): boolean {
  return event.target !== null;
}

/**
 * True when the composition guard should claim (suppress) this key event.
 *
 * @param event - the keydown handed to the guard
 * @param inGracePeriod - whether the view is inside the post-composition grace
 */
export function shouldGuardKeyEvent(event: GuardedKeyEvent, inGracePeriod: boolean): boolean {
  if (!isDispatchedKeyEvent(event)) return false;
  return isImeKeyEvent(event) || inGracePeriod;
}
