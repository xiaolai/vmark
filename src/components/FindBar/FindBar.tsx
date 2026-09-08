/**
 * FindBar
 *
 * Purpose: Inline search-and-replace bar that appears at the top of the editor area.
 * Supports case-sensitive, whole-word, and regex search modes with match navigation.
 *
 * User interactions:
 *   - Cmd+F opens (via the uiStore search slice), Escape closes
 *   - Mod+E (Edit → Use Selection for Find) seeds the query from the editor selection and opens
 *   - Enter/Shift+Enter navigates forward/backward through matches
 *   - Tab moves focus from find input to replace input
 *   - Toggle buttons for case sensitivity, whole word, and regex modes
 *   - Replace/Replace All buttons for substitution
 *
 * Key decisions:
 *   - All state lives in the uiStore search slice — FindBar is a pure view that delegates actions
 *     via getState() calls, keeping the component stateless beyond refs.
 *   - IME guard prevents Enter during CJK composition from triggering find operations;
 *     uses useImeComposition grace period for macOS WebKit post-composition keydown.
 *     The keyboard behaviour lives in useFindBarKeyboard, the focus and Mod+E
 *     seeding effects in useFindBarFocus, and the two text fields plus the three
 *     button groups — mode toggles, navigation, replace actions — in
 *     FindBarControls. What is left here is the store subscriptions, the three
 *     dispatch callbacks and the composition (audit 20260907, #301).
 *   - Regex toggle is conditionally shown based on settings (enableRegexSearch).
 *   - A query or mode change resets currentIndex to -1 while the editor recounts, and
 *     both search backends report an index >= 0 whenever they report matches — so
 *     (matchCount > 0, currentIndex < 0) is "recount pending" (`hasCurrentMatch`) and
 *     renders as no matches rather than "0 of N" over the previous query's count; the
 *     keyboard hook consults the same predicate before Enter (audit 20260907, #302).
 *
 * @coordinates-with stores/uiStore/searchSlice.ts — all search state and operations
 * @coordinates-with components/FindBar/useFindBarKeyboard.ts — Enter/Escape/Tab + IME guard
 * @coordinates-with components/FindBar/useFindBarFocus.ts — open-focus + the Mod+E relay
 * @coordinates-with components/FindBar/FindBarControls.tsx — the text fields and the three button groups
 * @coordinates-with utils/sourceEditorSearch.ts — CodeMirror search integration
 * @module components/FindBar/FindBar
 */
import { useCallback, useRef } from "react";
import { Search, X, Replace } from "lucide-react";
import { ICON_SM } from "@/utils/iconSizes";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { useImeComposition } from "@/hooks/useImeComposition";
import { preventSelectAllOnButtons } from "./preventSelectAllOnButtons";
import { useFindBarFocus } from "./useFindBarFocus";
import { hasCurrentMatch, useFindBarKeyboard } from "./useFindBarKeyboard";
import {
  FindBarField,
  FindBarNavigation,
  FindBarReplaceActions,
  FindBarToggles,
} from "./FindBarControls";
import "./FindBar.css";

/** Renders an inline search-and-replace bar with case, whole-word, and regex toggle support. */
export function FindBar() {
  const { t } = useTranslation("editor");
  const isOpen = useUIStore((state) => state.search.isOpen);
  const query = useUIStore((state) => state.search.query);
  const replaceText = useUIStore((state) => state.search.replaceText);
  const matchCount = useUIStore((state) => state.search.matchCount);
  const currentIndex = useUIStore((state) => state.search.currentIndex);

  const ime = useImeComposition();
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  useFindBarFocus(isOpen, findInputRef);

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    useUIStore.getState().searchSetQuery(e.target.value);
  }, []);

  const handleReplaceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    useUIStore.getState().searchSetReplaceText(e.target.value);
  }, []);

  const handleClose = useCallback(() => {
    useUIStore.getState().searchClose();
    if (!useUIStore.getState().universalToolbarVisible) {
      useUIStore.getState().restoreStatusBar();
    }
  }, []);

  const { handleFindKeyDown, handleReplaceKeyDown } = useFindBarKeyboard({
    ime,
    findInputRef,
    replaceInputRef,
    onClose: handleClose,
  });

  if (!isOpen) return null;

  // A count without a current index is the previous query's, still being
  // recounted — the same predicate the keyboard consults before Enter (#302).
  const hasMatches = hasCurrentMatch({ matchCount, currentIndex });
  const matchDisplay = hasMatches
    ? t("findbar.matchCount", { current: currentIndex + 1, total: matchCount })
    : matchCount === 0 && query
      ? t("findbar.noResults")
      : "";

  return (
    <div className="find-bar" onKeyDown={preventSelectAllOnButtons}>
      <div className="find-bar-row">
        <FindBarToggles />

        <FindBarField
          inputRef={findInputRef}
          icon={<Search className="find-bar-icon" size={ICON_SM} />}
          placeholder={t("findbar.find.placeholder")}
          label={t("findbar.find.label")}
          value={query}
          onChange={handleQueryChange}
          onKeyDown={handleFindKeyDown}
          ime={ime}
        />

        <FindBarNavigation hasMatches={hasMatches} matchDisplay={matchDisplay} />

        <FindBarField
          inputRef={replaceInputRef}
          icon={<Replace className="find-bar-icon" size={ICON_SM} />}
          placeholder={t("findbar.replace.placeholder")}
          label={t("findbar.replace.label")}
          value={replaceText}
          onChange={handleReplaceChange}
          onKeyDown={handleReplaceKeyDown}
          ime={ime}
        />

        <FindBarReplaceActions hasMatches={hasMatches} />

        <button className="vm-icon-btn vm-icon-btn--sm find-bar-close" onClick={handleClose} title={t("findbar.close")} aria-label={t("findbar.close")}>
          <X size={ICON_SM} />
        </button>
      </div>
    </div>
  );
}
