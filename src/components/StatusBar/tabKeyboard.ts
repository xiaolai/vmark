/**
 * tabKeyboard
 *
 * Purpose: Keyboard handler for tab navigation, reorder, and activation.
 * Plain Arrow/Home/End moves focus between tabs (APG tablist pattern);
 * Alt+Shift+Arrow reorders the focused tab; Enter/Space activates it.
 *
 * Key decisions:
 *   - Roving focus via DOM (audit 20260612 H27): plain ArrowLeft/Right
 *     moves focus to the adjacent [role="tab"] inside the enclosing
 *     [role="tablist"], wrapping at the ends; Home/End jump to the
 *     first/last tab. Without this, inactive tabs were unreachable from
 *     the keyboard (tabIndex=-1 with no way to move focus).
 *   - Reorder via Alt+Shift+Arrow converts to a visual drop index and
 *     delegates to the same onReorder callback used by pointer drag,
 *     keeping reorder policy in one place (tabDragRules).
 *   - Skips events during IME composition to avoid interfering with
 *     CJK input in adjacent UI elements.
 *
 * @coordinates-with useStatusBarTabDrag.ts — provides this to Tab via handleTabKeyDown
 * @coordinates-with tabDragRules.ts — reorder policy applied by the shared onReorder
 * @module components/StatusBar/tabKeyboard
 */
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Tab } from "@/stores/tabStore";
import { isRovingNavKey, moveRovingTabFocus } from "@/utils/rovingTabFocus";

interface HandleTabKeyboardOptions {
  tabId: string;
  event: ReactKeyboardEvent;
  tabs: Tab[];
  onReorder: (tabId: string, visualDropIndex: number) => void;
  onActivate: (tabId: string) => void;
}

/** Handle keyboard events on a tab: Alt+Shift+Arrow for reorder, Enter/Space to activate. */
export function handleTabKeyboard({ tabId, event, tabs, onReorder, onActivate }: HandleTabKeyboardOptions): void {
  if (event.nativeEvent.isComposing) return;

  if (event.altKey && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    const fromIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (fromIndex === -1) return;
    const visualDropIndex = event.key === "ArrowLeft" ? fromIndex : fromIndex + 2;
    onReorder(tabId, visualDropIndex);
    return;
  }

  if (!event.altKey && !event.shiftKey && isRovingNavKey(event.key)) {
    if (moveRovingTabFocus(event.currentTarget as HTMLElement, event.key)) {
      event.preventDefault();
    }
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate(tabId);
  }
}
