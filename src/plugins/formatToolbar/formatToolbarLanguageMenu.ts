/**
 * Format Toolbar Language Menu
 *
 * Language picker dropdown for code blocks in the format toolbar.
 */

import { icons } from "./formatToolbarIcons";
import {
  QUICK_LANGUAGES,
  getRecentLanguages,
  getQuickLabel,
  filterLanguages,
} from "@/plugins/sourceFormatPopup/languages";
import { useFormatToolbarStore } from "@/stores/formatToolbarStore";

/**
 * Build language picker row for code mode.
 */
export function buildLanguageRow(
  activeLanguage: string | undefined,
  onLanguageChange: (name: string) => void
): HTMLElement {
  const row = document.createElement("div");
  row.className = "format-toolbar-row";

  const recentLangs = getRecentLanguages();
  const quickLangs = recentLangs.length > 0
    ? recentLangs.slice(0, 5)
    : QUICK_LANGUAGES.map((l) => l.name);

  // Quick language buttons
  const quickContainer = document.createElement("div");
  quickContainer.className = "format-toolbar-quick-langs";
  for (const name of quickLangs) {
    const btn = buildLanguageButton(name, activeLanguage === name, onLanguageChange);
    quickContainer.appendChild(btn);
  }
  row.appendChild(quickContainer);

  // Separator
  const separator = document.createElement("div");
  separator.className = "format-toolbar-separator";
  row.appendChild(separator);

  // Dropdown trigger for more languages
  const dropdown = buildLanguageDropdown(activeLanguage || "", onLanguageChange);
  row.appendChild(dropdown);

  return row;
}

/**
 * Build the language dropdown trigger.
 */
function buildLanguageDropdown(
  currentLanguage: string,
  onLanguageChange: (name: string) => void
): HTMLElement {
  const dropdown = document.createElement("div");
  dropdown.className = "format-toolbar-dropdown";

  const trigger = document.createElement("button");
  trigger.className = "format-toolbar-btn format-toolbar-dropdown-trigger";
  trigger.type = "button";
  trigger.title = "Select language";

  const label = document.createElement("span");
  label.className = "format-toolbar-lang-label";
  label.textContent = currentLanguage || "plain";
  trigger.appendChild(label);

  const chevron = document.createElement("span");
  chevron.innerHTML = icons.chevronDown;
  chevron.style.display = "flex";
  chevron.style.width = "12px";
  chevron.style.height = "12px";
  trigger.appendChild(chevron);

  trigger.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleLanguageMenu(dropdown, onLanguageChange);
  });

  dropdown.appendChild(trigger);
  return dropdown;
}

/**
 * Toggle the language menu open/closed.
 */
function toggleLanguageMenu(
  dropdown: HTMLElement,
  onLanguageChange: (name: string) => void
): void {
  const existingMenu = dropdown.querySelector(".format-toolbar-lang-menu");
  if (existingMenu) {
    existingMenu.remove();
    return;
  }

  const menu = document.createElement("div");
  menu.className = "format-toolbar-lang-menu";

  // Search input
  const searchContainer = document.createElement("div");
  searchContainer.className = "format-toolbar-lang-search";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search...";
  searchInput.addEventListener("input", () => {
    updateLanguageList(listContainer, searchInput.value, onLanguageChange);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      menu.remove();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const filtered = filterLanguages(searchInput.value);
      if (filtered.length > 0) {
        onLanguageChange(filtered[0].name);
      }
    }
  });
  searchContainer.appendChild(searchInput);
  menu.appendChild(searchContainer);

  // Language list
  const listContainer = document.createElement("div");
  listContainer.className = "format-toolbar-lang-list";
  updateLanguageList(listContainer, "", onLanguageChange);
  menu.appendChild(listContainer);

  dropdown.appendChild(menu);

  // Focus search input
  setTimeout(() => searchInput.focus(), 50);
}

/**
 * Update the language list based on search query.
 */
function updateLanguageList(
  container: HTMLElement,
  query: string,
  onLanguageChange: (name: string) => void
): void {
  container.innerHTML = "";
  const filtered = filterLanguages(query);
  const store = useFormatToolbarStore.getState();
  const currentLang = store.codeBlockInfo?.language || "";

  for (const { name } of filtered.slice(0, 20)) {
    const item = document.createElement("button");
    item.className = `format-toolbar-lang-item${name === currentLang ? " active" : ""}`;
    item.type = "button";
    item.textContent = name;

    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onLanguageChange(name);
    });

    container.appendChild(item);
  }
}

/**
 * Build a quick language button.
 */
function buildLanguageButton(
  name: string,
  isActive: boolean,
  onLanguageChange: (name: string) => void
): HTMLElement {
  const btn = document.createElement("button");
  btn.className = `format-toolbar-quick-btn${isActive ? " active" : ""}`;
  btn.type = "button";
  btn.title = name;
  btn.textContent = getQuickLabel(name);

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onLanguageChange(name);
  });

  return btn;
}
