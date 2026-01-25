/**
 * CodeBlock extension with line numbers and language selector.
 *
 * Uses a custom NodeView to render line numbers in a gutter
 * and a language selector chip in the top-right corner.
 */
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

const lowlight = createLowlight(common);

/**
 * Common programming languages with display names.
 * Ordered by popularity/usage.
 */
const LANGUAGES = [
  { id: "", name: "Plain Text" },
  { id: "javascript", name: "JavaScript" },
  { id: "typescript", name: "TypeScript" },
  { id: "python", name: "Python" },
  { id: "java", name: "Java" },
  { id: "c", name: "C" },
  { id: "cpp", name: "C++" },
  { id: "csharp", name: "C#" },
  { id: "go", name: "Go" },
  { id: "rust", name: "Rust" },
  { id: "ruby", name: "Ruby" },
  { id: "php", name: "PHP" },
  { id: "swift", name: "Swift" },
  { id: "kotlin", name: "Kotlin" },
  { id: "scala", name: "Scala" },
  { id: "html", name: "HTML" },
  { id: "css", name: "CSS" },
  { id: "scss", name: "SCSS" },
  { id: "json", name: "JSON" },
  { id: "yaml", name: "YAML" },
  { id: "xml", name: "XML" },
  { id: "markdown", name: "Markdown" },
  { id: "sql", name: "SQL" },
  { id: "shell", name: "Shell" },
  { id: "bash", name: "Bash" },
  { id: "powershell", name: "PowerShell" },
  { id: "dockerfile", name: "Dockerfile" },
  { id: "graphql", name: "GraphQL" },
  { id: "lua", name: "Lua" },
  { id: "r", name: "R" },
  { id: "perl", name: "Perl" },
  { id: "haskell", name: "Haskell" },
  { id: "elixir", name: "Elixir" },
  { id: "clojure", name: "Clojure" },
  { id: "erlang", name: "Erlang" },
  { id: "ocaml", name: "OCaml" },
  { id: "fsharp", name: "F#" },
  { id: "dart", name: "Dart" },
  { id: "objectivec", name: "Objective-C" },
  { id: "matlab", name: "MATLAB" },
  { id: "latex", name: "LaTeX" },
  { id: "diff", name: "Diff" },
  { id: "plaintext", name: "Plain Text" },
];

/**
 * Custom NodeView for code blocks with line numbers and language selector.
 */
class CodeBlockNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private gutter: HTMLElement;
  private codeElement: HTMLElement;
  private langSelector: HTMLElement;
  private dropdown: HTMLElement | null = null;
  private dropdownHost: HTMLElement | null = null;
  private node: ProseMirrorNode;
  private editor: Editor;
  private getPos: () => number | undefined;

  constructor(node: ProseMirrorNode, editor: Editor, getPos: () => number | undefined) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;

    // Create wrapper
    this.dom = document.createElement("div");
    this.dom.className = "code-block-wrapper";

    // Create gutter for line numbers
    this.gutter = document.createElement("div");
    this.gutter.className = "code-line-numbers";
    this.gutter.setAttribute("aria-hidden", "true");
    this.gutter.contentEditable = "false";
    this.dom.appendChild(this.gutter);

    // Create pre element
    const pre = document.createElement("pre");
    this.dom.appendChild(pre);

    // Create code element (contentDOM)
    this.codeElement = document.createElement("code");
    if (node.attrs.language) {
      this.codeElement.className = `language-${node.attrs.language}`;
    }
    pre.appendChild(this.codeElement);
    this.contentDOM = this.codeElement;

    // Create language selector
    this.langSelector = document.createElement("div");
    this.langSelector.className = "code-lang-selector";
    this.langSelector.contentEditable = "false";
    this.updateLangSelectorText();
    // Use mousedown with capture phase to get event before ProseMirror
    this.langSelector.addEventListener("mousedown", this.handleLangClick, { capture: true });
    this.dom.appendChild(this.langSelector);

    // Initial line count
    this.updateLineNumbers();
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;

    // Update language class
    if (node.attrs.language) {
      this.codeElement.className = `language-${node.attrs.language}`;
    } else {
      this.codeElement.className = "";
    }

    // Update language selector text
    this.updateLangSelectorText();

    // Update line numbers
    this.updateLineNumbers();
    return true;
  }

  destroy(): void {
    this.closeDropdown();
    this.langSelector.removeEventListener("mousedown", this.handleLangClick, { capture: true });
  }

  private updateLangSelectorText(): void {
    const lang = this.node.attrs.language || "";
    const langInfo = LANGUAGES.find((l) => l.id === lang);
    this.langSelector.textContent = langInfo?.name || lang || "Plain Text";
  }

  private updateLineNumbers(): void {
    const text = this.node.textContent;
    const lineCount = text.split("\n").length;

    // Clear existing line numbers
    this.gutter.innerHTML = "";

    // Generate line number elements
    for (let i = 1; i <= lineCount; i++) {
      const lineNum = document.createElement("div");
      lineNum.className = "line-num";
      lineNum.textContent = String(i);
      this.gutter.appendChild(lineNum);
    }
  }

  private handleLangClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (this.dropdown) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  };

  private openDropdown(): void {
    if (this.dropdown) return;

    const dropdown = document.createElement("div");
    dropdown.className = "code-lang-dropdown";

    // Search input
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "code-lang-search";
    searchInput.placeholder = "Search languages...";
    searchInput.addEventListener("input", () => this.filterLanguages(searchInput.value));
    searchInput.addEventListener("keydown", (e) => this.handleSearchKeydown(e));
    dropdown.appendChild(searchInput);

    // Language list
    const list = document.createElement("div");
    list.className = "code-lang-list";
    this.renderLanguageList(list, "");
    dropdown.appendChild(list);

    this.dropdown = dropdown;

    // Mount to editor container if available, otherwise document.body
    this.dropdownHost = getPopupHostForDom(this.dom) ?? document.body;
    dropdown.style.position = this.dropdownHost === document.body ? "fixed" : "absolute";
    this.dropdownHost.appendChild(dropdown);
    this.positionDropdown();

    // Focus search input
    requestAnimationFrame(() => searchInput.focus());

    // Close on outside click
    document.addEventListener("mousedown", this.handleOutsideClick);
    // Reposition on scroll
    window.addEventListener("scroll", this.positionDropdown, true);
  }

  private positionDropdown = (): void => {
    if (!this.dropdown) return;
    const rect = this.langSelector.getBoundingClientRect();
    const top = rect.bottom + 4;
    const left = rect.right - 180; // align right edge

    // Convert to host-relative coordinates if mounted inside editor container
    if (this.dropdownHost !== document.body && this.dropdownHost) {
      const hostPos = toHostCoordsForDom(this.dropdownHost, { top, left });
      this.dropdown.style.top = `${hostPos.top}px`;
      this.dropdown.style.left = `${hostPos.left}px`;
    } else {
      this.dropdown.style.top = `${top}px`;
      this.dropdown.style.left = `${left}px`;
    }
  };

  private closeDropdown(): void {
    if (this.dropdown) {
      this.dropdown.remove();
      this.dropdown = null;
      this.dropdownHost = null;
      document.removeEventListener("mousedown", this.handleOutsideClick);
      window.removeEventListener("scroll", this.positionDropdown, true);
    }
  }

  private handleOutsideClick = (e: MouseEvent): void => {
    if (this.dropdown && !this.dropdown.contains(e.target as Node) && !this.langSelector.contains(e.target as Node)) {
      this.closeDropdown();
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

    const currentLang = this.node.attrs.language || "";
    // Find index of current language in filtered list
    const currentIndex = filtered.findIndex((lang) => lang.id === currentLang);
    // Highlight current language if found, otherwise first item
    const highlightIndex = currentIndex >= 0 ? currentIndex : 0;

    filtered.forEach((lang, index) => {
      const item = document.createElement("div");
      item.className = "code-lang-item";
      item.tabIndex = 0; // Make focusable
      if (lang.id === currentLang) {
        item.classList.add("active");
      }
      if (index === highlightIndex) {
        item.classList.add("highlighted");
      }
      item.textContent = lang.name;
      item.dataset.langId = lang.id;
      item.addEventListener("click", () => this.selectLanguage(lang.id));
      item.addEventListener("keydown", this.handleListKeydown);
      container.appendChild(item);
    });

    // Scroll highlighted item into view
    requestAnimationFrame(() => {
      const highlighted = container.querySelector(".highlighted");
      if (highlighted) {
        highlighted.scrollIntoView({ block: "nearest" });
      }
    });
  }

  private handleSearchKeydown = (e: KeyboardEvent): void => {
    if (!this.dropdown) return;

    const list = this.dropdown.querySelector(".code-lang-list");
    if (!list) return;

    const items = Array.from(list.querySelectorAll(".code-lang-item")) as HTMLElement[];
    if (items.length === 0) return;

    switch (e.key) {
      case "Tab": {
        // Tab moves focus to the highlighted item in the list
        e.preventDefault();
        const highlighted = list.querySelector(".code-lang-item.highlighted") as HTMLElement;
        if (highlighted) {
          highlighted.focus();
        } else if (items[0]) {
          items[0].classList.add("highlighted");
          items[0].focus();
        }
        break;
      }
      case "ArrowDown":
        e.preventDefault();
        this.moveHighlight(items, 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        this.moveHighlight(items, -1);
        break;
      case "Enter": {
        e.preventDefault();
        const current = list.querySelector(".code-lang-item.highlighted") as HTMLElement;
        if (current) {
          const langId = current.dataset.langId || "";
          this.selectLanguage(langId);
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        this.closeDropdown();
        break;
    }
  };

  private handleListKeydown = (e: KeyboardEvent): void => {
    if (!this.dropdown) return;

    const list = this.dropdown.querySelector(".code-lang-list");
    if (!list) return;

    const items = Array.from(list.querySelectorAll(".code-lang-item")) as HTMLElement[];
    if (items.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.moveHighlight(items, 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        this.moveHighlight(items, -1);
        break;
      case "Tab": {
        // Shift+Tab goes back to search input
        if (e.shiftKey) {
          e.preventDefault();
          const searchInput = this.dropdown.querySelector(".code-lang-search") as HTMLInputElement;
          if (searchInput) {
            searchInput.focus();
          }
        } else {
          // Tab without shift moves to next item
          e.preventDefault();
          this.moveHighlight(items, 1);
        }
        break;
      }
      case "Enter": {
        e.preventDefault();
        const target = e.target as HTMLElement;
        if (target.classList.contains("code-lang-item")) {
          const langId = target.dataset.langId || "";
          this.selectLanguage(langId);
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        this.closeDropdown();
        break;
    }
  };

  private moveHighlight(items: HTMLElement[], direction: number): void {
    const currentHighlighted = items.find((item) => item.classList.contains("highlighted"));
    const currentIndex = currentHighlighted ? items.indexOf(currentHighlighted) : -1;

    // Remove current highlight
    currentHighlighted?.classList.remove("highlighted");

    // Calculate new index
    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= items.length) newIndex = items.length - 1;

    // Apply new highlight and focus
    items[newIndex].classList.add("highlighted");
    items[newIndex].scrollIntoView({ block: "nearest" });
    items[newIndex].focus();
  }

  private selectLanguage(langId: string): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    this.editor.chain().focus().updateAttributes("codeBlock", { language: langId }).run();
    this.closeDropdown();
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Ignore mutations to the gutter and language selector
    if (mutation.type === "selection") {
      return false;
    }
    if (this.gutter.contains(mutation.target as Node)) {
      return true;
    }
    if (this.langSelector.contains(mutation.target as Node)) {
      return true;
    }
    if (this.dropdown?.contains(mutation.target as Node)) {
      return true;
    }
    return false;
  }
}

/**
 * Extended CodeBlockLowlight with line numbers and language selector.
 */
export const CodeBlockWithLineNumbers = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => new CodeBlockNodeView(node, editor, getPos as () => number | undefined);
  },
}).configure({ lowlight });
