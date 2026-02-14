/**
 * tabKeyboard
 *
 * Purpose: Keyboard handler for tab reorder and activation.
 * Alt+Shift+Arrow reorders the focused tab; Enter/Space activates it.
 *
 * Key decisions:
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

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate(tabId);
  }
}
