/**
 * UniversalToolbar - Bottom formatting toolbar
 *
 * A universal, single-line toolbar anchored at the bottom of the window.
 * Triggered by Shift+Cmd+P, provides consistent formatting actions across
 * both WYSIWYG and Source modes.
 *
 * Per redesign spec:
 * - Focus toggle model (Shift+Cmd+P toggles focus, not visibility)
 * - Two-step Escape (dropdown first, then toolbar)
 * - Session memory (cleared on toolbar close)
 * - Smart initial focus (active marks > selection > context > default)
 *
 * @module components/Editor/UniversalToolbar
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { useSourceCursorContextStore } from "@/stores/sourceCursorContextStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { getToolbarButtonState, getToolbarItemState } from "@/plugins/toolbarActions/enableRules";
import { getSourceMultiSelectionContext, getWysiwygMultiSelectionContext } from "@/plugins/toolbarActions/multiSelectionContext";
import { performSourceToolbarAction, setSourceHeadingLevel } from "@/plugins/toolbarActions/sourceAdapter";
import { performWysiwygToolbarAction, setWysiwygHeadingLevel } from "@/plugins/toolbarActions/wysiwygAdapter";
import type { ToolbarContext } from "@/plugins/toolbarActions/types";
import { TOOLBAR_GROUPS, getGroupButtons } from "./toolbarGroups";
import { ToolbarButton } from "./ToolbarButton";
import { useToolbarKeyboard } from "./useToolbarKeyboard";
import { getInitialFocusIndex } from "./toolbarFocus";
import { getNextFocusableIndex, getPrevFocusableIndex } from "./toolbarNavigation";
import { GroupDropdown } from "./GroupDropdown";
import { toast } from "sonner";
import "./universal-toolbar.css";

/**
 * Universal bottom toolbar for formatting actions.
 *
 * Renders a fixed-position toolbar at the bottom of the editor window.
 * Visibility is controlled by the `universalToolbarVisible` state in uiStore.
 */
export function UniversalToolbar() {
  const visible = useUIStore((state) => state.universalToolbarVisible);
  const toolbarHasFocus = useUIStore((state) => state.universalToolbarHasFocus);
  const sessionFocusIndex = useUIStore((state) => state.toolbarSessionFocusIndex);
  const storeDropdownOpen = useUIStore((state) => state.toolbarDropdownOpen);
  const sourceMode = useEditorStore((state) => state.sourceMode);
  const wysiwygContext = useTiptapEditorStore((state) => state.context);
  const wysiwygView = useTiptapEditorStore((state) => state.editorView);
  const wysiwygEditor = useTiptapEditorStore((state) => state.editor);
  const sourceContext = useSourceCursorContextStore((state) => state.context);
  const sourceView = useSourceCursorContextStore((state) => state.editorView);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wasVisibleRef = useRef(false);

  // One toolbar button per group
  const buttons = useMemo(() => getGroupButtons(), []);

  const toolbarContext = useMemo<ToolbarContext>(() => {
    if (sourceMode) {
      return {
        surface: "source",
        view: sourceView,
        context: sourceContext,
        multiSelection: getSourceMultiSelectionContext(sourceView, sourceContext),
      };
    }
    return {
      surface: "wysiwyg",
      view: wysiwygView,
      editor: wysiwygEditor,
      context: wysiwygContext,
      multiSelection: getWysiwygMultiSelectionContext(wysiwygView, wysiwygContext),
    };
  }, [sourceMode, sourceView, sourceContext, wysiwygView, wysiwygEditor, wysiwygContext]);

  const buttonStates = useMemo(
    () => buttons.map((button) => getToolbarButtonState(button, toolbarContext)),
    [buttons, toolbarContext]
  );

  const isButtonFocusable = useCallback(
    (index: number) => !buttonStates[index]?.disabled,
    [buttonStates]
  );

  const isDropdownButton = useCallback(
    (index: number) => buttons[index]?.type === "dropdown",
    [buttons]
  );

  const focusActiveEditor = useCallback(() => {
    const isSource = useEditorStore.getState().sourceMode;
    if (isSource) {
      useSourceCursorContextStore.getState().editorView?.focus();
      return;
    }
    useTiptapEditorStore.getState().editorView?.focus();
  }, []);

  // Close dropdown, optionally restore focus to toolbar button
  const closeMenu = useCallback((restoreFocus = true) => {
    setMenuOpen(false);
    setOpenGroupId(null);
    useUIStore.getState().setToolbarDropdownOpen(false);
    if (!restoreFocus || !useUIStore.getState().universalToolbarVisible) return;
    requestAnimationFrame(() => {
      if (!useUIStore.getState().universalToolbarVisible) return;
      const currentIndex = useUIStore.getState().toolbarSessionFocusIndex;
      if (currentIndex < 0) return;
      const target = containerRef.current?.querySelector<HTMLButtonElement>(
        `.universal-toolbar-btn[data-focus-index="${currentIndex}"]`
      );
      target?.focus();
    });
  }, []);

  // Helper to open a menu and sync with store
  const openMenu = useCallback((groupId: string, rect: DOMRect) => {
    setMenuAnchor(rect);
    setOpenGroupId(groupId);
    setMenuOpen(true);
    useUIStore.getState().setToolbarDropdownOpen(true);
  }, []);

  // Close toolbar completely
  const closeToolbar = useCallback(() => {
    useUIStore.getState().clearToolbarSession();
    focusActiveEditor();
    setMenuOpen(false);
    setOpenGroupId(null);
  }, [focusActiveEditor]);

  const handleFocusCapture = useCallback(() => {
    if (!useUIStore.getState().universalToolbarHasFocus) {
      useUIStore.getState().setUniversalToolbarHasFocus(true);
    }
  }, []);

  const handleBlurCapture = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      const container = containerRef.current;
      if (container && nextTarget && container.contains(nextTarget)) return;
      useUIStore.getState().setUniversalToolbarHasFocus(false);
    },
    [containerRef]
  );

  const handleAction = useCallback((action: string) => {
    if (action.startsWith("heading:")) {
      const level = Number(action.split(":")[1]);
      if (Number.isNaN(level)) return;
      const isSource = useEditorStore.getState().sourceMode;
      if (isSource) {
        const state = useSourceCursorContextStore.getState();
        setSourceHeadingLevel({
          surface: "source",
          view: state.editorView,
          context: state.context,
          multiSelection: getSourceMultiSelectionContext(state.editorView, state.context),
        }, level);
      } else {
        const state = useTiptapEditorStore.getState();
        setWysiwygHeadingLevel({
          surface: "wysiwyg",
          view: state.editorView,
          editor: state.editor,
          context: state.context,
          multiSelection: getWysiwygMultiSelectionContext(state.editorView, state.context),
        }, level);
      }
      return;
    }

    const isSource = useEditorStore.getState().sourceMode;
    if (isSource) {
      const state = useSourceCursorContextStore.getState();
      performSourceToolbarAction(action, {
        surface: "source",
        view: state.editorView,
        context: state.context,
        multiSelection: getSourceMultiSelectionContext(state.editorView, state.context),
      });
      return;
    }

    const state = useTiptapEditorStore.getState();
    performWysiwygToolbarAction(action, {
      surface: "wysiwyg",
      view: state.editorView,
      editor: state.editor,
      context: state.context,
      multiSelection: getWysiwygMultiSelectionContext(state.editorView, state.context),
    });
  }, []);

  // Keyboard navigation
  const { handleKeyDown, focusedIndex, setFocusedIndex } = useToolbarKeyboard({
    buttonCount: buttons.length,
    containerRef,
    isButtonFocusable,
    isDropdownButton,
    focusMode: toolbarHasFocus,
    onActivate: (index) => {
      const button = buttons[index];
      if (!button) return;
      if (button.type === "dropdown") {
        if (buttonStates[index]?.disabled) return;
        const rect = containerRef.current?.querySelector<HTMLButtonElement>(
          `.universal-toolbar-btn[data-focus-index="${index}"]`
        )?.getBoundingClientRect();
        if (rect) {
          openMenu(button.id, rect);
        }
      }
    },
    onOpenDropdown: (index) => {
      const button = buttons[index];
      if (!button || button.type !== "dropdown") return false;
      if (buttonStates[index]?.disabled) return false;
      const rect = containerRef.current?.querySelector<HTMLButtonElement>(
        `.universal-toolbar-btn[data-focus-index="${index}"]`
      )?.getBoundingClientRect();
      if (rect) {
        openMenu(button.id, rect);
      }
      return true;
    },
    onClose: () => {
      // Two-step Escape: if dropdown open, close it first
      if (menuOpen) {
        closeMenu();
        return;
      }
      // No dropdown open - close toolbar
      closeToolbar();
    },
  });

  // Handle dropdown exit (arrow keys or Tab) - moves to adjacent toolbar button
  const handleDropdownExit = useCallback(
    (direction: "left" | "right" | "forward" | "backward") => {
      const isArrowNav = direction === "left" || direction === "right";
      const isNext = direction === "right" || direction === "forward";
      const newIndex = isNext
        ? getNextFocusableIndex(focusedIndex, buttons.length, isButtonFocusable)
        : getPrevFocusableIndex(focusedIndex, buttons.length, isButtonFocusable);

      setFocusedIndex(newIndex);
      useUIStore.getState().setToolbarSessionFocusIndex(newIndex);

      // For arrow navigation, switch to adjacent dropdown (if enabled)
      // By changing openGroupId, React unmounts old dropdown and mounts new one,
      // triggering the new dropdown's useEffect to focus its first item
      if (isArrowNav && isDropdownButton(newIndex) && !buttonStates[newIndex]?.disabled) {
        const button = buttons[newIndex];
        const rect = containerRef.current?.querySelector<HTMLButtonElement>(
          `.universal-toolbar-btn[data-focus-index="${newIndex}"]`
        )?.getBoundingClientRect();
        if (rect) {
          setOpenGroupId(button.id);
          setMenuAnchor(rect);
          return;
        }
      }

      // For Tab navigation or disabled button, close dropdown and focus toolbar button
      closeMenu(false);
      requestAnimationFrame(() => {
        containerRef.current?.querySelector<HTMLButtonElement>(
          `.universal-toolbar-btn[data-focus-index="${newIndex}"]`
        )?.focus();
      });
    },
    [closeMenu, focusedIndex, buttons, buttonStates, isButtonFocusable, isDropdownButton, setFocusedIndex]
  );

  // Update session focus index when user navigates
  useEffect(() => {
    if (focusedIndex >= 0) {
      useUIStore.getState().setToolbarSessionFocusIndex(focusedIndex);
    }
  }, [focusedIndex]);

  // Sync with store's dropdown state (for global Escape handling)
  useEffect(() => {
    // Store says dropdown should be closed, but local state says open
    if (!storeDropdownOpen && menuOpen) {
      closeMenu();
    }
  }, [storeDropdownOpen, menuOpen, closeMenu]);

  // Close dropdown when focus leaves toolbar (focus toggle)
  useEffect(() => {
    if (!toolbarHasFocus && menuOpen) {
      closeMenu(false);
    }
  }, [toolbarHasFocus, menuOpen, closeMenu]);

  // Move focus to editor when toolbar focus is toggled off (but toolbar stays visible)
  useEffect(() => {
    if (visible && !toolbarHasFocus) {
      // Check if focus is still inside the toolbar
      const container = containerRef.current;
      const activeEl = document.activeElement as HTMLElement | null;
      if (container && activeEl && container.contains(activeEl)) {
        focusActiveEditor();
      }
    }
  }, [visible, toolbarHasFocus, focusActiveEditor]);

  // Handle toolbar open/close and initial focus
  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      closeMenu(false);
      return;
    }

    // Toolbar just opened - focus first enabled button
    if (!wasVisibleRef.current) {
      const initialIndex = getInitialFocusIndex({
        states: buttonStates,
      });

      // If no enabled buttons, close toolbar immediately
      if (initialIndex < 0) {
        useUIStore.getState().clearToolbarSession();
        toast.info("No formatting actions available");
        return;
      }

      setFocusedIndex(initialIndex);
      useUIStore.getState().setToolbarSessionFocusIndex(initialIndex);
    } else if (sessionFocusIndex >= 0) {
      // Toolbar was already open, use session memory
      setFocusedIndex(sessionFocusIndex);
    }

    wasVisibleRef.current = true;
  }, [visible, buttonStates, setFocusedIndex, closeMenu, sessionFocusIndex]);

  // Handle click outside dropdown
  useEffect(() => {
    if (!menuOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const menu = menuRef.current;
      const container = containerRef.current;

      // Click inside dropdown - ignore
      if (menu && menu.contains(target)) return;

      // Click on toolbar button - let onClick handler deal with it
      if (container && container.contains(target)) {
        return;
      }

      // Click outside - close dropdown, keep toolbar
      closeMenu();
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [menuOpen, closeMenu]);

  const openGroup = openGroupId
    ? TOOLBAR_GROUPS.find((group) => group.id === openGroupId) ?? null
    : null;

  const dropdownItems = useMemo(() => {
    if (!openGroup) return [];
    return openGroup.items.map((item) => ({
      item,
      state: getToolbarItemState(item, toolbarContext),
    }));
  }, [openGroup, toolbarContext]);

  if (!visible) {
    return null;
  }

  // Build flat index for roving tabindex
  let flatIndex = 0;

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="Formatting toolbar"
      aria-orientation="horizontal"
      className="universal-toolbar"
      onKeyDown={handleKeyDown}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      {TOOLBAR_GROUPS.map((group, _groupIndex) => (
        <div key={group.id} className="universal-toolbar-group">
          {(() => {
            const button = buttons[flatIndex];
            if (!button) return null;

            const currentIndex = flatIndex++;
            const state = buttonStates[currentIndex];
            const disabled = state?.disabled ?? true;
            const notImplemented = state?.notImplemented ?? false;
            const active = state?.active ?? false;

            return (
              <ToolbarButton
                key={button.id}
                button={button}
                disabled={disabled}
                notImplemented={notImplemented}
                active={active}
                focusEnabled={toolbarHasFocus}
                focusIndex={currentIndex}
                currentFocusIndex={focusedIndex}
                ariaHasPopup={button.type === "dropdown" ? "menu" : undefined}
                ariaExpanded={button.type === "dropdown" && openGroupId === button.id}
                onClick={() => {
                  // Update session focus on click (not just keyboard)
                  setFocusedIndex(currentIndex);
                  useUIStore.getState().setToolbarSessionFocusIndex(currentIndex);

                  if (button.type === "dropdown") {
                    // If clicking same button with dropdown open, close it
                    if (openGroupId === button.id && menuOpen) {
                      closeMenu();
                      return;
                    }
                    // Close any other dropdown and open this one
                    const rect = containerRef.current?.querySelector<HTMLButtonElement>(
                      `.universal-toolbar-btn[data-focus-index="${currentIndex}"]`
                    )?.getBoundingClientRect();
                    if (rect) {
                      openMenu(button.id, rect);
                    }
                  }
                }}
              />
            );
          })()}
        </div>
      ))}

      {menuOpen && menuAnchor && openGroup && (
        <GroupDropdown
          ref={menuRef}
          anchorRect={menuAnchor}
          items={dropdownItems}
          groupId={openGroup.id}
          onSelect={(action) => {
            handleAction(action);
            closeMenu();
          }}
          onClose={() => closeMenu()}
          onNavigateOut={handleDropdownExit}
          onTabOut={handleDropdownExit}
        />
      )}
    </div>
  );
}
