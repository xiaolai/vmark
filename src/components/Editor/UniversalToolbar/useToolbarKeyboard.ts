/**
 * useToolbarKeyboard - Keyboard navigation hook
 *
 * Handles keyboard events for the universal toolbar.
 * Implements roving tabindex pattern with group navigation.
 *
 * @module components/Editor/UniversalToolbar/useToolbarKeyboard
 */
import { useCallback, useRef, useEffect, useState } from "react";
import { useUIStore } from "@/stores/uiStore";
import {
  getNextFocusableIndex,
  getPrevFocusableIndex,
  getFirstFocusableIndex,
  getLastFocusableIndex,
  getNextGroupFirstFocusableIndex,
  getPrevGroupLastFocusableIndex,
  getNextFocusableIndexInGroup,
  getPrevFocusableIndexInGroup,
} from "./toolbarNavigation";

interface UseToolbarKeyboardOptions {
  /** Total number of buttons in the toolbar */
  buttonCount: number;
  /** Whether a button is focusable (enabled) */
  isButtonFocusable: (index: number) => boolean;
  /** Optional external ref for the toolbar container */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** Whether focus should be managed by the toolbar */
  focusMode: boolean;
  /** Callback when a button should be activated */
  onActivate: (index: number) => void;
  /** Callback when a dropdown should open */
  onOpenDropdown?: (index: number) => boolean;
  /** Callback when toolbar should close */
  onClose?: () => void;
}

interface UseToolbarKeyboardReturn {
  /** Current focused button index (roving tabindex) */
  focusedIndex: number;
  /** Set the focused index */
  setFocusedIndex: (index: number) => void;
  /** Ref to attach to the toolbar container */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Handle keydown events */
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * Hook for toolbar keyboard navigation.
 *
 * Implements:
 * - Tab/Shift+Tab: Cycle through buttons
 * - Left/Right: Move within group
 * - Ctrl+Left/Right (Option on Mac): Jump between groups
 * - Home/End: Jump to first/last button
 * - Enter/Space: Activate button
 * - Escape: Close toolbar
 *
 * @param options - Configuration options
 * @returns Keyboard handling state and handlers
 */
export function useToolbarKeyboard(
  options: UseToolbarKeyboardOptions
): UseToolbarKeyboardReturn {
  const {
    buttonCount,
    isButtonFocusable,
    onActivate,
    onOpenDropdown,
    onClose,
    containerRef: externalRef,
    focusMode,
  } = options;
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = externalRef ?? internalRef;

  // Get initial focus from store (persisted across opens)
  const lastFocusedIndex = useUIStore((state) => state.lastFocusedToolbarIndex);
  const [focusedIndex, setFocusedIndexState] = useState(() =>
    Math.min(lastFocusedIndex, buttonCount - 1)
  );

  // Persist focus index to store
  const setFocusedIndex = useCallback((index: number) => {
    setFocusedIndexState(index);
    useUIStore.getState().setLastFocusedToolbarIndex(index);
  }, []);

  // Close toolbar action
  const closeToolbar = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    useUIStore.getState().setUniversalToolbarVisible(false);
  }, [onClose]);

  // Move focus to a button
  const focusButton = useCallback((index: number) => {
    setFocusedIndex(index);
    const container = containerRef.current;
    if (!container) return;

    const buttons = container.querySelectorAll<HTMLButtonElement>(".universal-toolbar-btn");
    const targetIndex = Math.min(index, buttons.length - 1);
    if (buttons[targetIndex]) {
      buttons[targetIndex].focus();
    }
  }, [setFocusedIndex, containerRef]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Prevent Cmd+A from selecting all page content when focus is on toolbar buttons
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        return;
      }

      const current = focusedIndex;
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const groupModifier = isMac ? e.altKey : e.ctrlKey;

      switch (e.key) {
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            focusButton(getPrevFocusableIndex(current, buttonCount, isButtonFocusable));
          } else {
            focusButton(getNextFocusableIndex(current, buttonCount, isButtonFocusable));
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (groupModifier) {
            focusButton(getNextGroupFirstFocusableIndex(current, isButtonFocusable));
          } else {
            focusButton(getNextFocusableIndexInGroup(current, isButtonFocusable));
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (groupModifier) {
            focusButton(getPrevGroupLastFocusableIndex(current, isButtonFocusable));
          } else {
            focusButton(getPrevFocusableIndexInGroup(current, isButtonFocusable));
          }
          break;

        case "ArrowDown":
          if (onOpenDropdown) {
            const opened = onOpenDropdown(current);
            if (opened) {
              e.preventDefault();
            }
          }
          break;

        case "Home":
          e.preventDefault();
          focusButton(getFirstFocusableIndex(buttonCount, isButtonFocusable));
          break;

        case "End":
          e.preventDefault();
          focusButton(getLastFocusableIndex(buttonCount, isButtonFocusable));
          break;

        case "Enter":
        case " ":
          e.preventDefault();
          if (isButtonFocusable(current)) {
            onActivate(current);
          }
          break;

        case "Escape":
          e.preventDefault();
          closeToolbar();
          break;
      }
    },
    [buttonCount, focusButton, focusedIndex, onActivate, closeToolbar, isButtonFocusable, onOpenDropdown]
  );

  // Focus button when toolbar opens
  useEffect(() => {
    if (!focusMode) return;
    const container = containerRef.current;
    if (!container) return;
    const activeElement = document.activeElement as HTMLElement | null;
    if (activeElement && container.contains(activeElement)) return;

    // Delay to ensure DOM is ready
    const timer = setTimeout(() => {
      const buttons = container.querySelectorAll<HTMLButtonElement>(".universal-toolbar-btn");
      if (buttons.length === 0) return;
      const safeIndex = Math.min(focusedIndex, buttons.length - 1);
      const targetIndex = isButtonFocusable(safeIndex)
        ? safeIndex
        : getFirstFocusableIndex(buttons.length, isButtonFocusable);
      if (buttons[targetIndex]) buttons[targetIndex].focus();
    }, 0);

    return () => clearTimeout(timer);
  }, [focusMode, focusedIndex, isButtonFocusable, containerRef]);

  return {
    focusedIndex,
    setFocusedIndex,
    containerRef,
    handleKeyDown,
  };
}
