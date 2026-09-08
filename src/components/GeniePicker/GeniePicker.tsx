/**
 * Genie Picker
 *
 * Spotlight-style centered overlay for browsing and invoking AI genies.
 * Opens via Cmd+Y, supports keyboard navigation, search, and freeform input.
 *
 * Uses a single unified textarea that doubles as search (when genies match)
 * and freeform prompt input (when no matches). Two-step Enter confirmation
 * for freeform: first Enter shows hint, second Enter submits.
 *
 * Integrates mode state machine from geniePickerStore to show inline
 * GenieResponseView for processing/preview/error states.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useQuickOpenStore } from "@/stores/quickOpenStore";
import { useAiInvocationStore, useGeniesStore } from "@/stores/aiStore";
import { useGenieInvocation } from "@/hooks/useGenieInvocation";
import { useAiProviderStore } from "@/stores/aiStore";
import { usePromptHistory } from "@/hooks/usePromptHistory";
import type { GenieDefinition, GenieScope } from "@/types/aiGenies";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";
import { useInvocationSession, useResponseActions } from "./useInvocationSession";
import { GenieChips } from "./GenieChips";
import { GenieItem } from "./GenieItem";
import { GenieResponseView } from "./GenieResponseView";
import { PromptHistoryDropdown } from "./PromptHistoryDropdown";
import { ProviderSwitcher } from "./ProviderSwitcher";
import { isResponseMode, settleInvocation } from "./invocationLifecycle";
import { buildGenieList, filterGenies, genieQuery, recentGeniesOf, scopedRecents } from "./genieListDerivation";
import { inputModeIntent, nextScope, nextSelectedIndex } from "./geniePickerKeys";
import "./genie-picker.css";
import { geniesWarn, genieWarn } from "@/utils/debug";

/** Spotlight-style overlay for browsing, searching, and invoking AI genies or freeform prompts. */
export function GeniePicker() {
  const { t } = useTranslation("ai");
  const isOpen = useGeniePickerStore((s) => s.isOpen);
  const filterScope = useGeniePickerStore((s) => s.filterScope);
  const mode = useGeniePickerStore((s) => s.mode);
  const responseText = useGeniePickerStore((s) => s.responseText);
  const pickerError = useGeniePickerStore((s) => s.pickerError);
  const submittedPrompt = useGeniePickerStore((s) => s.submittedPrompt);

  const elapsedSeconds = useAiInvocationStore((s) => s.elapsedSeconds);

  const genies = useGeniesStore((s) => s.genies);
  const loading = useGeniesStore((s) => s.loading);

  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeScope, setActiveScope] = useState<GenieScope | null>(null);
  const [showProviderSwitcher, setShowProviderSwitcher] = useState(false);
  const [freeformConfirmed, setFreeformConfirmed] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  // Which open of the picker this is, and which suggestion it created (R2 #610/#611).
  const session = useInvocationSession(isOpen);

  const { invokeGenie, invokeFreeform, cancel: cancelInvocation } = useGenieInvocation();
  const activeProvider = useAiProviderStore((s) => s.activeProvider);
  const activeProviderName = useAiProviderStore((s) => {
    if (!s.activeProvider) return null;
    return (
      s.cliProviders.find((p) => p.type === s.activeProvider)?.name ??
      s.restProviders.find((p) => p.type === s.activeProvider)?.name ??
      s.activeProvider
    );
  });
  const ime = useImeComposition();

  // Prompt history hook (pass grace-period guard for freeform keyDown)
  const promptHistory = usePromptHistory(ime.isComposing);

  // Reset the input surface without closing: the store stays open so the response view can take over (#309/#310).
  const resetInput = useCallback(() => {
    setFilter("");
    setSelectedIndex(0);
    setFreeformConfirmed(false);
    setShowProviderSwitcher(false);
    promptHistory.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The focus HAND-OFF belongs to the open/close transition alone (audit R3
  // #604). Keyed on `[isOpen, filterScope]`, re-opening at a different scope
  // while already open re-captured `document.activeElement` — by then the
  // picker's OWN textarea — so the eventual close "restored" focus to a
  // detached element and lost the user's place.
  useEffect(() => {
    /* v8 ignore next -- @preserve reason: false branch (close path with focus restore) untestable in jsdom */
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      return;
    }
    /* v8 ignore start -- @preserve reason: restoring focus to previous element requires real DOM focus tracking; untestable in jsdom */
    if (previousFocusRef.current) {
      const el = previousFocusRef.current as HTMLElement;
      if (typeof el.focus === "function") el.focus();
      previousFocusRef.current = null;
    }
    /* v8 ignore stop */
  }, [isOpen]);

  // Opening — including opening AGAIN at a different scope, which is a fresh
  // request and does reset the surface. The five resets are `resetInput()`
  // rather than five more setState calls (#606): the same reset was written
  // twice here and in `resetInput`, and the copies were free to drift.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOpen) return;
    useQuickOpenStore.getState().close();
    // A backstop, not the error path: `loadGenies` catches its own failure and
    // reports it as an empty list (#605 — surfacing it properly needs the store
    // to carry an error, which it does not).
    void Promise.resolve(useGeniesStore.getState().loadGenies()).catch((e) => geniesWarn("Failed to load genies:", e));
    resetInput();
    setActiveScope(filterScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, filterScope]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Focus search input on open
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // ONE trimmed query drives the search, the recents section, the no-match hint
  // and the freeform submission (#621). They used to disagree: search and hint
  // read the raw value while submission trimmed it, so whitespace alone hid
  // every genie behind a hint whose Enter did nothing.
  const query = genieQuery(filter);

  // ONE statement of the match rule (#607). It used to be written out here and
  // again in the store's `searchGenies`, which this file already imports;
  // `genieListDerivation.test.ts` now asserts the two agree.
  const matches = useMemo(
    () => filterGenies(genies, query, activeScope),
    [genies, query, activeScope],
  );

  // SUBSCRIBED to the recent NAMES (#608): `addRecent` writes that list and
  // leaves `genies` alone, so a hook that only watched `genies` went on showing
  // the previous order until something else happened to reload.
  const recentNames = useGeniesStore((s) => s.recentGenieNames);
  const recents = useMemo(
    () => scopedRecents(recentGeniesOf(genies, recentNames), activeScope, query),
    [genies, recentNames, activeScope, query],
  );

  const { grouped, flat: flatList } = useMemo(
    () => buildGenieList(matches, recents, t("picker.uncategorized")),
    [matches, recents, t],
  );

  // Clamp selectedIndex when flatList shrinks — adjusted during render, not in an effect (#1063).
  if (flatList.length > 0 && selectedIndex >= flatList.length) {
    setSelectedIndex(flatList.length - 1);
  }

  const handleClose = useCallback(() => { useGeniePickerStore.getState().closePicker(); resetInput(); }, [resetInput]);

  const handleSelect = useCallback((genie: GenieDefinition) => {
    resetInput();
    void settleInvocation(() => invokeGenie(genie, activeScope ?? undefined), (e) => genieWarn("Genie invocation failed:", e), session.claim());
  }, [resetInput, invokeGenie, activeScope, session]);

  const handleFreeformSubmit = useCallback(() => {
    const text = genieQuery(filter);
    /* v8 ignore next -- @preserve guard: freeform submit only reachable when filter is non-empty */
    if (!text) return;
    const scope = activeScope ?? "selection";
    promptHistory.recordAndReset(text);
    resetInput();
    void settleInvocation(() => invokeFreeform(text, scope), (e) => genieWarn("Freeform genie invocation failed:", e), session.claim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, activeScope, resetInput, invokeFreeform, session]);

  // Every exit from a response mode (audit R2, #611/#612/#613/#618/#622).
  const { handleAccept, handleRetry, handleRejectPreview, handleCancelAi, handleDismiss } = useResponseActions(mode, session, cancelInvocation, handleClose);

  /**
   * Enter in input mode: run the highlighted genie, or take the two-step
   * freeform path.
   *
   * Nothing is submitted while the genies are still LOADING (#616). An empty
   * list during a load is not "no genie matches" — it is "we do not know yet" —
   * and the picker used to accept the text as a freeform prompt even when the
   * list about to arrive held a genie for exactly that query.
   */
  const submitSelection = useCallback(() => {
    if (flatList.length > 0) {
      const selected = flatList[selectedIndex];
      /* v8 ignore next -- @preserve guard: selectedIndex always valid when flatList.length > 0 */
      if (selected) handleSelect(selected);
      return;
    }
    if (loading || query === "") return;
    if (!freeformConfirmed) setFreeformConfirmed(true);
    else handleFreeformSubmit();
  }, [flatList, selectedIndex, handleSelect, loading, query, freeformConfirmed, handleFreeformSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;

      // A CONTROL inside the dialog owns its own keys: `preventDefault` on
      // keydown cancels a button's CLICK, so Enter/Space on the provider and
      // response buttons did nothing, and Tab there cycled the scope instead of
      // moving focus. Escape stays the dialog's (audit R2, #615).
      const target = e.target;
      const fromControl =
        target instanceof HTMLElement &&
        target !== inputRef.current &&
        target.closest("button, a[href], [role='menuitem']") !== null;
      if (fromControl && e.key !== "Escape") return;

      // In non-input modes, Escape returns to input; all other keys are blocked
      if (mode === "processing" || mode === "preview" || mode === "error") {
        // A MODIFIED key is not typing: swallowing Cmd+C stopped the user
        // copying the answer the picker had just produced (audit R2, #615).
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        if (e.key === "Escape") {
          if (mode === "processing") cancelInvocation();
          else session.rejectSuggestion();
          useGeniePickerStore.getState().resetToInput();
        }
        return;
      }

      // The key TABLE decides the meaning; this decides what to do about it
      // (#614). The eight-arm `else if` chain and the wrap-around arithmetic it
      // carried now live in `geniePickerKeys.ts`, where they are checkable.
      const intent = inputModeIntent(e.key, e.shiftKey);
      if (intent === null) return;
      e.preventDefault();

      if (intent === "close") {
        handleClose();
      } else if (intent === "cycle-scope") {
        setActiveScope(nextScope(activeScope));
      } else if (intent === "submit") {
        submitSelection();
      } else {
        setSelectedIndex((prev) => nextSelectedIndex(prev, intent, flatList.length));
      }
    },
    [flatList.length, handleClose, activeScope, submitSelection, ime, mode, cancelInvocation, session]
  );

  // Sync prompt-history cycling back to filter so the textarea updates. Reacts to
  // external history state (#1063); loop-safe — typing sets displayValue === filter
  // via handleChange, so the guard is true only when cycling produces a new value.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (flatList.length === 0 && promptHistory.displayValue !== filter) {
      setFilter(promptHistory.displayValue);
      setSelectedIndex(0);
      // The prompt on screen is no longer the one the user confirmed (#617).
      // Without this, cycling history after one confirmation submitted the
      // REPLACEMENT prompt on its first Enter, with no second-Enter step.
      setFreeformConfirmed(false);
    }
  }, [promptHistory.displayValue, filter, flatList.length]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Click outside to close (Escape is handled by the mode-aware onKeyDown, so only
  // the outside-click half is delegated). Deferred attach prevents the opening click
  // from immediately dismissing; bubble phase matches the original code.
  useDismissOnOutsideOrEscape(isOpen, containerRef, handleDismiss, {
    deferActivation: true,
    escape: false,
    capture: false,
  });

  // Scroll the selected item into view — on a list change as well as an index
  // change (#619). Scoping or filtering replaces the list while the index stays
  // put, and the newly-selected row was left off screen.
  useEffect(() => {
    if (!listRef.current || selectedIndex < 0) return;
    const item = listRef.current.querySelector(
      `[data-index="${selectedIndex}"]`
    );
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, flatList]);

  if (!isOpen) return null;

  let itemIndex = 0;

  const isInputMode = mode === "search" || mode === "freeform";
  const inResponseMode = isResponseMode(mode);

  const historyDropdown = promptHistory.isDropdownOpen ? <PromptHistoryDropdown entries={promptHistory.dropdownEntries} selectedIndex={promptHistory.dropdownSelectedIndex} onSelect={promptHistory.selectDropdownEntry} onClose={promptHistory.closeDropdown} clearHistory={promptHistory.clearHistory} /> : null;
  const ghostTextEl = promptHistory.ghostText ? <span className="genie-freeform-ghost" aria-hidden="true"><span className="genie-freeform-ghost-spacer">{filter}</span><span className="genie-freeform-ghost-text">{promptHistory.ghostText}</span></span> : null;

  return createPortal(
    <div className="vm-overlay vm-overlay--top genie-picker-backdrop">
      <div
        ref={containerRef}
        className="vm-overlay__panel genie-picker"
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={t("picker.ariaLabel")}
      >
        {/* Unified input (search + freeform) */}
        <div className="genie-picker-header">
          {historyDropdown}
          <div className="genie-picker-input-wrapper">
            <textarea
              ref={inputRef}
              className="genie-picker-search"
              placeholder={t("picker.searchPlaceholder")}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setSelectedIndex(0);
                setFreeformConfirmed(false);
                promptHistory.handleChange(e.target.value);
              }}
              onKeyDown={(e) => {
                if (isInputMode && flatList.length === 0) {
                  promptHistory.handleKeyDown(e);
                }
              }}
              onFocus={() => setSelectedIndex(0)}
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
              rows={1}
              role={/* #620: response mode renders no listbox to control */ isInputMode ? "combobox" : undefined}
              aria-expanded={isInputMode ? flatList.length > 0 || promptHistory.isDropdownOpen : undefined}
              aria-controls={isInputMode ? "genie-picker-list" : undefined}
              aria-activedescendant={isInputMode && flatList.length > 0 && selectedIndex >= 0 ? `genie-item-${selectedIndex}` : undefined}
            />
            {ghostTextEl}
          </div>
        </div>

        {/* Body: genie list or response view */}
        <div className="genie-picker-body">
          {isInputMode && (
            <>
              {/* Quick chips (only when selection scope and no filter) */}
              {activeScope === "selection" && query === "" && (
                <GenieChips genies={genies} onSelect={handleSelect} />
              )}

              {/* Genie list */}
              <div className="vm-scroll--thin genie-picker-list" ref={listRef} id="genie-picker-list" role="listbox">
                {loading && (
                  <div className="genie-picker-empty">{t("picker.loading")}</div>
                )}

                {!loading && flatList.length === 0 && query === "" && (
                  <div className="genie-picker-empty">
                    {t("picker.empty")}
                  </div>
                )}

                {/* No match — freeform hint. Gated on the TRIMMED query, the
                    same value submission uses: a whitespace-only prompt used to
                    show an actionable hint whose Enter did nothing (#621). */}
                {!loading && flatList.length === 0 && query !== "" && (
                  <div className="genie-picker-no-match">
                    {t("picker.noMatch")}{" "}
                    {freeformConfirmed ? (
                      <span className="genie-picker-confirm-hint">
                        {t("picker.freeformConfirm")}
                      </span>
                    ) : (
                      <span>
                        {t("picker.freeformHintPrefix")}{" "}
                        <kbd className="vm-overlay__kbd">Enter</kbd>{" "}
                        {t("picker.freeformHintSuffix")}
                      </span>
                    )}
                  </div>
                )}

                {/* Recents section */}
                {recents.length > 0 && (
                  <>
                    <div className="genie-picker-section-title">{t("picker.recentlyUsed")}</div>
                    {recents.map((genie) => {
                      const idx = itemIndex++;
                      return (
                        <GenieItem
                          key={`recent-${genie.metadata.name}`}
                          genie={genie}
                          index={idx}
                          selected={selectedIndex >= 0 && idx === selectedIndex}
                          onSelect={handleSelect}
                          onHover={setSelectedIndex}
                        />
                      );
                    })}
                  </>
                )}

                {/* Category sections */}
                {Array.from(grouped.entries()).map(([category, list]) => (
                  <div key={category}>
                    <div className="genie-picker-section-title">{category}</div>
                    {list.map((genie) => {
                      const idx = itemIndex++;
                      return (
                        <GenieItem
                          key={genie.filePath}
                          genie={genie}
                          index={idx}
                          selected={selectedIndex >= 0 && idx === selectedIndex}
                          onSelect={handleSelect}
                          onHover={setSelectedIndex}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}

          {inResponseMode && (
            <GenieResponseView
              mode={mode}
              responseText={responseText}
              elapsedSeconds={elapsedSeconds}
              error={pickerError}
              submittedPrompt={submittedPrompt}
              onAccept={handleAccept}
              onReject={handleRejectPreview}
              onRetry={handleRetry}
              onCancel={handleCancelAi}
            />
          )}
        </div>

        {/* Footer */}
        <div className="vm-overlay__footer genie-picker-footer">
          <span className="genie-picker-scope">
            {t("picker.scopeLabel", { scope: activeScope ?? "all" })}
          </span>
          {activeProvider && (
            <span className="provider-switcher-anchor">
              <button
                type="button"
                className="provider-switcher-trigger"
                aria-haspopup="menu"
                aria-expanded={showProviderSwitcher}
                onClick={() => setShowProviderSwitcher((v) => !v)}
              >
                {t("picker.via", { name: activeProviderName })}
              </button>
              {showProviderSwitcher && (
                <ProviderSwitcher
                  onClose={() => setShowProviderSwitcher(false)}
                  onCloseAll={handleClose}
                />
              )}
            </span>
          )}
          <span className="genie-picker-hint">
            <kbd className="vm-overlay__kbd">Tab</kbd> {t("picker.footerCycleScope")}
            {" "}
            <kbd className="vm-overlay__kbd">&uarr;&darr;</kbd> {t("picker.footerNavigate")}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
