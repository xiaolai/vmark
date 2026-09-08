/**
 * useFindBarKeyboard — the keyboard behaviour of the find and replace inputs
 * (audit 20260907, #301: split out of the 247-line FindBar component).
 *
 *   - Enter / Shift+Enter in the find input navigates forward / backward;
 *     Enter in the replace input replaces the current match.
 *   - Escape closes the bar from either input, and is CONSUMED: the same
 *     keystroke used to carry on to the popup views that listen on `document`,
 *     so one Escape dismissed the find bar and an open link popup together
 *     (audit round 3, #602).
 *   - Tab moves focus find → replace; Shift+Tab moves it back.
 *   - The IME guard runs first: Enter during CJK composition (and the
 *     post-composition grace period on macOS WebKit) never triggers a find.
 *   - Enter navigates or replaces only while the bar HAS a current match
 *     (`hasCurrentMatch`, shared with the buttons' disabled state): after a
 *     query or mode change the store keeps the previous count until the
 *     editor recounts, and the keyboard used to dispatch against it — a
 *     Shift+Enter right after retyping jumped to the OLD last match (#302).
 *
 * The two handlers are ONE dispatcher, parameterized by what Enter does and
 * where Tab goes. They were near-identical copies, and every rule above had to
 * be written twice — which is how the IME guard, the Escape treatment and the
 * recount check each became a thing that could hold in one input and not the
 * other (audit round 3, #601).
 *
 * @coordinates-with src/components/FindBar/FindBar.tsx — the only consumer
 * @coordinates-with src/stores/uiStore/searchSlice.ts — the actions dispatched
 * @module components/FindBar/useFindBarKeyboard
 */
import { useCallback, useMemo, type KeyboardEvent, type RefObject } from "react";
import { useUIStore } from "@/stores/uiStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import type { useImeComposition } from "@/hooks/useImeComposition";

/**
 * The bar has a match to act on. Both search backends report an index >= 0
 * whenever they report matches, so (matchCount > 0, currentIndex < 0) is
 * exactly "recount pending" — the previous criteria's count — and is treated
 * as no match by the buttons and the keyboard alike (#302).
 */
export function hasCurrentMatch(search: { matchCount: number; currentIndex: number }): boolean {
  return search.matchCount > 0 && search.currentIndex >= 0;
}

interface FindBarKeyboardOptions {
  ime: ReturnType<typeof useImeComposition>;
  findInputRef: RefObject<HTMLInputElement | null>;
  replaceInputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
}

/** What one field does with Enter, and where its Tab goes. */
interface FieldBehaviour {
  /** Runs only when the bar has a current match. */
  onEnter: (store: ReturnType<typeof useUIStore.getState>, shiftKey: boolean) => void;
  /** The field Tab moves focus to, and whether that Tab carries Shift. */
  tabTo: RefObject<HTMLInputElement | null>;
  tabWithShift: boolean;
}

export function useFindBarKeyboard({
  ime,
  findInputRef,
  replaceInputRef,
  onClose,
}: FindBarKeyboardOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent, field: FieldBehaviour) => {
      if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const store = useUIStore.getState();
        if (hasCurrentMatch(store.search)) field.onEnter(store, e.shiftKey);
      } else if (e.key === "Escape") {
        // Consumed, not merely acted on: the popup views listen for Escape on
        // `document`, so an un-stopped one closed them alongside the bar. The
        // field has focus; the keystroke is the bar's (#602).
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab" && e.shiftKey === field.tabWithShift) {
        e.preventDefault();
        field.tabTo.current?.focus();
      }
    },
    [ime, onClose],
  );

  const behaviour = useMemo(
    () => ({
      find: {
        onEnter: (store, shiftKey) => {
          if (shiftKey) store.searchFindPrevious();
          else store.searchFindNext();
        },
        tabTo: replaceInputRef,
        tabWithShift: false,
      } satisfies FieldBehaviour,
      replace: {
        onEnter: (store) => store.searchReplaceCurrent(),
        tabTo: findInputRef,
        tabWithShift: true,
      } satisfies FieldBehaviour,
    }),
    [findInputRef, replaceInputRef],
  );

  return {
    handleFindKeyDown: useCallback(
      (e: KeyboardEvent) => handleKeyDown(e, behaviour.find),
      [handleKeyDown, behaviour],
    ),
    handleReplaceKeyDown: useCallback(
      (e: KeyboardEvent) => handleKeyDown(e, behaviour.replace),
      [handleKeyDown, behaviour],
    ),
  };
}
