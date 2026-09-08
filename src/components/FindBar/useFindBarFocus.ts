/**
 * FindBar focus effects — where the caret goes, and the Mod+E seeding.
 *
 * Purpose: the two `useEffect` bodies the FindBar component carried (audit
 * 20260907, #301). Both are about the same thing — putting a ready-to-type
 * query in front of the user — and neither is about rendering, so they read
 * better next to each other than interleaved with the bar's markup.
 *
 * Key decisions:
 *   - Opening SELECTS rather than merely focusing: the previous query is still
 *     in the box and the overwhelmingly common next action is to replace it.
 *   - Closing GIVES FOCUS BACK to whatever had it when the bar opened. Without
 *     that the focused field simply unmounted and focus fell to
 *     `document.body`, so the editor the user was typing in a moment earlier
 *     stopped receiving keystrokes until something was clicked (audit round 3,
 *     #595). Captured on the opening edge, before the input takes focus.
 *   - The Mod+E path is a window event, not a prop. `useSearchCommands` relays
 *     the native menu item as `use-selection-for-find`, because the menu
 *     handler has no route into this subtree.
 *   - The ref is read at call time, never captured: the bar renders `null`
 *     while closed, so on the opening render the input exists but on the
 *     listener's registration render it does not.
 *   - The Mod+E path selects in an EFFECT, not inside the listener (audit R2,
 *     #599). The input's value is the store's query, so seeding it and calling
 *     `select()` in the same turn selects the text the box is about to lose:
 *     React commits the new value afterwards and the selection collapses. A
 *     counter bumped beside the seed puts both updates in one render pass, so
 *     the effect runs once the DOM already holds the new query. The same
 *     effect FOCUSES: the open-bar path (Mod+E on a bar that is already up)
 *     never crossed the `isOpen` edge, so nothing had focused the field.
 *
 * @coordinates-with src/components/FindBar/FindBar.tsx — the only consumer
 * @coordinates-with src/services/search/seedFindFromSelection.ts — the Mod+E seeding
 * @coordinates-with src/hooks/useSearchCommands.ts — relays the menu event
 * @module components/FindBar/useFindBarFocus
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { seedFindFromSelection } from "@/services/search/seedFindFromSelection";

/**
 * The window event `useSearchCommands` relays Edit → Use Selection for Find as.
 *
 * A raw string on both sides is a contract no compiler checks: a typo in either
 * place leaves the menu item doing nothing, silently, and that has already
 * happened once here (WI-FL3.4 — nothing listened at all). The producer cannot
 * import this yet, so `useFindBarFocus.eventName.test.ts` reads its source and
 * fails if the two spellings drift (audit round 3, #600).
 */
export const USE_SELECTION_FOR_FIND_EVENT = "use-selection-for-find";

/**
 * Focus and select the find input when the bar opens, and re-seed it whenever
 * Edit → Use Selection for Find fires.
 *
 * @param isOpen - Whether the find bar is showing.
 * @param findInputRef - The find field; `null` until the bar has rendered it.
 */
export function useFindBarFocus(
  isOpen: boolean,
  findInputRef: RefObject<HTMLInputElement | null>,
): void {
  // Where focus came FROM, so closing can give it back. Captured before the
  // input takes it, on the opening edge only.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      const active = document.activeElement;
      previouslyFocused.current =
        active instanceof HTMLElement && active !== findInputRef.current ? active : null;
      findInputRef.current?.focus();
      findInputRef.current?.select();
      return;
    }
    // Closing unmounts the focused field, and nothing else claimed focus — it
    // fell to `document.body`, so the editor the user had been typing in a
    // moment earlier stopped receiving keystrokes (audit round 3, #595).
    // `isConnected`, because the element may have gone with a closed tab.
    const target = previouslyFocused.current;
    previouslyFocused.current = null;
    if (target?.isConnected) target.focus();
  }, [isOpen, findInputRef]);

  const [seeded, setSeeded] = useState(0);

  useEffect(() => {
    const seed = (): void => {
      seedFindFromSelection();
      setSeeded((n) => n + 1);
    };
    window.addEventListener(USE_SELECTION_FOR_FIND_EVENT, seed);
    return () => window.removeEventListener(USE_SELECTION_FOR_FIND_EVENT, seed);
  }, []);

  useEffect(() => {
    if (seeded === 0) return;
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [seeded, findInputRef]);
}
