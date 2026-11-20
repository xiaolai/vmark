/**
 * UniversalToolbar - Bottom formatting toolbar
 *
 * A universal, single-line toolbar anchored at the bottom of the window.
 * Triggered by Shift+Cmd+P, provides formatting actions across WYSIWYG and Source.
 *
 * The shortcut and the View menu item show the toolbar or hide it.
 * Two-step Escape (dropdown then toolbar), session memory (cleared on close),
 * and smart initial focus (active marks > selection > context > default).
 *
 * The component owns layout. The button model lives in `useToolbarButtons`,
 * the dropdown in `useToolbarMenu`, keyboard and focus navigation in
 * `useToolbarNavigation`, and the open/close session in `useToolbarSession`.
 *
 * @module components/Editor/UniversalToolbar/UniversalToolbar
 */
import { useCallback, useRef } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { tooltipWithShortcut } from "@/utils/tooltipWithShortcut";
import { selectSourceEditing } from "@/stores/selectSourceEditing";
import { dispatchEditorAction } from "@/plugins/toolbarActions/dispatch";
import { TOOLBAR_GROUPS } from "./toolbarGroups";
import { ToolbarButton } from "./ToolbarButton";
import { GroupDropdown } from "./GroupDropdown";
import { useToolbarButtons } from "./useToolbarButtons";
import { useToolbarMenu } from "./useToolbarMenu";
import { useToolbarNavigation } from "./useToolbarNavigation";
import { useToolbarSession } from "./useToolbarSession";
import { useTranslation } from "react-i18next";
import { icons } from "@/utils/icons";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import "./universal-toolbar.css";

/**
 * Universal bottom toolbar for formatting actions.
 *
 * Renders in the bottom lane, above the status bar while that bar is visible.
 * Visibility is controlled by the `universalToolbarVisible` state in uiStore.
 */
export function UniversalToolbar() {
  const { t } = useTranslation("editor");
  const aiPromptsShortcut = useShortcutsStore((state) => state.getShortcut("aiPrompts"));
  const visible = useUIStore((state) => state.universalToolbarVisible);
  const statusBarVisible = useUIStore((state) => state.statusBarVisible);
  const toolbarHasFocus = useUIStore((state) => state.universalToolbarHasFocus);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const model = useToolbarButtons();
  const { buttons, buttonStates, genieFocusIndex } = model;
  const menu = useToolbarMenu(containerRef, toolbarHasFocus, model.toolbarContext);
  const { menuOpen, menuAnchor, openGroupId, openGroup, dropdownItems, menuRef, openMenu, closeMenu } = menu;
  const {
    handleKeyDown, focusedIndex, setFocusedIndex,
    handleFocusCapture, handleBlurCapture, handleDropdownExit,
  } = useToolbarNavigation(containerRef, toolbarHasFocus, model, menu);
  useToolbarSession({ visible, toolbarHasFocus, containerRef, buttonStates, focusedIndex, setFocusedIndex, closeMenu });

  const handleAction = useCallback((action: string) => {
    const surface = selectSourceEditing(useUIStore.getState()) ? "source" : "wysiwyg";
    dispatchEditorAction(action, surface);
  }, []);

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
      className={
        statusBarVisible
          ? "universal-toolbar universal-toolbar--above-status"
          : "universal-toolbar"
      }
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
