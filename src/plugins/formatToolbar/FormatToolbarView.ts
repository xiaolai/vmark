/**
 * Format Toolbar View
 *
 * DOM-based floating toolbar for inline formatting in Milkdown.
 * Supports three modes:
 * - format: inline formatting (bold, italic, etc.)
 * - heading: heading level selection (H1-H6, paragraph)
 * - code: language picker for code blocks
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import { useFormatToolbarStore, type ToolbarMode, type ContextMode } from "@/stores/formatToolbarStore";
import { expandedToggleMark } from "@/plugins/editorPlugins";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import {
  QUICK_LANGUAGES,
  getQuickLabel,
  getRecentLanguages,
  addRecentLanguage,
  filterLanguages,
} from "@/plugins/sourceFormatPopup/languages";

// SVG Icons (matching source mode popup)
const icons = {
  bold: `<svg viewBox="0 0 24 24"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></svg>`,
  italic: `<svg viewBox="0 0 24 24"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>`,
  strikethrough: `<svg viewBox="0 0 24 24"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg>`,
  code: `<svg viewBox="0 0 24 24"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`,
  highlight: `<svg viewBox="0 0 24 24"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`,
  link: `<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  subscript: `<svg viewBox="0 0 24 24"><path d="m4 5 8 8"/><path d="m12 5-8 8"/><path d="M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07"/></svg>`,
  superscript: `<svg viewBox="0 0 24 24"><path d="m4 19 8-8"/><path d="m12 19-8-8"/><path d="M20 12h-4c0-1.5.442-2 1.5-2.5S20 8.334 20 7c0-.472-.167-.933-.48-1.29a2.105 2.105 0 0 0-2.617-.436c-.42.239-.738.614-.903 1.06"/></svg>`,
  // Heading icons
  h1: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/></svg>`,
  h2: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>`,
  h3: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>`,
  h4: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 10v4h4"/><path d="M21 10v8"/></svg>`,
  h5: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 18h4c0-3-4-4-4-7h4"/></svg>`,
  h6: `<svg viewBox="0 0 24 24"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><circle cx="19" cy="16" r="2"/><path d="M20 10c-2 0-3 1.5-3 4"/></svg>`,
  paragraph: `<svg viewBox="0 0 24 24"><path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/></svg>`,
  // Insert icons
  image: `<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  math: `<svg viewBox="0 0 24 24"><path d="M18 7V4H6l6 8-6 8h12v-3"/></svg>`,
  footnote: `<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 21h12"/></svg>`,
  orderedList: `<svg viewBox="0 0 24 24"><line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>`,
  unorderedList: `<svg viewBox="0 0 24 24"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`,
  blockquote: `<svg viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>`,
  table: `<svg viewBox="0 0 24 24"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>`,
  divider: `<svg viewBox="0 0 24 24"><line x1="3" x2="21" y1="12" y2="12"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`,
};

// Button definitions with mark types (reordered per requirements)
const FORMAT_BUTTONS = [
  { icon: icons.bold, title: "Bold (⌘B)", markType: "strong" },
  { icon: icons.italic, title: "Italic (⌘I)", markType: "emphasis" },
  { icon: icons.highlight, title: "Highlight (⌥⌘H)", markType: "highlight" },
  { icon: icons.strikethrough, title: "Strikethrough (⌘⇧X)", markType: "strike_through" },
  { icon: icons.link, title: "Link (⌘K)", markType: "link" },
  { icon: icons.superscript, title: "Superscript", markType: "superscript" },
  { icon: icons.subscript, title: "Subscript", markType: "subscript" },
  { icon: icons.code, title: "Inline Code (⌘`)", markType: "inlineCode" },
];

// Inline insert buttons (when cursor not in word, not at blank line)
const INLINE_INSERT_BUTTONS = [
  { icon: icons.image, title: "Image", action: "inline-image" },
  { icon: icons.math, title: "Math", action: "inline-math" },
  { icon: icons.footnote, title: "Footnote", action: "footnote" },
];

// Block insert buttons (when cursor at beginning of blank line)
const BLOCK_INSERT_BUTTONS = [
  { icon: icons.image, title: "Image", action: "block-image" },
  { icon: icons.orderedList, title: "Ordered List", action: "ordered-list" },
  { icon: icons.unorderedList, title: "Unordered List", action: "unordered-list" },
  { icon: icons.blockquote, title: "Blockquote", action: "blockquote" },
  { icon: icons.table, title: "Table", action: "table" },
  { icon: icons.divider, title: "Divider", action: "divider" },
];

// Heading buttons (level 0 = paragraph)
const HEADING_BUTTONS = [
  { icon: icons.h1, title: "Heading 1 (⌘1)", level: 1 },
  { icon: icons.h2, title: "Heading 2 (⌘2)", level: 2 },
  { icon: icons.h3, title: "Heading 3 (⌘3)", level: 3 },
  { icon: icons.h4, title: "Heading 4 (⌘4)", level: 4 },
  { icon: icons.h5, title: "Heading 5 (⌘5)", level: 5 },
  { icon: icons.h6, title: "Heading 6 (⌘6)", level: 6 },
  { icon: icons.paragraph, title: "Paragraph (⌘0)", level: 0 },
];

/**
 * Format toolbar view - manages the floating toolbar UI.
 */
export class FormatToolbarView {
  private container: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private wasOpen = false;
  private currentMode: ToolbarMode = "format";
  private currentContextMode: ContextMode = "format";
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(view: EditorView) {
    this.editorView = view;

    // Build DOM structure
    this.container = this.buildContainer("format");

    // Append to document body
    document.body.appendChild(this.container);

    // Subscribe to store changes
    this.unsubscribe = useFormatToolbarStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        // Update editor view reference if changed
        if (state.editorView) {
          this.editorView = state.editorView;
        }
        // Rebuild container if mode or contextMode changed
        const modeChanged = state.mode !== this.currentMode;
        const contextModeChanged = state.mode === "format" && state.contextMode !== this.currentContextMode;
        if (modeChanged || contextModeChanged) {
          this.rebuildContainer(
            state.mode,
            state.headingInfo?.level,
            state.contextMode,
            state.codeBlockInfo?.language
          );
          this.currentMode = state.mode;
          this.currentContextMode = state.contextMode;
        } else if (state.mode === "heading" && state.headingInfo) {
          // Update active state for heading buttons
          this.updateHeadingActiveState(state.headingInfo.level);
        }
        if (!this.wasOpen) {
          this.show(state.anchorRect);
        } else {
          this.updatePosition(state.anchorRect);
        }
        this.wasOpen = true;
      } else {
        this.hide();
        this.wasOpen = false;
      }
    });
  }

  private getFocusableElements(): HTMLElement[] {
    return Array.from(
      this.container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }

  private setupKeyboardNavigation() {
    // Remove any existing handler first to prevent duplicates
    this.removeKeyboardNavigation();

    this.keydownHandler = (e: KeyboardEvent) => {
      // Only handle when toolbar is visible and open
      if (!useFormatToolbarStore.getState().isOpen) return;
      if (this.container.style.display === "none") return;

      // Check if focus is inside toolbar for keyboard nav
      const activeEl = document.activeElement as HTMLElement;
      const focusInToolbar = this.container.contains(activeEl);

      // Close on Escape (always, regardless of focus)
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        useFormatToolbarStore.getState().closeToolbar();
        this.editorView.focus();
        return;
      }

      // Toggle on Cmd+E only if focus is inside toolbar
      if (focusInToolbar && (e.key === "e" || e.key === "E") && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        useFormatToolbarStore.getState().closeToolbar();
        this.editorView.focus();
        return;
      }

      // Tab navigation within toolbar (match Source mode exactly)
      // Only handle if focus is inside the toolbar
      if (e.key === "Tab" && focusInToolbar) {
        const focusable = this.getFocusableElements();
        if (focusable.length === 0) return;

        const currentIndex = focusable.indexOf(activeEl);

        if (e.shiftKey) {
          // Shift+Tab: go backwards
          e.preventDefault();
          e.stopPropagation();
          const prevIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
          focusable[prevIndex].focus();
        } else {
          // Tab: go forwards
          e.preventDefault();
          e.stopPropagation();
          const nextIndex = currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
          focusable[nextIndex].focus();
        }
      }
    };

    // Use capture phase to ensure we handle Tab before ProseMirror
    document.addEventListener("keydown", this.keydownHandler, true);
  }

  private removeKeyboardNavigation() {
    if (this.keydownHandler) {
      // Must match the capture phase used when adding
      document.removeEventListener("keydown", this.keydownHandler, true);
      this.keydownHandler = null;
    }
  }

  private buildContainer(mode: ToolbarMode, activeLevel?: number, contextMode: ContextMode = "format", activeLanguage?: string): HTMLElement {
    const container = document.createElement("div");
    container.className = "format-toolbar";
    container.style.display = "none";

    const row = document.createElement("div");
    row.className = "format-toolbar-row";

    if (mode === "code") {
      // Code mode: language picker (matching Source mode)
      const recentLangs = getRecentLanguages();
      const quickLangs = recentLangs.length > 0
        ? recentLangs.slice(0, 5)
        : QUICK_LANGUAGES.map((l) => l.name);

      // Quick language buttons
      const quickContainer = document.createElement("div");
      quickContainer.className = "format-toolbar-quick-langs";
      for (const name of quickLangs) {
        const btn = this.buildLanguageButton(name, activeLanguage === name);
        quickContainer.appendChild(btn);
      }
      row.appendChild(quickContainer);

      // Separator
      const separator = document.createElement("div");
      separator.className = "format-toolbar-separator";
      row.appendChild(separator);

      // Dropdown trigger for more languages
      const dropdown = this.buildLanguageDropdown(activeLanguage || "");
      row.appendChild(dropdown);
    } else if (mode === "heading") {
      for (const btn of HEADING_BUTTONS) {
        const btnEl = this.buildHeadingButton(btn.icon, btn.title, btn.level);
        if (btn.level === activeLevel) {
          btnEl.classList.add("active");
        }
        row.appendChild(btnEl);
      }
    } else if (contextMode === "inline-insert") {
      for (const btn of INLINE_INSERT_BUTTONS) {
        row.appendChild(this.buildInsertButton(btn.icon, btn.title, btn.action));
      }
    } else if (contextMode === "block-insert") {
      for (const btn of BLOCK_INSERT_BUTTONS) {
        row.appendChild(this.buildInsertButton(btn.icon, btn.title, btn.action));
      }
    } else {
      // Default: format buttons
      for (const btn of FORMAT_BUTTONS) {
        row.appendChild(this.buildFormatButton(btn.icon, btn.title, btn.markType));
      }
    }

    container.appendChild(row);
    return container;
  }

  private rebuildContainer(mode: ToolbarMode, activeLevel?: number, contextMode: ContextMode = "format", activeLanguage?: string) {
    const wasVisible = this.container.style.display !== "none";
    const oldContainer = this.container;

    this.container = this.buildContainer(mode, activeLevel, contextMode, activeLanguage);
    this.container.style.display = wasVisible ? "flex" : "none";
    this.container.style.position = "fixed";

    oldContainer.replaceWith(this.container);
  }

  private updateHeadingActiveState(level: number) {
    const buttons = this.container.querySelectorAll(".format-toolbar-btn");
    buttons.forEach((btn, index) => {
      if (HEADING_BUTTONS[index]?.level === level) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  private buildFormatButton(
    iconSvg: string,
    title: string,
    markType: string
  ): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "format-toolbar-btn";
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = iconSvg;

    // Prevent mousedown from stealing focus
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleFormat(markType);
    });

    return btn;
  }

  private buildHeadingButton(
    iconSvg: string,
    title: string,
    level: number
  ): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "format-toolbar-btn";
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = iconSvg;

    // Prevent mousedown from stealing focus
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleHeadingChange(level);
    });

    return btn;
  }

  private buildInsertButton(
    iconSvg: string,
    title: string,
    action: string
  ): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "format-toolbar-btn";
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = iconSvg;

    // Prevent mousedown from stealing focus
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleInsert(action);
    });

    return btn;
  }

  private buildLanguageButton(name: string, isActive: boolean): HTMLElement {
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
      this.handleLanguageChange(name);
    });

    return btn;
  }

  private buildLanguageDropdown(currentLanguage: string): HTMLElement {
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
      this.toggleLanguageMenu(dropdown);
    });

    dropdown.appendChild(trigger);
    return dropdown;
  }

  private toggleLanguageMenu(dropdown: HTMLElement) {
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
      this.updateLanguageList(listContainer, searchInput.value);
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
          this.handleLanguageChange(filtered[0].name);
        }
      }
    });
    searchContainer.appendChild(searchInput);
    menu.appendChild(searchContainer);

    // Language list
    const listContainer = document.createElement("div");
    listContainer.className = "format-toolbar-lang-list";
    this.updateLanguageList(listContainer, "");
    menu.appendChild(listContainer);

    dropdown.appendChild(menu);

    // Focus search input
    setTimeout(() => searchInput.focus(), 50);
  }

  private updateLanguageList(container: HTMLElement, query: string) {
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
        this.handleLanguageChange(name);
      });

      container.appendChild(item);
    }
  }

  private handleLanguageChange(language: string) {
    const { state, dispatch } = this.editorView;
    const store = useFormatToolbarStore.getState();
    const codeBlockInfo = store.codeBlockInfo;

    if (!codeBlockInfo) return;

    const { nodePos } = codeBlockInfo;
    const node = state.doc.nodeAt(nodePos);

    if (node) {
      const tr = state.tr.setNodeMarkup(nodePos, undefined, {
        ...node.attrs,
        language,
      });
      dispatch(tr);
    }

    // Track recent language
    addRecentLanguage(language);

    this.editorView.focus();
    store.closeToolbar();
  }

  private handleFormat(markType: string) {
    this.editorView.focus();
    expandedToggleMark(this.editorView, markType);
    // Close toolbar after action
    useFormatToolbarStore.getState().closeToolbar();
  }

  private handleHeadingChange(level: number) {
    const { state, dispatch } = this.editorView;
    const store = useFormatToolbarStore.getState();
    const headingInfo = store.headingInfo;

    if (!headingInfo) return;

    const { nodePos } = headingInfo;

    if (level === 0) {
      // Convert to paragraph
      const paragraphType = state.schema.nodes.paragraph;
      if (paragraphType) {
        const tr = state.tr.setNodeMarkup(nodePos, paragraphType);
        dispatch(tr);
      }
    } else {
      // Change heading level
      const headingType = state.schema.nodes.heading;
      if (headingType) {
        const tr = state.tr.setNodeMarkup(nodePos, headingType, { level });
        dispatch(tr);
      }
    }

    this.editorView.focus();
    store.closeToolbar();
  }

  private handleInsert(action: string) {
    const { state, dispatch } = this.editorView;
    const { from } = state.selection;
    let textToInsert = "";

    switch (action) {
      // Inline inserts
      case "inline-image":
        textToInsert = "![](url)";
        break;
      case "inline-math":
        textToInsert = "$formula$";
        break;
      case "footnote":
        textToInsert = "[^1]";
        break;
      // Block inserts
      case "block-image":
        textToInsert = "![](url)\n";
        break;
      case "ordered-list":
        textToInsert = "1. ";
        break;
      case "unordered-list":
        textToInsert = "- ";
        break;
      case "blockquote":
        textToInsert = "> ";
        break;
      case "table":
        textToInsert = "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n";
        break;
      case "divider":
        textToInsert = "---\n";
        break;
      default:
        return;
    }

    // Insert text at cursor position
    const tr = state.tr.insertText(textToInsert, from);
    dispatch(tr);

    this.editorView.focus();
    useFormatToolbarStore.getState().closeToolbar();
  }

  private show(anchorRect: AnchorRect) {
    this.container.style.display = "flex";
    this.container.style.position = "fixed";
    this.updatePosition(anchorRect);

    // Set up keyboard navigation
    this.setupKeyboardNavigation();

    // Focus first button after a short delay
    setTimeout(() => {
      const focusable = this.getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 50);
  }

  private updatePosition(anchorRect: AnchorRect) {
    // Get boundaries
    const containerEl = this.editorView.dom.closest(".editor-container") as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.editorView.dom as HTMLElement, containerEl)
      : getViewportBounds();

    // Measure toolbar
    const toolbarWidth = this.container.offsetWidth || 280;
    const toolbarHeight = this.container.offsetHeight || 36;

    // Calculate position - prefer above the cursor
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: toolbarWidth, height: toolbarHeight },
      bounds,
      gap: 8,
      preferAbove: true,
    });

    this.container.style.top = `${top}px`;
    this.container.style.left = `${left}px`;
  }

  private hide() {
    this.container.style.display = "none";
    this.removeKeyboardNavigation();
  }

  destroy() {
    this.unsubscribe();
    this.removeKeyboardNavigation();
    this.container.remove();
  }
}
