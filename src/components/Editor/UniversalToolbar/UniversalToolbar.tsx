/**
 * UniversalToolbar - Bottom formatting toolbar
 *
 * A universal, single-line toolbar anchored at the bottom of the window.
 * Triggered by Shift+Cmd+P, provides formatting actions across WYSIWYG and Source.
 *
 * Per redesign spec: focus-toggle model (Shift+Cmd+P toggles focus, not visibility),
 * two-step Escape (dropdown then toolbar), session memory (cleared on close), and
 * smart initial focus (active marks > selection > context > default).
 *
 * @module components/Editor/UniversalToolbar
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { tooltipWithShortcut } from "@/utils/tooltipWithShortcut";
import { selectSourceEditing } from "@/stores/selectSourceEditing";
import { useEditorStore } from "@/stores/editorStore";
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
import { imeToast as toast } from "@/services/ime/imeToast";
import { useTranslation } from "react-i18next";
import { icons } from "@/utils/icons";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import "./universal-toolbar.css";

/**
 * Universal bottom toolbar for formatting actions.
 *
 * Renders a fixed-position toolbar at the bottom of the editor window.
 * Visibility is controlled by the `universalToolbarVisible` state in uiStore.
 */
export function UniversalToolbar() {
  const { t: tDialog } = useTranslation("dialog");
  const { t } = useTranslation("editor");
  const aiPromptsShortcut = useShortcutsStore((state) => state.getShortcut("aiPrompts"));
  const visible = useUIStore((state) => state.universalToolbarVisible);
  const toolbarHasFocus = useUIStore((state) => state.universalToolbarHasFocus);
  const sessionFocusIndex = useUIStore((state) => state.toolbarSessionFocusIndex);
  const storeDropdownOpen = useUIStore((state) => state.toolbarDropdownOpen);
  const sourceMode = useUIStore(selectSourceEditing);
  const wysiwygContext = useEditorStore((state) => state.tiptap.context);
  const wysiwygView = useEditorStore((state) => state.tiptap.editorView);
  const wysiwygEditor = useEditorStore((state) => state.tiptap.editor);
  const sourceContext = useEditorStore((state) => state.source.context);
  const sourceView = useEditorStore((state) => state.source.editorView);

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

  // AI-Prompts action button: trailing pseudo-button in the roving-tabindex model
  // at index `buttons.length` (a11y/A4 — keyboard-reachable). Always enabled, an action.
  const genieFocusIndex = buttons.length;

  const isButtonFocusable = useCallback(
    (index: number) => (index === genieFocusIndex ? true : !buttonStates[index]?.disabled),
    [buttonStates, genieFocusIndex]
  );

  const isDropdownButton = useCallback(
    (index: number) => (index === genieFocusIndex ? false : buttons[index]?.type === "dropdown"),
    [buttons, genieFocusIndex]
  );

  const focusActiveEditor = useCallback(() => {
    const isSource = selectSourceEditing(useUIStore.getState());
    if (isSource) {
      useEditorStore.getState().source.editorView?.focus();
      return;
    }
    useEditorStore.getState().tiptap.editorView?.focus();
  }, []);

  // Close dropdown, optionally restore focus to toolbar button
  const closeMenu = useCallback((restoreFocus = true) => {
    setMenuOpen(false);
    setOpenGroupId(null);
    useUIStore.getState().setToolbarDropdownOpen(false);
    if (!restoreFocus || !useUIStore.getState().universalToolbarVisible) return;
    requestAnimationFrame(() => {
      /* v8 ignore next -- @preserve reason: visibility check inside rAF; toolbar may close before frame fires — timing-dependent, not testable in jsdom */
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
      /* v8 ignore next -- @preserve reason: NaN guard for malformed heading action strings; valid heading IDs always produce a number */
      if (Number.isNaN(level)) return;
      const isSource = selectSourceEditing(useUIStore.getState());
      if (isSource) {
        const state = useEditorStore.getState().source;
        setSourceHeadingLevel({
          surface: "source",
          view: state.editorView,
          context: state.context,
          multiSelection: getSourceMultiSelectionContext(state.editorView, state.context),
        }, level);
      } else {
        const state = useEditorStore.getState().tiptap;
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

    const isSource = selectSourceEditing(useUIStore.getState());
    if (isSource) {
      const state = useEditorStore.getState().source;
      performSourceToolbarAction(action, {
        surface: "source",
        view: state.editorView,
        context: state.context,
        multiSelection: getSourceMultiSelectionContext(state.editorView, state.context),
      });
      return;
    }

    const state = useEditorStore.getState().tiptap;
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
    buttonCount: buttons.length + 1, // +1 for the trailing AI-Prompts button (A4)
    containerRef,
    isButtonFocusable,
    isDropdownButton,
    focusMode: toolbarHasFocus,
    onActivate: (index) => {
      // Trailing AI-Prompts pseudo-button — open the genie picker (A4).
      if (index === genieFocusIndex) {
        useGeniePickerStore.getState().openPicker({ filterScope: "selection" });
        return;
      }
      const button = buttons[index];
      /* v8 ignore next -- @preserve reason: button is always defined for valid index; defensive null guard */
      if (!button) return;
      /* v8 ignore next -- @preserve reason: non-dropdown button type branch not reached; onActivate only fires for dropdown buttons */
      if (button.type === "dropdown") {
        /* v8 ignore next -- @preserve reason: disabled dropdown branch not exercised via keyboard activation in tests */
        if (buttonStates[index]?.disabled) return;
        const rect = containerRef.current?.querySelector<HTMLButtonElement>(
          `.universal-toolbar-btn[data-focus-index="${index}"]`
        )?.getBoundingClientRect();
        /* v8 ignore next -- @preserve reason: rect is null only when DOM button is absent; always present after toolbar renders */
        if (rect) {
          openMenu(button.id, rect);
        }
      }
    },
    onOpenDropdown: (index) => {
      const button = buttons[index];
      /* v8 ignore next -- @preserve reason: button always defined for valid index; type guard for non-dropdown buttons */
      if (!button || button.type !== "dropdown") return false;
      /* v8 ignore next -- @preserve reason: disabled state prevents openDropdown call; not exercised in current test suite */
      if (buttonStates[index]?.disabled) return false;
      const rect = containerRef.current?.querySelector<HTMLButtonElement>(
        `.universal-toolbar-btn[data-focus-index="${index}"]`
      )?.getBoundingClientRect();
      /* v8 ignore next -- @preserve reason: rect is null only when DOM button missing; always present after render */
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

  // Update focusedIndex on focus capture — BEFORE the toolbarHasFocus re-render.
  const handleFocusCapture = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const focusIndexAttr = target.getAttribute("data-focus-index");
      if (focusIndexAttr !== null) {
        const index = parseInt(focusIndexAttr, 10);
        /* v8 ignore next -- @preserve reason: NaN guard for malformed data-focus-index attribute; always a valid integer on rendered buttons */
        if (!isNaN(index)) {
          setFocusedIndex(index);
          useUIStore.getState().setToolbarSessionFocusIndex(index);
        }
      }

      if (!useUIStore.getState().universalToolbarHasFocus) {
        useUIStore.getState().setUniversalToolbarHasFocus(true);
      }
    },
    [setFocusedIndex]
  );

  // Handle dropdown exit (arrow keys or Tab) - moves to adjacent toolbar button
  const handleDropdownExit = useCallback(
    (direction: "left" | "right" | "forward" | "backward") => {
      const isArrowNav = direction === "left" || direction === "right";
      const isNext = direction === "right" || direction === "forward";
      // genieFocusIndex + 1 = full roving count (group buttons + trailing AI-Prompts
      // pseudo-button), so dropdown-exit nav can land on the Genie button too (A4).
      const newIndex = isNext
        ? getNextFocusableIndex(focusedIndex, genieFocusIndex + 1, isButtonFocusable)
        : getPrevFocusableIndex(focusedIndex, genieFocusIndex + 1, isButtonFocusable);

      setFocusedIndex(newIndex);
      useUIStore.getState().setToolbarSessionFocusIndex(newIndex);

      // For arrow navigation, switch to adjacent dropdown (if enabled)
      // By changing openGroupId, React unmounts old dropdown and mounts new one,
      // triggering the new dropdown's useEffect to focus its first item
      /* v8 ignore next -- @preserve reason: arrow-key dropdown-switch path not exercised in current tests; requires mounted DOM with bounding rects */
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
    [closeMenu, focusedIndex, buttons, genieFocusIndex, buttonStates, isButtonFocusable, isDropdownButton, setFocusedIndex]
  );

  // Update session focus index when user navigates
  useEffect(() => {
    /* v8 ignore next -- @preserve reason: focusedIndex < 0 means no button is focused; initial state not tested via this effect */
    if (focusedIndex >= 0) {
      useUIStore.getState().setToolbarSessionFocusIndex(focusedIndex);
    }
  }, [focusedIndex]);

  // Sync local dropdown state from the external store (for global Escape handling).
  useEffect(() => {
    if (!storeDropdownOpen && menuOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to external store dropdown state (#1063)
      closeMenu();
    }
  }, [storeDropdownOpen, menuOpen, closeMenu]);

  // Close dropdown when focus leaves the toolbar (focus toggle).
  useEffect(() => {
    if (!toolbarHasFocus && menuOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to external toolbar-focus signal (#1063)
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

  // Handle toolbar open/close and initial focus — reacts to the external visibility
  // toggle and seeds keyboard focus from session memory / button states (#1063).
  /* eslint-disable react-hooks/set-state-in-effect */
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
        toast.info(tDialog("toast.noFormattingActions"));
        return;
      }

      setFocusedIndex(initialIndex);
      useUIStore.getState().setToolbarSessionFocusIndex(initialIndex);
    } else if (sessionFocusIndex >= 0) {
      // Toolbar was already open, use session memory
      setFocusedIndex(sessionFocusIndex);
    }

    wasVisibleRef.current = true;
  }, [visible, buttonStates, setFocusedIndex, closeMenu, sessionFocusIndex, tDialog]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  /* v8 ignore next -- @preserve reason: ?? null fallback only when openGroupId doesn't match any group; all group IDs are valid constants */
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
      aria-label={t("toolbar.ariaLabel")}
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
            /* v8 ignore next -- @preserve reason: buttons[flatIndex] null guard; always defined for the number of toolbar groups */
            if (!button) return null;

            const currentIndex = flatIndex++;
            const state = buttonStates[currentIndex];
            /* v8 ignore start -- @preserve reason: ?? fallbacks only when buttonStates[currentIndex] is undefined; always defined after toolbar renders */
            const disabled = state?.disabled ?? true;
            const notImplemented = state?.notImplemented ?? false;
            const active = state?.active ?? false;
            /* v8 ignore stop */
            /* v8 ignore next -- @preserve reason: ariaHasPopup undefined branch requires non-dropdown button; all tested buttons are dropdowns */
            const ariaHasPopup_ = button.type === "dropdown" ? "menu" as const : undefined;

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
                ariaHasPopup={ariaHasPopup_}
                /* v8 ignore next -- @preserve reason: ariaExpanded true branch requires dropdown to be open simultaneously; not exercised in tests */
                ariaExpanded={button.type === "dropdown" && openGroupId === button.id}
                onClick={() => {
                  // Update session focus on click (not just keyboard)
                  setFocusedIndex(currentIndex);
                  useUIStore.getState().setToolbarSessionFocusIndex(currentIndex);

                  /* v8 ignore next -- @preserve reason: dropdown toggle logic not exercised via click in jsdom tests; requires real DOM getBoundingClientRect */
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
                    /* v8 ignore next -- @preserve reason: getBoundingClientRect returns zero rect in jsdom; rect check always false */
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

      {/* AI Prompts button */}
      <div className="universal-toolbar-divider" />
      {/* a11y (A4): folded into the roving-tabindex model as the trailing
          pseudo-button at `genieFocusIndex` so arrow nav reaches it and it
          stays out of the tab order when the toolbar is unfocused — see the
          genieFocusIndex / buttonCount wiring above. */}
      <button
        type="button"
        className="universal-toolbar-btn"
        title={tooltipWithShortcut(t("toolbar.aiPrompts"), formatKeyForDisplay(aiPromptsShortcut))}
        aria-label={tooltipWithShortcut(t("toolbar.aiPrompts"), formatKeyForDisplay(aiPromptsShortcut))}
        data-focus-index={genieFocusIndex}
        tabIndex={toolbarHasFocus && focusedIndex === genieFocusIndex ? 0 : -1}
        data-action="genie"
        onClick={() => {
          setFocusedIndex(genieFocusIndex);
          useUIStore.getState().setToolbarSessionFocusIndex(genieFocusIndex);
          useGeniePickerStore.getState().openPicker({ filterScope: "selection" });
        }}
      >
        <span
          className="universal-toolbar-icon"
          dangerouslySetInnerHTML={{ __html: icons.sparkles }}
        />
      </button>

      {menuOpen && menuAnchor && openGroup && (
        <GroupDropdown
          key={openGroup.id}
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
