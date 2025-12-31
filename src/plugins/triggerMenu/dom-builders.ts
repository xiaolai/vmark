/**
 * Trigger Menu DOM Builders
 *
 * XSS-safe DOM construction for menu elements.
 */

import type { TriggerMenuItem } from "./types";

/**
 * Chevron right icon for submenu indicators.
 */
export const chevronRightIcon = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="m9 18 6-6-6-6"/></svg>`;

/**
 * Chevron left icon for flipped submenu indicators.
 */
export const chevronLeftIcon = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="m15 18-6-6 6-6"/></svg>`;

/**
 * Build a menu item element using DOM APIs (XSS-safe).
 */
export function buildMenuItem(
  item: TriggerMenuItem,
  index: number,
  isSelected: boolean,
  hasChildren: boolean
): HTMLElement {
  const div = document.createElement("div");
  div.className = `trigger-menu-item${isSelected ? " selected" : ""}${hasChildren ? " has-children" : ""}`;
  div.dataset.index = String(index);

  const iconSpan = document.createElement("span");
  iconSpan.className = "trigger-menu-item-icon";
  // SVG icons are static/trusted from our codebase
  iconSpan.innerHTML = item.icon;

  const labelSpan = document.createElement("span");
  labelSpan.className = "trigger-menu-item-label";
  // Use textContent for safety - prevents XSS
  labelSpan.textContent = item.label;

  div.appendChild(iconSpan);
  div.appendChild(labelSpan);

  if (hasChildren) {
    const chevronSpan = document.createElement("span");
    chevronSpan.className = "trigger-menu-item-chevron";
    chevronSpan.innerHTML = chevronRightIcon;
    div.appendChild(chevronSpan);
  }

  return div;
}

/**
 * Build a group container with label.
 */
export function buildGroup(groupName: string): HTMLElement {
  const groupDiv = document.createElement("div");
  groupDiv.className = "trigger-menu-group";

  const labelDiv = document.createElement("div");
  labelDiv.className = "trigger-menu-group-label";
  labelDiv.textContent = groupName;

  groupDiv.appendChild(labelDiv);
  return groupDiv;
}

/**
 * Build empty state element.
 */
export function buildEmptyState(): HTMLElement {
  const div = document.createElement("div");
  div.className = "trigger-menu-empty";
  div.textContent = "No results";
  return div;
}
