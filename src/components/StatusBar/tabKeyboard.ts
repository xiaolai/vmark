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

  if (
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "Home" ||
      event.key === "End")
  ) {
    if (moveTabFocus(event.currentTarget as HTMLElement, event.key)) {
      event.preventDefault();
    }
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate(tabId);
  }
}

/**
 * Move DOM focus between [role="tab"] elements of the enclosing tablist
 * (APG pattern, wrap-around). Returns true when focus moved.
 */
function moveTabFocus(origin: HTMLElement, key: string): boolean {
  const tablist = origin.closest('[role="tablist"]');
  if (!tablist) return false;
  const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
  if (tabs.length === 0) return false;
  const current = tabs.indexOf(origin.closest('[role="tab"]') as HTMLElement);
  if (current === -1) return false;

  let next: number;
  switch (key) {
    case "ArrowLeft":
      next = (current - 1 + tabs.length) % tabs.length;
      break;
    case "ArrowRight":
      next = (current + 1) % tabs.length;
      break;
    case "Home":
      next = 0;
      break;
    default:
      next = tabs.length - 1;
  }
  tabs[next].focus();
  return true;
}
