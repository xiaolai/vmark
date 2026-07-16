/**
 * rovingTabFocus
 *
 * Purpose: Shared APG-tablist roving-focus helper. Moves DOM focus between the
 * [role="tab"] elements of the enclosing [role="tablist"] with wrap-around, so
 * ArrowLeft/Right/Home/End reach inactive tabs (which carry tabIndex=-1). Used
 * by the status-bar tab strip and the browser page tabs so the behavior stays
 * identical and defined once.
 *
 * @module utils/rovingTabFocus
 */

/** The tablist navigation keys this helper responds to. */
export function isRovingNavKey(key: string): boolean {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End";
}

/**
 * Move DOM focus between [role="tab"] elements of the enclosing tablist
 * (APG pattern, wrap-around). Returns true when focus moved.
 */
export function moveRovingTabFocus(origin: HTMLElement, key: string): boolean {
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
