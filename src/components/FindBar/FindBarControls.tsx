/**
 * FindBar controls — the bar's three button groups (audit 20260907, #301:
 * split out of the FindBar component, which had grown to 276 lines of
 * subscriptions, effects and markup).
 *
 *   - `FindBarField`: the find and replace text inputs, which differ only in
 *     icon, labels, value and handlers — one component, two uses (#301, round 3).
 *   - `FindBarToggles`: regex / case / whole-word mode toggles. They own their
 *     own store subscriptions, so a mode flip re-renders this group alone.
 *   - `FindBarNavigation`: previous / count / next.
 *   - `FindBarReplaceActions`: replace current / replace all.
 *
 * Each button dispatches straight to the uiStore search slice through
 * `getState()` — the bar is a pure view over that slice, and a wrapper
 * callback per action was the bulk of what the component carried.
 *
 * Every button here declares `type="button"` (audit R3 #596). An omitted type
 * defaults to `submit`, so the bar's clicks would submit any form it were ever
 * nested inside — a latent break that surfaces only when someone reuses the bar.
 *
 * @coordinates-with src/components/FindBar/FindBar.tsx — the only consumer
 * @coordinates-with src/stores/uiStore/searchSlice.ts — the actions dispatched
 * @module components/FindBar/FindBarControls
 */
import { useEffect, type ChangeEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  CaseSensitive,
  ChevronLeft,
  ChevronRight,
  Regex,
  Replace,
  ReplaceAll,
  WholeWord,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON_MD, ICON_SM } from "@/utils/iconSizes";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { ImeCompositionResult } from "@/hooks/useImeComposition";

interface FindBarFieldProps {
  inputRef: RefObject<HTMLInputElement | null>;
  icon: ReactNode;
  placeholder: string;
  /** WI-2.4 (a11y) — an explicit accessible name; a placeholder is not one. */
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  ime: ImeCompositionResult;
}

/** One of the bar's two text fields — icon, input, IME composition handlers. */
export function FindBarField({
  inputRef,
  icon,
  placeholder,
  label,
  value,
  onChange,
  onKeyDown,
  ime,
}: FindBarFieldProps) {
  return (
    <div className="find-bar-input-group">
      {icon}
      <input
        ref={inputRef}
        type="text"
        className="find-bar-input"
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
      />
    </div>
  );
}

interface ToggleProps {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}

function FindBarToggle({ active, label, onClick, children }: ToggleProps) {
  return (
    <button
      type="button"
      className={`find-bar-toggle ${active ? "active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

/** Regex (settings-gated), case-sensitivity and whole-word mode toggles. */
export function FindBarToggles() {
  const { t } = useTranslation("editor");
  const caseSensitive = useUIStore((state) => state.search.caseSensitive);
  const wholeWord = useUIStore((state) => state.search.wholeWord);
  const useRegex = useUIStore((state) => state.search.useRegex);
  /* v8 ignore next -- @preserve ?? fallback: enableRegexSearch is always set in tests */
  const enableRegexSearch = useSettingsStore((state) => state.markdown.enableRegexSearch ?? true);

  // Turning the setting off only HID the toggle, so a query already in regex
  // mode kept being matched as a pattern with no visible way to stop it — the
  // user's `a.b` silently matched `axb` in a build that says it does no regex
  // search (audit R2, #597). The setting owns the mode, not just its button.
  useEffect(() => {
    if (!enableRegexSearch && useRegex) useUIStore.getState().searchToggleRegex();
  }, [enableRegexSearch, useRegex]);

  return (
    <div className="find-bar-toggles">
      {enableRegexSearch && (
        <FindBarToggle
          active={useRegex}
          label={t("findbar.toggleRegex")}
          onClick={() => useUIStore.getState().searchToggleRegex()}
        >
          <Regex size={ICON_MD} />
        </FindBarToggle>
      )}
      <FindBarToggle
        active={caseSensitive}
        label={t("findbar.toggleCase")}
        onClick={() => useUIStore.getState().searchToggleCaseSensitive()}
      >
        <CaseSensitive size={ICON_MD} />
      </FindBarToggle>
      <FindBarToggle
        active={wholeWord}
        label={t("findbar.toggleWholeWord")}
        onClick={() => useUIStore.getState().searchToggleWholeWord()}
      >
        <WholeWord size={ICON_MD} />
      </FindBarToggle>
    </div>
  );
}

interface MatchAwareProps {
  /** The bar has a match to act on — see `hasCurrentMatch` (#302). */
  hasMatches: boolean;
}

/** Previous / "N of M" / next. */
export function FindBarNavigation({ hasMatches, matchDisplay }: MatchAwareProps & { matchDisplay: string }) {
  const { t } = useTranslation("editor");
  return (
    <div className="find-bar-nav">
      <button
        type="button"
        className="vm-icon-btn vm-icon-btn--sm"
        onClick={() => useUIStore.getState().searchFindPrevious()}
        disabled={!hasMatches}
        title={t("findbar.prev")}
        aria-label={t("findbar.prev")}
      >
        <ChevronLeft size={ICON_SM} />
      </button>
      <span className="find-bar-count">{matchDisplay}</span>
      <button
        type="button"
        className="vm-icon-btn vm-icon-btn--sm"
        onClick={() => useUIStore.getState().searchFindNext()}
        disabled={!hasMatches}
        title={t("findbar.next")}
        aria-label={t("findbar.next")}
      >
        <ChevronRight size={ICON_SM} />
      </button>
    </div>
  );
}

/** Replace current / replace all. */
export function FindBarReplaceActions({ hasMatches }: MatchAwareProps) {
  const { t } = useTranslation("editor");
  return (
    <div className="find-bar-replace-actions">
      <button
        type="button"
        className="vm-icon-btn vm-icon-btn--bordered"
        onClick={() => useUIStore.getState().searchReplaceCurrent()}
        disabled={!hasMatches}
        title={t("findbar.replace")}
        aria-label={t("findbar.replace")}
      >
        <Replace size={ICON_SM} />
      </button>
      <button
        type="button"
        className="vm-icon-btn vm-icon-btn--bordered"
        onClick={() => useUIStore.getState().searchReplaceAll()}
        disabled={!hasMatches}
        title={t("findbar.replaceAll")}
        aria-label={t("findbar.replaceAll")}
      >
        <ReplaceAll size={ICON_SM} />
      </button>
    </div>
  );
}
