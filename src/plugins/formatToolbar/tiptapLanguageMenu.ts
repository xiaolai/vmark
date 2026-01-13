import { filterLanguages } from "@/plugins/sourceFormatPopup/languages";
import { useFormatToolbarStore } from "@/stores/formatToolbarStore";
import { isImeKeyEvent } from "@/utils/imeGuard";

export function toggleTiptapLanguageMenu(opts: {
  dropdown: HTMLElement;
  onSelect: (language: string) => void;
}) {
  const existing = opts.dropdown.querySelector(".format-toolbar-lang-menu");
  if (existing) {
    existing.remove();
    return;
  }

  const menu = document.createElement("div");
  menu.className = "format-toolbar-lang-menu";

  const search = document.createElement("div");
  search.className = "format-toolbar-lang-search";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search...";
  search.appendChild(input);
  menu.appendChild(search);

  const list = document.createElement("div");
  list.className = "format-toolbar-lang-list";
  menu.appendChild(list);

  const renderList = (query: string) => {
    list.innerHTML = "";
    const filtered = filterLanguages(query);
    const currentLang = useFormatToolbarStore.getState().codeBlockInfo?.language || "";

    for (const { name } of filtered.slice(0, 30)) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `format-toolbar-lang-item${name === currentLang ? " active" : ""}`;
      item.textContent = name;
      item.addEventListener("mousedown", (e) => e.preventDefault());
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        opts.onSelect(name);
        menu.remove();
      });
      list.appendChild(item);
    }
  };

  input.addEventListener("input", () => renderList(input.value));
  input.addEventListener("keydown", (e) => {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      menu.remove();
    }
  });

  renderList("");
  opts.dropdown.appendChild(menu);
  setTimeout(() => input.focus(), 30);
}
