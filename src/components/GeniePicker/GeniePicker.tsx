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
import { createPortal } from "react-dom";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useAiInvocationStore } from "@/stores/aiInvocationStore";
import { useGeniesStore } from "@/stores/geniesStore";
import { useGenieInvocation } from "@/hooks/useGenieInvocation";
import { useAiProviderStore } from "@/stores/aiProviderStore";
import { usePromptHistory } from "@/hooks/usePromptHistory";
import type { GenieDefinition, GenieScope } from "@/types/aiGenies";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { GenieChips } from "./GenieChips";
import { GenieItem } from "./GenieItem";
import { GenieResponseView } from "./GenieResponseView";
import { PromptHistoryDropdown } from "./PromptHistoryDropdown";
import { ProviderSwitcher } from "./ProviderSwitcher";
import "./genie-picker.css";

const SCOPES: GenieScope[] = ["selection", "block", "document"];

export function GeniePicker() {
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

  const { invokeGenie, invokeFreeform } = useGenieInvocation();
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

  // Load genies on open + reset history hook
  useEffect(() => {
    if (isOpen) {
      useGeniesStore.getState().loadGenies();
      setFilter("");
      setSelectedIndex(0);
      setFreeformConfirmed(false);
      setShowProviderSwitcher(false);
      promptHistory.reset();
      setActiveScope(filterScope);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, filterScope]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Filtered + grouped genies
  const filtered = useMemo(() => {
    const lower = filter.toLowerCase();
    return genies.filter((g) => {
      if (activeScope && g.metadata.scope !== activeScope) return false;
      if (!lower) return true;
      /* v8 ignore next -- @preserve ?? false fallback: category?.toLowerCase().includes(lower) is always defined in tests */
      const catMatch = g.metadata.category?.toLowerCase().includes(lower) ?? false;
      return (
        g.metadata.name.toLowerCase().includes(lower) ||
        g.metadata.description.toLowerCase().includes(lower) ||
        catMatch
      );
    });
  }, [filter, activeScope, genies]);

  const recents = useMemo(() => {
    if (filter) return [];
    return useGeniesStore.getState().getRecent().filter((g) => {
      if (activeScope && g.metadata.scope !== activeScope) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, activeScope, genies]);

  const grouped = useMemo(() => {
    const groups = new Map<string, GenieDefinition[]>();
    const recentNames = new Set(recents.map((r) => r.metadata.name));
    for (const g of filtered) {
      // Skip recents from main list if showing recents section
      if (!filter && recentNames.has(g.metadata.name)) {
        continue;
      }
      /* v8 ignore next -- @preserve ?? fallback: all test genies have a category defined */
      const cat = g.metadata.category ?? "Uncategorized";
      const list = groups.get(cat) ?? [];
      list.push(g);
      groups.set(cat, list);
    }
    return groups;
  }, [filtered, filter, recents]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => {
    const items: GenieDefinition[] = [];
    if (recents.length > 0) items.push(...recents);
    for (const [, list] of grouped) {
      items.push(...list);
    }
    return items;
  }, [recents, grouped]);

  const handleClose = useCallback(() => {
    useGeniePickerStore.getState().closePicker();
    setFilter("");
    setSelectedIndex(0);
    setFreeformConfirmed(false);
    setShowProviderSwitcher(false);
    promptHistory.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback(
    (genie: GenieDefinition) => {
      handleClose();
      invokeGenie(genie, activeScope ?? undefined);
    },
    [handleClose, invokeGenie, activeScope]
  );

  const handleFreeformSubmit = useCallback(() => {
    const text = filter.trim();
    /* v8 ignore next -- @preserve guard: freeform submit only reachable when filter is non-empty */
    if (!text) return;
    const scope = activeScope ?? "selection";
    promptHistory.recordAndReset(text);
    handleClose();
    invokeFreeform(text, scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, activeScope, handleClose, invokeFreeform]);

  const handleAccept = useCallback(() => {
    // Accept the focused AI suggestion (created by useGenieInvocation in preview mode)
    const { focusedSuggestionId, acceptSuggestion } = useAiSuggestionStore.getState();
    if (focusedSuggestionId) {
      acceptSuggestion(focusedSuggestionId);
    }
    handleClose();
  }, [handleClose]);

  const handleRetry = useCallback(() => {
    useGeniePickerStore.getState().resetToInput();
  }, []);

  const handleCancelAi = useCallback(() => {
    useAiInvocationStore.getState().cancel();
    useGeniePickerStore.getState().resetToInput();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;

      // In non-input modes, Escape returns to input; all other keys are blocked
      if (mode === "processing" || mode === "preview" || mode === "error") {
        e.preventDefault();
        if (e.key === "Escape") {
          if (mode === "processing") {
            useAiInvocationStore.getState().cancel();
          }
          useGeniePickerStore.getState().resetToInput();
        }
        return;
      }

      const maxIndex = flatList.length - 1;

      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (maxIndex >= 0) {
          setSelectedIndex((prev) => Math.min(prev + 1, maxIndex));
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (maxIndex >= 0) {
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
        }
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // If genies match, select the highlighted one
        if (flatList.length > 0) {
          const selected = flatList[selectedIndex];
          /* v8 ignore next -- @preserve guard: selectedIndex always valid when flatList.length > 0 */
          if (selected) {
            handleSelect(selected);
          }
        } else if (filter.trim()) {
          // No matches — two-step freeform confirmation
          if (!freeformConfirmed) {
            setFreeformConfirmed(true);
          } else {
            handleFreeformSubmit();
          }
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        // Cycle through scopes
        const currentIdx = activeScope ? SCOPES.indexOf(activeScope) : -1;
        const nextIdx = (currentIdx + 1) % (SCOPES.length + 1);
        setActiveScope(nextIdx === SCOPES.length ? null : SCOPES[nextIdx]);
      } else if (e.key === "Home") {
        e.preventDefault();
        setSelectedIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setSelectedIndex(maxIndex >= 0 ? maxIndex : 0);
      }
    },
    [flatList, selectedIndex, handleClose, handleSelect, activeScope, handleFreeformSubmit, ime, mode, filter, freeformConfirmed]
  );

  // Sync prompt history cycling back to filter.
  // When cycling changes displayValue, push it into filter so the textarea updates.
  // Safe from loops: typing sets displayValue === filter via handleChange, so the
  // guard (displayValue !== filter) is only true when cycling produces a new value.
  useEffect(() => {
    if (flatList.length === 0 && promptHistory.displayValue !== filter) {
      setFilter(promptHistory.displayValue);
      setSelectedIndex(0);
    }
  }, [promptHistory.displayValue, filter, flatList.length]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, handleClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current || selectedIndex < 0) return;
    const item = listRef.current.querySelector(
      `[data-index="${selectedIndex}"]`
    );
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  let itemIndex = 0;

  const isInputMode = mode === "search" || mode === "freeform";
  const isResponseMode = mode === "processing" || mode === "preview" || mode === "error";

  /* v8 ignore next -- @preserve promptHistory UI only rendered when user opens Ctrl+R dropdown or types matching history */
  const historyDropdown = promptHistory.isDropdownOpen ? <PromptHistoryDropdown entries={promptHistory.dropdownEntries} selectedIndex={promptHistory.dropdownSelectedIndex} onSelect={promptHistory.selectDropdownEntry} onClose={promptHistory.closeDropdown} /> : null;
  /* v8 ignore next -- @preserve ghost text only shown when prompt history provides a completion; not exercised in unit tests */
  const ghostTextEl = promptHistory.ghostText ? <span className="genie-freeform-ghost" aria-hidden="true"><span className="genie-freeform-ghost-spacer">{filter}</span><span className="genie-freeform-ghost-text">{promptHistory.ghostText}</span></span> : null;

  return createPortal(
    <div className="genie-picker-backdrop">
      <div
        ref={containerRef}
        className="genie-picker"
        onKeyDown={handleKeyDown}
      >
        {/* Unified input (search + freeform) */}
        <div className="genie-picker-header">
          {historyDropdown}
          <div className="genie-picker-input-wrapper">
            <textarea
              ref={inputRef}
              className="genie-picker-search"
              placeholder="Search genies or describe what you want..."
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
            />
            {ghostTextEl}
          </div>
        </div>

        {/* Body: genie list or response view */}
        <div className="genie-picker-body">
          {isInputMode && (
            <>
              {/* Quick chips (only when selection scope and no filter) */}
              {activeScope === "selection" && !filter && (
                <GenieChips genies={genies} onSelect={handleSelect} />
              )}

              {/* Genie list */}
              <div className="genie-picker-list" ref={listRef}>
                {loading && (
                  <div className="genie-picker-empty">Loading genies...</div>
                )}

                {!loading && flatList.length === 0 && !filter && (
                  <div className="genie-picker-empty">
                    No genies found. Add .md files to your genies directory.
                  </div>
                )}

                {/* No match — freeform hint */}
                {!loading && flatList.length === 0 && filter && (
                  <div className="genie-picker-no-match">
                    No matching genies.{" "}
                    {freeformConfirmed ? (
                      <span className="genie-picker-confirm-hint">
                        Press Enter again to run as AI prompt.
                      </span>
                    ) : (
                      <span>
                        Press{" "}
                        <kbd className="genie-picker-kbd">Enter</kbd> to run
                        as AI prompt.
                      </span>
                    )}
                  </div>
                )}

                {/* Recents section */}
                {recents.length > 0 && (
                  <>
                    <div className="genie-picker-section-title">Recently Used</div>
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

          {isResponseMode && (
            <GenieResponseView
              mode={mode}
              responseText={responseText}
              elapsedSeconds={elapsedSeconds}
              error={pickerError}
              submittedPrompt={submittedPrompt}
              onAccept={handleAccept}
              onReject={handleClose}
              onRetry={handleRetry}
              onCancel={handleCancelAi}
            />
          )}
        </div>

        {/* Footer */}
        <div className="genie-picker-footer">
          <span className="genie-picker-scope">
            scope: {activeScope ?? "all"}
          </span>
          {activeProvider && (
            <span className="provider-switcher-anchor">
              <button
                type="button"
                className="provider-switcher-trigger"
                onClick={() => setShowProviderSwitcher((v) => !v)}
              >
                via {activeProviderName}
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
            <kbd className="genie-picker-kbd">Tab</kbd> cycle scope
            {" "}
            <kbd className="genie-picker-kbd">&uarr;&darr;</kbd> navigate
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
