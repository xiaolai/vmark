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
 *   - Tab accepts ghost text; Escape clears it
 *   - recordAndReset() commits a prompt to history and resets input state
 *
 * @coordinates-with promptHistoryStore.ts — persistent history storage
 * @module hooks/usePromptHistory
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { usePromptHistoryStore } from "@/stores/promptHistoryStore";
import { isImeKeyEvent } from "@/utils/imeGuard";

export interface PromptHistoryResult {
  displayValue: string;
  ghostText: string;
  handleChange(value: string): void;
  handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void;
  recordAndReset(text: string): void;
  reset(): void;
  isDropdownOpen: boolean;
  dropdownEntries: string[];
  dropdownSelectedIndex: number;
  openDropdown(): void;
  closeDropdown(): void;
  selectDropdownEntry(index: number): void;
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

  // Dropdown state (Layer 4)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownSelectedIndex, setDropdownSelectedIndex] = useState(0);

  // Keep a ref for the draft saved when entering cycle mode
  const savedDraftRef = useRef("");

  // Compute display value
  const displayValue =
    cycleIndex !== null && filteredCache[cycleIndex] !== undefined
      ? filteredCache[cycleIndex]
      : draft;

  // Ghost text (Layer 3) — only when not cycling and draft is non-empty
  const ghostText = useMemo(() => {
    if (cycleIndex !== null || !draft || isDropdownOpen) return "";
    const entries = usePromptHistoryStore.getState().entries;
    const lower = draft.toLowerCase();
    const match = entries.find((e) => e.toLowerCase().startsWith(lower));
    if (!match) return "";
    return match.slice(draft.length);
  }, [draft, cycleIndex, isDropdownOpen]);

  // Dropdown entries (Layer 4)
  const dropdownEntries = useMemo(() => {
    if (!isDropdownOpen) return [];
    return usePromptHistoryStore.getState().getFilteredEntries(draft);
  }, [isDropdownOpen, draft]);

  const handleChange = useCallback((value: string) => {
    setDraft(value);
    // Exit cycling on any typing
    setCycleIndex(null);
    setFilteredCache([]);
  }, []);

  const startCycling = useCallback(
    (direction: "up" | "down") => {
      if (cycleIndex === null) {
        // Enter cycling mode
        savedDraftRef.current = draft;
        const filtered = usePromptHistoryStore
          .getState()
          .getFilteredEntries(draft);
        if (filtered.length === 0) return false;
        setFilteredCache(filtered);
        setCycleIndex(0);
        return true;
      }

      // Already cycling
      if (direction === "up") {
        setCycleIndex((prev) =>
          prev !== null ? Math.min(prev + 1, filteredCache.length - 1) : 0
        );
      } else {
        if (cycleIndex === 0) {
          // At oldest → exit cycling, restore original draft
          setCycleIndex(null);
          setFilteredCache([]);
          setDraft(savedDraftRef.current);
        } else {
          setCycleIndex((prev) => (prev !== null ? prev - 1 : null));
        }
      }
      return true;
    },
    [cycleIndex, draft, filteredCache.length]
  );

  const acceptGhostText = useCallback(() => {
    if (!ghostText) return false;
    setDraft(draft + ghostText);
    return true;
  }, [draft, ghostText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isImeKeyEvent(e.nativeEvent) || isComposing?.()) return;
      // Layer 4: Ctrl+R toggles dropdown
      if (e.key === "r" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (isDropdownOpen) {
          setIsDropdownOpen(false);
        } else {
          setIsDropdownOpen(true);
          setDropdownSelectedIndex(0);
        }
        return;
      }

      // Dropdown open — handle navigation
      if (isDropdownOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          setDropdownSelectedIndex((prev) =>
            Math.min(prev + 1, dropdownEntries.length - 1)
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          setDropdownSelectedIndex((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          const entry = dropdownEntries[dropdownSelectedIndex];
          if (entry) {
            setDraft(entry);
            setCycleIndex(null);
            setFilteredCache([]);
          }
          setIsDropdownOpen(false);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setIsDropdownOpen(false);
          return;
        }
        // Other keys — let them through (for typing filter)
        return;
      }

      // Layer 3: Tab accepts ghost text
      if (e.key === "Tab" && ghostText) {
        e.preventDefault();
        e.stopPropagation();
        acceptGhostText();
        return;
      }

      // Layer 3: ArrowRight at end accepts ghost text
      if (e.key === "ArrowRight" && ghostText) {
        const textarea = e.currentTarget;
        if (textarea.selectionStart === textarea.value.length) {
          e.preventDefault();
          e.stopPropagation();
          acceptGhostText();
          return;
        }
      }

      // Layer 1+2: Up/Down cycling
      if (e.key === "ArrowUp") {
        // Multi-line guard: if not cycling and text has newlines, let browser handle
        if (cycleIndex === null && draft.includes("\n")) return;
        const consumed = startCycling("up");
        if (consumed) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        // While cycling, always handle
        if (cycleIndex !== null) {
          e.preventDefault();
          e.stopPropagation();
          startCycling("down");
          return;
        }
        // Not cycling — let browser handle (move cursor)
      }
    },
    [
      cycleIndex,
      draft,
      ghostText,
      isDropdownOpen,
      dropdownEntries,
      dropdownSelectedIndex,
      startCycling,
      acceptGhostText,
      isComposing,
    ]
  );

  const recordAndReset = useCallback((text: string) => {
    usePromptHistoryStore.getState().addEntry(text);
    setDraft("");
    setCycleIndex(null);
    setFilteredCache([]);
    setIsDropdownOpen(false);
  }, []);

  const reset = useCallback(() => {
    setDraft("");
    setCycleIndex(null);
    setFilteredCache([]);
    setIsDropdownOpen(false);
    setDropdownSelectedIndex(0);
  }, []);

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
  };
}
