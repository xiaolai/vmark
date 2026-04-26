/**
 * Language picker dropdown for the WYSIWYG code block.
 *
 * Owns the dropdown DOM (search input + filterable list), positioning, and
 * keyboard navigation. Mounted into the editor's popup host when available so
 * the dropdown inherits theme styling and is not clipped by the editor scroll
 * container; falls back to `document.body` with fixed positioning otherwise.
 *
 * The owner (CodeBlockNodeView) supplies the anchor chip and a callback that
 * receives the chosen language id. The dropdown tracks no state of its own
 * besides the open/closed lifecycle and listener registrations.
 *
 * @coordinates-with sourcePopup — uses getPopupHostForDom/toHostCoordsForDom for popup-host detection
 * @module plugins/codeBlockLineNumbers/dropdown
 */
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";
import i18n from "@/i18n";
import { LANGUAGES } from "./languages";

export interface LanguageDropdownDeps {
  /** The chip element the dropdown anchors against; clicked to open. */
  anchor: HTMLElement;
  /** Returns the currently selected language id (read on every (re)render). */
  getCurrentLanguage: () => string;
  /** Invoked when the user picks a language. */
  onSelect: (langId: string) => void;
}

export class LanguageDropdown {
  private dropdown: HTMLElement | null = null;
  private dropdownHost: HTMLElement | null = null;

  constructor(private readonly deps: LanguageDropdownDeps) {}

  isOpen(): boolean {
    return this.dropdown !== null;
  }

  /** True if `node` is inside the dropdown DOM (used by `ignoreMutation`). */
  contains(node: Node): boolean {
    return this.dropdown?.contains(node) ?? false;
  }

  toggle(): void {
    if (this.dropdown) {
      this.close();
    } else {
      this.open();
    }
  }

  close(): void {
    if (this.dropdown) {
      this.dropdown.remove();
      this.dropdown = null;
      this.dropdownHost = null;
      document.removeEventListener("mousedown", this.handleOutsideClick);
      window.removeEventListener("scroll", this.positionDropdown, true);
    }
  }

  destroy(): void {
    this.close();
  }

  private open(): void {
    /* v8 ignore next -- @preserve Defensive guard: toggle calls close when dropdown exists, so open is only called when dropdown is null */
    if (this.dropdown) return;

    const dropdown = document.createElement("div");
    dropdown.className = "code-lang-dropdown";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "code-lang-search";
    searchInput.placeholder = i18n.t("editor:plugin.searchLanguages");
    searchInput.addEventListener("input", () => this.filterLanguages(searchInput.value));
    searchInput.addEventListener("keydown", (e) => this.handleSearchKeydown(e));
    dropdown.appendChild(searchInput);

    const list = document.createElement("div");
    list.className = "code-lang-list";
    this.renderLanguageList(list, "");
    dropdown.appendChild(list);

    this.dropdown = dropdown;

    // Mount inside the editor's popup host when available so the dropdown
    // inherits theme styles and isn't clipped by the editor scroll container.
    this.dropdownHost = getPopupHostForDom(this.deps.anchor) ?? document.body;
    dropdown.style.position = this.dropdownHost === document.body ? "fixed" : "absolute";
    this.dropdownHost.appendChild(dropdown);
    this.positionDropdown();

    requestAnimationFrame(() => searchInput.focus());

    document.addEventListener("mousedown", this.handleOutsideClick);
    window.addEventListener("scroll", this.positionDropdown, true);
  }

  private positionDropdown = (): void => {
    /* v8 ignore next -- @preserve Defensive guard: scroll listener is removed by close before dropdown is nulled */
    if (!this.dropdown) return;
    const rect = this.deps.anchor.getBoundingClientRect();
    const top = rect.bottom + 4;
    const left = rect.right - 180; // align right edge

    if (this.dropdownHost !== document.body && this.dropdownHost) {
      const hostPos = toHostCoordsForDom(this.dropdownHost, { top, left });
      this.dropdown.style.top = `${hostPos.top}px`;
      this.dropdown.style.left = `${hostPos.left}px`;
    } else {
      this.dropdown.style.top = `${top}px`;
      this.dropdown.style.left = `${left}px`;
    }
  };

  private handleOutsideClick = (e: MouseEvent): void => {
    if (
      this.dropdown &&
      !this.dropdown.contains(e.target as Node) &&
      !this.deps.anchor.contains(e.target as Node)
    ) {
      this.close();
    }
  };

  private filterLanguages(query: string): void {
    if (!this.dropdown) return;
    const list = this.dropdown.querySelector(".code-lang-list");
    if (list) {
      this.renderLanguageList(list as HTMLElement, query);
    }
  }

  private renderLanguageList(container: HTMLElement, query: string): void {
    container.innerHTML = "";
    const lowerQuery = query.toLowerCase();
    const filtered = LANGUAGES.filter(
      (lang) => lang.name.toLowerCase().includes(lowerQuery) || lang.id.toLowerCase().includes(lowerQuery)
    );

    const currentLang = this.deps.getCurrentLanguage();
    const currentIndex = filtered.findIndex((lang) => lang.id === currentLang);
    const highlightIndex = currentIndex >= 0 ? currentIndex : 0;

    filtered.forEach((lang, index) => {
      const item = document.createElement("div");
      item.className = "code-lang-item";
      item.tabIndex = 0;
      if (lang.id === currentLang) {
        item.classList.add("active");
      }
      if (index === highlightIndex) {
        item.classList.add("highlighted");
      }
      item.textContent = lang.name;
      item.dataset.langId = lang.id;
      item.addEventListener("click", () => this.pickLanguage(lang.id));
      item.addEventListener("keydown", this.handleListKeydown);
      container.appendChild(item);
    });

    requestAnimationFrame(() => {
      const highlighted = container.querySelector(".highlighted");
      if (highlighted) {
        highlighted.scrollIntoView({ block: "nearest" });
      }
    });
  }

  private pickLanguage(langId: string): void {
    this.deps.onSelect(langId);
    this.close();
  }

  /**
   * Resolves the dropdown's list element and focusable items, or null if the
   * dropdown is closed/empty. Both keyboard handlers need this exact preamble.
   */
  private getDropdownItems(): { list: Element; items: HTMLElement[] } | null {
    if (!this.dropdown) return null;
    const list = this.dropdown.querySelector(".code-lang-list");
    if (!list) return null;
    const items = Array.from(list.querySelectorAll(".code-lang-item")) as HTMLElement[];
    if (items.length === 0) return null;
    return { list, items };
  }

  /**
   * Handles keys shared by both the search input and the list items:
   * ArrowDown/ArrowUp move the highlight, Escape closes the dropdown.
   * Returns true if the key was handled (caller should stop further dispatch).
   */
  private handleSharedDropdownKey(e: KeyboardEvent, items: HTMLElement[]): boolean {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.moveHighlight(items, 1);
        return true;
      case "ArrowUp":
        e.preventDefault();
        this.moveHighlight(items, -1);
        return true;
      case "Escape":
        e.preventDefault();
        this.close();
        return true;
    }
    return false;
  }

  private handleSearchKeydown = (e: KeyboardEvent): void => {
    const ctx = this.getDropdownItems();
    if (!ctx) return;
    if (this.handleSharedDropdownKey(e, ctx.items)) return;

    switch (e.key) {
      case "Tab": {
        // Tab moves focus to the highlighted item in the list
        e.preventDefault();
        const highlighted = ctx.list.querySelector(".code-lang-item.highlighted") as HTMLElement;
        /* v8 ignore next -- @preserve reason: false branch (no highlighted item) falls to defensive items[0] guard */
        if (highlighted) {
          highlighted.focus();
        /* v8 ignore start -- @preserve items[0] is always truthy here: items.length === 0 guard above ensures non-empty */
        } else if (ctx.items[0]) {
          ctx.items[0].classList.add("highlighted");
          ctx.items[0].focus();
        }
        /* v8 ignore stop */
        break;
      }
      case "Enter": {
        e.preventDefault();
        const current = ctx.list.querySelector(".code-lang-item.highlighted") as HTMLElement;
        if (current) {
          this.pickLanguage(current.dataset.langId || "");
        }
        break;
      }
    }
  };

  private handleListKeydown = (e: KeyboardEvent): void => {
    const ctx = this.getDropdownItems();
    if (!ctx) return;
    if (this.handleSharedDropdownKey(e, ctx.items)) return;

    switch (e.key) {
      case "Tab": {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+Tab returns focus to the search input
          const searchInput = this.dropdown?.querySelector(".code-lang-search") as HTMLInputElement | null;
          if (searchInput) {
            searchInput.focus();
          }
        } else {
          // Tab without shift moves to the next item
          this.moveHighlight(ctx.items, 1);
        }
        break;
      }
      case "Enter": {
        e.preventDefault();
        const target = e.target as HTMLElement;
        if (target.classList.contains("code-lang-item")) {
          this.pickLanguage(target.dataset.langId || "");
        }
        break;
      }
    }
  };

  private moveHighlight(items: HTMLElement[], direction: number): void {
    const currentHighlighted = items.find((item) => item.classList.contains("highlighted"));
    const currentIndex = currentHighlighted ? items.indexOf(currentHighlighted) : -1;

    currentHighlighted?.classList.remove("highlighted");

    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= items.length) newIndex = items.length - 1;

    items[newIndex].classList.add("highlighted");
    items[newIndex].scrollIntoView({ block: "nearest" });
    items[newIndex].focus();
  }
}
