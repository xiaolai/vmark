/**
 * Genie Picker
 *
 * Spotlight-style centered overlay for browsing and invoking AI genies.
 * Opens via Cmd+Y, supports keyboard navigation, search, and freeform input.
 * Freeform textarea supports prompt history (Up/Down cycling, ghost text, Ctrl+R dropdown).
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
import { useGeniesStore } from "@/stores/geniesStore";
import { useGenieInvocation } from "@/hooks/useGenieInvocation";
import { useAiProviderStore } from "@/stores/aiProviderStore";
import { usePromptHistory } from "@/hooks/usePromptHistory";
import type { GenieDefinition, GenieScope } from "@/types/aiGenies";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import { GenieChips } from "./GenieChips";
import { GenieItem } from "./GenieItem";
import { PromptHistoryDropdown } from "./PromptHistoryDropdown";
import { ProviderSwitcher } from "./ProviderSwitcher";
import "./genie-picker.css";

const SCOPES: GenieScope[] = ["selection", "block", "document"];

export function GeniePicker() {
  const isOpen = useGeniePickerStore((s) => s.isOpen);
  const filterScope = useGeniePickerStore((s) => s.filterScope);

  const genies = useGeniesStore((s) => s.genies);
  const loading = useGeniesStore((s) => s.loading);

  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeScope, setActiveScope] = useState<GenieScope | null>(null);
  const [showProviderSwitcher, setShowProviderSwitcher] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const freeformRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { invokeGenie, invokeFreeform, isRunning } = useGenieInvocation();
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
      return (
        g.metadata.name.toLowerCase().includes(lower) ||
        g.metadata.description.toLowerCase().includes(lower) ||
        (g.metadata.category?.toLowerCase().includes(lower) ?? false)
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
    for (const g of filtered) {
      // Skip recents from main list if showing recents section
      if (!filter && recents.some((r) => r.metadata.name === g.metadata.name)) {
        continue;
      }
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
    const text = promptHistory.displayValue.trim();
    if (!text) return;
    const scope = activeScope ?? "selection";
    promptHistory.recordAndReset(text);
    handleClose();
    invokeFreeform(text, scope);
  }, [promptHistory, activeScope, handleClose, invokeFreeform]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;
      // If freeform is focused, let the hook handle ArrowUp/ArrowDown/Tab/Escape
      // (the hook calls stopPropagation when it consumes the key)
      if (document.activeElement === freeformRef.current) {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") return;
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
        // Check if freeform textarea is focused
        if (document.activeElement === freeformRef.current) {
          e.preventDefault();
          handleFreeformSubmit();
          return;
        }
        e.preventDefault();
        const selected = flatList[selectedIndex];
        if (selected) {
          handleSelect(selected);
        }
      } else if (e.key === "Tab") {
        // If freeform consumed Tab for ghost text, it already stopPropagated
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
    [flatList, selectedIndex, handleClose, handleSelect, activeScope, handleFreeformSubmit, ime]
  );

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

  return createPortal(
    <div className="genie-picker-backdrop">
      <div
        ref={containerRef}
        className="genie-picker"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="genie-picker-header">
          <input
            ref={inputRef}
            className="genie-picker-search"
            type="text"
            placeholder="Search genies..."
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelectedIndex(0);
            }}
            onFocus={() => setSelectedIndex(0)}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
          />
        </div>

        {/* Quick chips (only when selection scope) */}
        {activeScope === "selection" && (
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

          {!loading && flatList.length === 0 && filter && (
            <div className="genie-picker-empty">
              No matching genies for &ldquo;{filter}&rdquo;
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

        {/* Freeform input with ghost text + history dropdown */}
        <div className="genie-picker-freeform">
          {/* History dropdown (Layer 4) */}
          {promptHistory.isDropdownOpen && (
            <PromptHistoryDropdown
              entries={promptHistory.dropdownEntries}
              selectedIndex={promptHistory.dropdownSelectedIndex}
              onSelect={promptHistory.selectDropdownEntry}
              onClose={promptHistory.closeDropdown}
            />
          )}
          <div className="genie-freeform-ghost-wrapper">
            <textarea
              ref={freeformRef}
              className="genie-picker-freeform-input"
              placeholder="Describe what you want..."
              value={promptHistory.displayValue}
              onChange={(e) => promptHistory.handleChange(e.target.value)}
              onKeyDown={promptHistory.handleKeyDown}
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
              onFocus={() => setSelectedIndex(-1)}
              rows={1}
            />
            {/* Ghost text overlay (Layer 3) */}
            {promptHistory.ghostText && (
              <span className="genie-freeform-ghost" aria-hidden="true">
                <span className="genie-freeform-ghost-spacer">
                  {promptHistory.displayValue}
                </span>
                <span className="genie-freeform-ghost-text">
                  {promptHistory.ghostText}
                </span>
              </span>
            )}
          </div>
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
          {isRunning && (
            <span className="genie-picker-running">Running...</span>
          )}
          <span className="genie-picker-hint">
            <kbd className="genie-picker-kbd">Tab</kbd> cycle scope
            {" "}
            <kbd className="genie-picker-kbd">&uarr;&darr;</kbd> history
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
