/**
 * Prompt History Hook
 *
 * Purpose: Encapsulates freeform prompt history interaction for the Genie
 *   input — arrow-key cycling, prefix filtering, ghost text suggestions,
 *   and searchable history dropdown. Accepts an optional isComposing callback
 *   to guard keyDown against post-composition events (IME grace period).
 *
 * Key decisions:
 *   - Four interaction layers: basic cycling → prefix filter → ghost text → dropdown
 *   - Ghost text shows the most recent matching history entry as grayed hint
 *   - Tab accepts ghost text; Escape dismisses it until the next edit — any
 *     edit, even one back to the same text, brings the hint back (#388)
 *   - handleKeyDown walks ordered layer handlers — dropdown toggle, open
 *     dropdown, ghost text, cycling — and the first that claims the key ends
 *     the walk (audit #389)
 *   - Ghost text/dropdown rows derive from a SUBSCRIBED `entries` slice (#386); the selected index is clamped to its rows at BOTH ends — an upper-only clamp let ArrowDown on an empty result pin it at -1 (#387) — and the RAW index is kept inside what the rows can show (#752): an edit resets it and the arrows step the CLAMPED value, because stepping the raw one walked ArrowUp down through positions a shrunk filter no longer has (presses that visibly moved nothing), and re-widening the filter then jumped the highlight back to a row the user had left long ago
 *   - recordAndReset() commits a prompt to history and resets input state
 *   - Cycling and ghost text share ONE match rule, PREFIX, in
 *     `services/promptHistory/promptHistoryCore.ts` (#753). Cycling used to call the store's
 *     SUBSTRING `getFilteredEntries`, so "bar" cycled to "foo bar" while the
 *     hint for that draft showed nothing; the dropdown is a search box and
 *     keeps substring.
 *
 * @coordinates-with services/promptHistory/promptHistoryCore.ts — the pure match/clamp/key rules
 * @coordinates-with stores/aiStore/promptHistory.ts — persistent history storage
 * @module hooks/usePromptHistory
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { usePromptHistoryStore } from "@/stores/aiStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { clampToRows, consume, filterByPrefix, ghostSuffix } from "@/services/promptHistory/promptHistoryCore";
import type { KeyLayer, PromptKeyEvent } from "@/services/promptHistory/promptHistoryCore";

/** Return type of usePromptHistory with display state, ghost text, key handlers, and dropdown controls. */
export interface PromptHistoryResult {
  displayValue: string;
  ghostText: string;
  handleChange(value: string): void;
  handleKeyDown(e: PromptKeyEvent): void;
  recordAndReset(text: string): void;
  reset(): void;
  isDropdownOpen: boolean;
  dropdownEntries: string[];
  dropdownSelectedIndex: number;
  openDropdown(): void;
  closeDropdown(): void;
  selectDropdownEntry(index: number): void;
  /** Forget every recorded prompt and close the dropdown (WI-FL3.5). */
  clearHistory(): void;
}

/**
 * @param isComposing — Optional grace-period guard from useImeComposition.
 *   When provided, handleKeyDown also returns early if isComposing() is true,
 *   catching post-compositionend keydown events on macOS WebKit.
 */
export function usePromptHistory(isComposing?: () => boolean): PromptHistoryResult {
  const [draft, setDraft] = useState("");
  const [cycleIndex, setCycleIndex] = useState<number | null>(null);
  const [filteredCache, setFilteredCache] = useState<string[]>([]);
  // Escape hid the ghost text; the next edit (handleChange) shows it again.
  const [ghostDismissed, setGhostDismissed] = useState(false);

  // Dropdown state (Layer 4)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [rawSelectedIndex, setDropdownSelectedIndex] = useState(0);
  const entries = usePromptHistoryStore((s) => s.entries);

  // Keep a ref for the draft saved when entering cycle mode
  const savedDraftRef = useRef("");

  // Compute display value
  const displayValue =
    cycleIndex !== null && filteredCache[cycleIndex] !== undefined
      ? filteredCache[cycleIndex]
      : draft;

  // Ghost text (Layer 3) — only when not cycling, not dismissed, and draft is non-empty
  const ghostText = useMemo(() => {
    if (cycleIndex !== null || isDropdownOpen || ghostDismissed) return "";
    return ghostSuffix(entries, draft);
  }, [entries, draft, cycleIndex, isDropdownOpen, ghostDismissed]);

  // Dropdown entries (Layer 4): the store owns the filter; `entries` (subscribed, #386) recomputes it.
  const dropdownEntries = useMemo(() => {
    if (!isDropdownOpen || entries.length === 0) return [];
    return usePromptHistoryStore.getState().getFilteredEntries(draft);
  }, [isDropdownOpen, draft, entries]);
  const dropdownSelectedIndex = clampToRows(rawSelectedIndex, dropdownEntries.length);

  const handleChange = useCallback((value: string) => {
    setDraft(value);
    setDropdownSelectedIndex(0); // the rows changed, so the old row is gone (#752)
    setGhostDismissed(false); // any edit brings a dismissed hint back (#388)
    setCycleIndex(null); // and exits cycling, dropping its cache
    setFilteredCache([]);
  }, []);

  const startCycling = useCallback(
    (direction: "up" | "down") => {
      if (cycleIndex === null) {
        // Enter cycling mode. PREFIX matching (#753) — the same rule the ghost
        // hint uses, so the hint can never advertise a completion cycling
        // refuses to produce.
        savedDraftRef.current = draft;
        const filtered = filterByPrefix(entries, draft);
        if (filtered.length === 0) return false;
        setFilteredCache(filtered);
        setCycleIndex(0);
        return true;
      }

      // Already cycling
      if (direction === "up") {
        setCycleIndex((prev) =>
          /* v8 ignore next -- prev is always non-null here (cycleIndex was checked above) */
          prev !== null ? Math.min(prev + 1, filteredCache.length - 1) : 0
        );
      } else {
        if (cycleIndex === 0) {
          // At the NEWEST entry (#754): the store is MRU, so index 0 is the most
          // recent match and ArrowUp walks toward older ones. One more step
          // back leaves history → restore the original draft.
          setCycleIndex(null);
          setFilteredCache([]);
          setDraft(savedDraftRef.current);
        } else {
          /* v8 ignore start -- prev is always non-null here (cycleIndex > 0 was checked) */
          setCycleIndex((prev) => (prev !== null ? prev - 1 : null));
          /* v8 ignore stop */
        }
      }
      return true;
    },
    [cycleIndex, draft, entries, filteredCache.length]
  );

  const acceptGhostText = useCallback(() => {
    /* v8 ignore start -- ghostText being null/empty is guarded in the rendering layer; false branch is a safety net */
    if (!ghostText) return false;
    /* v8 ignore stop */
    setDraft(draft + ghostText);
    return true;
  }, [draft, ghostText]);

  const openDropdown = useCallback(() => {
    setIsDropdownOpen(true);
    setDropdownSelectedIndex(0);
  }, []);

  const closeDropdown = useCallback(() => {
    setIsDropdownOpen(false);
  }, []);

  const selectDropdownEntry = useCallback(
    (index: number) => {
      const entry = dropdownEntries[index];
      if (entry) {
        setDraft(entry);
        setCycleIndex(null);
        setFilteredCache([]);
      }
      setIsDropdownOpen(false);
    },
    [dropdownEntries]
  );

  // Layer 4: Ctrl/Cmd+R toggles the dropdown.
  const dropdownToggleLayer = useCallback<KeyLayer>(
    (e) => {
      if (e.key !== "r" || !(e.ctrlKey || e.metaKey)) return false;
      consume(e);
      if (isDropdownOpen) closeDropdown();
      else openDropdown();
      return true;
    },
    [isDropdownOpen, openDropdown, closeDropdown]
  );

  // Layer 4, dropdown open: arrows move, Enter selects, Escape closes. Every
  // other key is claimed too — it types into the filter through onChange and
  // must not reach the ghost-text or cycling layers.
  const dropdownLayer = useCallback<KeyLayer>(
    (e) => {
      if (!isDropdownOpen) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        consume(e);
        // Clamped index as the step base, never the raw one (#752, header):
        const next = dropdownSelectedIndex + (e.key === "ArrowDown" ? 1 : -1);
        setDropdownSelectedIndex(clampToRows(next, dropdownEntries.length));
      } else if (e.key === "Enter") {
        consume(e);
        selectDropdownEntry(dropdownSelectedIndex);
      } else if (e.key === "Escape") {
        consume(e);
        setIsDropdownOpen(false);
      }
      return true;
    },
    [isDropdownOpen, dropdownEntries.length, dropdownSelectedIndex, selectDropdownEntry]
  );

  // Layer 3: Tab, or ArrowRight at the end of the text, accepts the ghost
  // text; Escape dismisses it until the next edit (#388).
  const ghostTextLayer = useCallback<KeyLayer>(
    (e) => {
      if (!ghostText) return false;
      if (e.key === "Escape") {
        consume(e);
        setGhostDismissed(true);
        return true;
      }
      const accepts =
        e.key === "Tab" ||
        (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length);
      if (!accepts) return false;
      consume(e);
      acceptGhostText();
      return true;
    },
    [ghostText, acceptGhostText]
  );

  // Layers 1+2: ArrowUp enters or advances cycling — except in a multi-line
  // draft that is not cycling yet, where the caret keys stay with the browser.
  // ArrowDown retreats while cycling and is otherwise the browser's.
  const cyclingLayer = useCallback<KeyLayer>(
    (e) => {
      if (e.key === "ArrowUp") {
        if (cycleIndex === null && draft.includes("\n")) return false;
        const consumed = startCycling("up");
        if (consumed) consume(e);
        return consumed;
      }
      if (e.key === "ArrowDown" && cycleIndex !== null) {
        consume(e);
        startCycling("down");
        return true;
      }
      return false;
    },
    [cycleIndex, draft, startCycling]
  );

  const handleKeyDown = useCallback(
    (e: PromptKeyEvent) => {
      if (isImeKeyEvent(e.nativeEvent) || isComposing?.()) return;
      for (const layer of [dropdownToggleLayer, dropdownLayer, ghostTextLayer, cyclingLayer]) {
        if (layer(e)) return;
      }
    },
    [isComposing, dropdownToggleLayer, dropdownLayer, ghostTextLayer, cyclingLayer]
  );

  /** Leave cycling and close the dropdown — where every "done with history" path ends. */
  const leaveHistory = useCallback(() => {
    setCycleIndex(null);
    setFilteredCache([]);
    setIsDropdownOpen(false);
  }, []);

  const recordAndReset = useCallback((text: string) => {
    usePromptHistoryStore.getState().addEntry(text);
    setDraft("");
    leaveHistory();
  }, [leaveHistory]);

  const reset = useCallback(() => {
    setDraft("");
    setDropdownSelectedIndex(0);
    leaveHistory();
  }, [leaveHistory]);

  // `dropdownEntries` is memoised on the open state, so close it rather than keep stale rows.
  const clearHistory = useCallback(() => {
    usePromptHistoryStore.getState().clearHistory();
    leaveHistory();
  }, [leaveHistory]);

  return {
    displayValue,
    ghostText,
    handleChange,
    handleKeyDown,
    recordAndReset,
    reset,
    isDropdownOpen,
    dropdownEntries,
    dropdownSelectedIndex,
    openDropdown,
    closeDropdown,
    selectDropdownEntry,
    clearHistory,
  };
}
