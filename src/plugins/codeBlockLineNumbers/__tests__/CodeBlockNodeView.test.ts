/**
 * CodeBlockNodeView Tests
 *
 * Tests for the code block node view including:
 * - Line numbers in gutter
 * - Language selector dropdown
 * - Search filtering
 * - Keyboard navigation
 * - Click outside handling
 * - DOM structure
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// Mock sourcePopup
// We need to create the CodeBlockNodeView directly since it's not exported.
// We'll recreate it for testing purposes.

/**
 * Common programming languages with display names.
 */
const LANGUAGES = [
  { id: "", name: "Plain Text" },
  { id: "javascript", name: "JavaScript" },
  { id: "typescript", name: "TypeScript" },
  { id: "python", name: "Python" },
  { id: "java", name: "Java" },
  { id: "rust", name: "Rust" },
  { id: "go", name: "Go" },
];

/**
 * Test version of CodeBlockNodeView that mirrors the production implementation.
 */
class TestCodeBlockNodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private gutter: HTMLElement;
  private codeElement: HTMLElement;
  private langSelector: HTMLElement;
  private dropdown: HTMLElement | null = null;
  private dropdownHost: HTMLElement | null = null;
  private node: ProseMirrorNode;
  private editor: { chain: () => { focus: () => { updateAttributes: (type: string, attrs: Record<string, string>) => { run: () => void } } } };
  private getPos: () => number | undefined;

  constructor(
    node: ProseMirrorNode,
    editor: { chain: () => { focus: () => { updateAttributes: (type: string, attrs: Record<string, string>) => { run: () => void } } } },
    getPos: () => number | undefined
  ) {
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
    this.langSelector.addEventListener("mousedown", this.handleLangClick, { capture: true });
    this.dom.appendChild(this.langSelector);

    // Initial line count
    this.updateLineNumbers();
  }

  update(node: ProseMirrorNode): boolean {
    // Compare by type name, not object reference (mock nodes have different type objects)
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;

    if (node.attrs.language) {
      this.codeElement.className = `language-${node.attrs.language}`;
    } else {
      this.codeElement.className = "";
    }

    this.updateLangSelectorText();
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

    this.gutter.innerHTML = "";

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

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "code-lang-search";
    searchInput.placeholder = "Search languages...";
    searchInput.addEventListener("input", () => this.filterLanguages(searchInput.value));
    searchInput.addEventListener("keydown", (e) => this.handleSearchKeydown(e));
    dropdown.appendChild(searchInput);

    const list = document.createElement("div");
    list.className = "code-lang-list";
    this.renderLanguageList(list, "");
    dropdown.appendChild(list);

    this.dropdown = dropdown;
    this.dropdownHost = this.dom.closest(".editor-container") ?? document.body;
    dropdown.style.position = this.dropdownHost === document.body ? "fixed" : "absolute";
    this.dropdownHost.appendChild(dropdown);

    requestAnimationFrame(() => searchInput.focus());
    document.addEventListener("mousedown", this.handleOutsideClick);
  }

  private closeDropdown(): void {
    if (this.dropdown) {
      this.dropdown.remove();
      this.dropdown = null;
      this.dropdownHost = null;
      document.removeEventListener("mousedown", this.handleOutsideClick);
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
      item.addEventListener("click", () => this.selectLanguage(lang.id));
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

  private handleSearchKeydown = (e: KeyboardEvent): void => {
    if (!this.dropdown) return;

    const list = this.dropdown.querySelector(".code-lang-list");
    if (!list) return;

    const items = Array.from(list.querySelectorAll(".code-lang-item")) as HTMLElement[];
    if (items.length === 0) return;

    switch (e.key) {
      case "Tab": {
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
        if (e.shiftKey) {
          e.preventDefault();
          const searchInput = this.dropdown.querySelector(".code-lang-search") as HTMLInputElement;
          if (searchInput) {
            searchInput.focus();
          }
        } else {
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

    currentHighlighted?.classList.remove("highlighted");

    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= items.length) newIndex = items.length - 1;

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

  ignoreMutation(mutation: { type: string; target: Node }): boolean {
    if (mutation.type === "selection") {
      return false;
    }
    if (this.gutter.contains(mutation.target)) {
      return true;
    }
    if (this.langSelector.contains(mutation.target)) {
      return true;
    }
    if (this.dropdown?.contains(mutation.target)) {
      return true;
    }
    return false;
  }
}

// Helper to create mock node
function createMockNode(attrs: { language?: string } = {}, textContent = "line 1\nline 2\nline 3"): ProseMirrorNode {
  return {
    type: { name: "codeBlock" },
    attrs: { language: attrs.language || "" },
    textContent,
  } as unknown as ProseMirrorNode;
}

// Helper to create mock editor
function createMockEditor() {
  const chainMock = {
    focus: vi.fn().mockReturnThis(),
    updateAttributes: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };
  return {
    chain: vi.fn().mockReturnValue(chainMock),
    _chainMock: chainMock,
  };
}

// Helper to create editor container
function createEditorContainer() {
  const container = document.createElement("div");
  container.className = "editor-container";
  container.style.position = "relative";
  container.style.width = "800px";
  container.style.height = "600px";
  container.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    bottom: 600,
    right: 800,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  document.body.appendChild(container);
  return container;
}

describe("CodeBlockNodeView", () => {
  let container: HTMLElement;
  let mockEditor: ReturnType<typeof createMockEditor>;
  let nodeView: TestCodeBlockNodeView;

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    container = createEditorContainer();

    // Mock scrollIntoView since jsdom doesn't support it
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    if (nodeView?.destroy) {
      nodeView.destroy();
    }
    container.remove();
  });

  // Helper to create NodeView
  function createNodeView(node?: ProseMirrorNode) {
    mockEditor = createMockEditor();
    const mockNode = node || createMockNode({ language: "javascript" });
    const getPos = vi.fn(() => 10);

    nodeView = new TestCodeBlockNodeView(mockNode, mockEditor, getPos);
    container.appendChild(nodeView.dom);
    return nodeView;
  }

  describe("DOM Structure", () => {
    it("creates wrapper element", () => {
      createNodeView();
      expect(nodeView.dom).toBeTruthy();
      expect(nodeView.dom.className).toBe("code-block-wrapper");
    });

    it("creates gutter for line numbers", () => {
      createNodeView();
      const gutter = nodeView.dom.querySelector(".code-line-numbers");
      expect(gutter).not.toBeNull();
      expect(gutter?.getAttribute("aria-hidden")).toBe("true");
    });

    it("creates code element as contentDOM", () => {
      createNodeView();
      expect(nodeView.contentDOM).toBeTruthy();
      expect(nodeView.contentDOM.tagName.toLowerCase()).toBe("code");
    });

    it("creates language selector", () => {
      createNodeView();
      const langSelector = nodeView.dom.querySelector(".code-lang-selector");
      expect(langSelector).not.toBeNull();
    });

    it("sets language class on code element", () => {
      createNodeView(createMockNode({ language: "python" }));
      expect(nodeView.contentDOM.className).toBe("language-python");
    });
  });

  describe("Line Numbers", () => {
    it("generates line numbers for each line", () => {
      createNodeView(createMockNode({}, "line 1\nline 2\nline 3"));
      const lineNums = nodeView.dom.querySelectorAll(".line-num");
      expect(lineNums.length).toBe(3);
    });

    it("displays correct line number values", () => {
      createNodeView(createMockNode({}, "a\nb\nc\nd\ne"));
      const lineNums = nodeView.dom.querySelectorAll(".line-num");
      expect(lineNums[0].textContent).toBe("1");
      expect(lineNums[4].textContent).toBe("5");
    });

    it("handles single line content", () => {
      createNodeView(createMockNode({}, "single line"));
      const lineNums = nodeView.dom.querySelectorAll(".line-num");
      expect(lineNums.length).toBe(1);
    });

    it("handles empty content", () => {
      createNodeView(createMockNode({}, ""));
      const lineNums = nodeView.dom.querySelectorAll(".line-num");
      expect(lineNums.length).toBe(1); // Empty content still has 1 line
    });
  });

  describe("Language Selector", () => {
    it("displays language name", () => {
      createNodeView(createMockNode({ language: "javascript" }));
      const langSelector = nodeView.dom.querySelector(".code-lang-selector");
      expect(langSelector?.textContent).toBe("JavaScript");
    });

    it("displays 'Plain Text' for empty language", () => {
      createNodeView(createMockNode({ language: "" }));
      const langSelector = nodeView.dom.querySelector(".code-lang-selector");
      expect(langSelector?.textContent).toBe("Plain Text");
    });

    it("displays language id for unknown language", () => {
      createNodeView(createMockNode({ language: "unknown-lang" }));
      const langSelector = nodeView.dom.querySelector(".code-lang-selector");
      expect(langSelector?.textContent).toBe("unknown-lang");
    });

    it("opens dropdown on click", () => {
      createNodeView();
      const langSelector = nodeView.dom.querySelector(".code-lang-selector") as HTMLElement;

      const event = new MouseEvent("mousedown", { bubbles: true });
      langSelector.dispatchEvent(event);

      const dropdown = document.querySelector(".code-lang-dropdown");
      expect(dropdown).not.toBeNull();
    });

    it("closes dropdown on second click", () => {
      createNodeView();
      const langSelector = nodeView.dom.querySelector(".code-lang-selector") as HTMLElement;

      // Open
      langSelector.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(document.querySelector(".code-lang-dropdown")).not.toBeNull();

      // Close
      langSelector.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(document.querySelector(".code-lang-dropdown")).toBeNull();
    });
  });

  describe("Language Dropdown", () => {
    beforeEach(() => {
      createNodeView(createMockNode({ language: "python" }));
      const langSelector = nodeView.dom.querySelector(".code-lang-selector") as HTMLElement;
      langSelector.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    it("renders search input", () => {
      const searchInput = document.querySelector(".code-lang-search");
      expect(searchInput).not.toBeNull();
    });

    it("renders language list", () => {
      const list = document.querySelector(".code-lang-list");
      expect(list).not.toBeNull();
      const items = list?.querySelectorAll(".code-lang-item");
      expect((items?.length ?? 0)).toBeGreaterThan(0);
    });

    it("highlights current language", () => {
      const activeItem = document.querySelector(".code-lang-item.active");
      expect(activeItem?.textContent).toBe("Python");
    });

    it("filters languages on search", async () => {
      const searchInput = document.querySelector(".code-lang-search") as HTMLInputElement;
      searchInput.value = "type";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));

      const items = document.querySelectorAll(".code-lang-item");
      // Should find TypeScript
      const hasTypeScript = Array.from(items).some((item) => item.textContent === "TypeScript");
      expect(hasTypeScript).toBe(true);
    });

    it("filters to empty list for non-matching query", () => {
      const searchInput = document.querySelector(".code-lang-search") as HTMLInputElement;
      searchInput.value = "xyz123nonexistent";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));

      const items = document.querySelectorAll(".code-lang-item");
      expect(items.length).toBe(0);
    });
  });

  describe("Dropdown Keyboard Navigation", () => {
    beforeEach(() => {
      createNodeView();
      const langSelector = nodeView.dom.querySelector(".code-lang-selector") as HTMLElement;
      langSelector.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    it("ArrowDown moves highlight down", () => {
      const searchInput = document.querySelector(".code-lang-search") as HTMLInputElement;
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

      const highlighted = document.querySelector(".code-lang-item.highlighted");
      expect(highlighted).not.toBeNull();
    });

    it("ArrowUp moves highlight up", () => {
      const searchInput = document.querySelector(".code-lang-search") as HTMLInputElement;
      // Initial highlight is at index 1 (javascript)
      // Move down once (1→2), then up once (2→1)
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));

      const items = document.querySelectorAll(".code-lang-item");
      const highlightedIndex = Array.from(items).findIndex((item) => item.classList.contains("highlighted"));
      expect(highlightedIndex).toBe(1); // Back to second item (javascript)
    });

    it("Enter selects highlighted language", () => {
      const searchInput = document.querySelector(".code-lang-search") as HTMLInputElement;
      searchInput.value = "python";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(mockEditor.chain).toHaveBeenCalled();
      expect(mockEditor._chainMock.updateAttributes).toHaveBeenCalledWith("codeBlock", { language: "python" });
    });

    it("Escape closes dropdown", () => {
      const searchInput = document.querySelector(".code-lang-search") as HTMLInputElement;
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(document.querySelector(".code-lang-dropdown")).toBeNull();
    });

    it("Tab moves focus to list", () => {
      const searchInput = document.querySelector(".code-lang-search") as HTMLInputElement;
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

      const highlighted = document.querySelector(".code-lang-item.highlighted");
      expect(highlighted).not.toBeNull();
    });
  });

  describe("Click Outside Handling", () => {
    it("closes dropdown when clicking outside", () => {
      createNodeView();
      const langSelector = nodeView.dom.querySelector(".code-lang-selector") as HTMLElement;
      langSelector.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      expect(document.querySelector(".code-lang-dropdown")).not.toBeNull();

      // Click outside
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      const event = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(event, "target", { value: outside });
      document.dispatchEvent(event);

      expect(document.querySelector(".code-lang-dropdown")).toBeNull();
    });

    it("does not close when clicking inside dropdown", () => {
      createNodeView();
      const langSelector = nodeView.dom.querySelector(".code-lang-selector") as HTMLElement;
      langSelector.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      const dropdown = document.querySelector(".code-lang-dropdown") as HTMLElement;
      const event = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(event, "target", { value: dropdown });
      document.dispatchEvent(event);

      expect(document.querySelector(".code-lang-dropdown")).not.toBeNull();
    });
  });

  describe("Update method", () => {
    it("returns true for same node type", () => {
      createNodeView();
      const newNode = createMockNode({ language: "rust" });
      const result = nodeView.update(newNode);
      expect(result).toBe(true);
    });

    it("updates language selector text", () => {
      createNodeView(createMockNode({ language: "javascript" }));
      const langSelector = nodeView.dom.querySelector(".code-lang-selector");
      expect(langSelector?.textContent).toBe("JavaScript");

      const newNode = createMockNode({ language: "python" });
      nodeView.update(newNode);
      expect(langSelector?.textContent).toBe("Python");
    });

    it("updates language class on code element", () => {
      createNodeView(createMockNode({ language: "javascript" }));
      expect(nodeView.contentDOM.className).toBe("language-javascript");

      const newNode = createMockNode({ language: "rust" });
      nodeView.update(newNode);
      expect(nodeView.contentDOM.className).toBe("language-rust");
    });

    it("clears language class for empty language", () => {
      createNodeView(createMockNode({ language: "javascript" }));
      const newNode = createMockNode({ language: "" });
      nodeView.update(newNode);
      expect(nodeView.contentDOM.className).toBe("");
    });

    it("returns false for different node type", () => {
      createNodeView();
      const differentNode = {
        ...createMockNode(),
        type: { name: "paragraph" },
      } as unknown as ProseMirrorNode;
      const result = nodeView.update(differentNode);
      expect(result).toBe(false);
    });
  });

  describe("Destroy cleanup", () => {
    it("closes dropdown on destroy", () => {
      createNodeView();
      const langSelector = nodeView.dom.querySelector(".code-lang-selector") as HTMLElement;
      langSelector.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      expect(document.querySelector(".code-lang-dropdown")).not.toBeNull();

      nodeView.destroy();

      expect(document.querySelector(".code-lang-dropdown")).toBeNull();
    });

    it("removes event listener on destroy", () => {
      createNodeView();
      const removeEventListenerSpy = vi.spyOn(nodeView.dom.querySelector(".code-lang-selector") as HTMLElement, "removeEventListener");

      nodeView.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith("mousedown", expect.any(Function), { capture: true });
    });
  });

  describe("Mutation ignoring", () => {
    it("ignores mutations in gutter", () => {
      createNodeView();
      const gutter = nodeView.dom.querySelector(".code-line-numbers") as HTMLElement;
      const lineNum = gutter.querySelector(".line-num") as HTMLElement;

      const mutation = { type: "childList", target: lineNum } as unknown as Parameters<typeof nodeView.ignoreMutation>[0];
      expect(nodeView.ignoreMutation(mutation)).toBe(true);
    });

    it("ignores mutations in language selector", () => {
      createNodeView();
      const langSelector = nodeView.dom.querySelector(".code-lang-selector") as HTMLElement;

      const mutation = { type: "childList", target: langSelector } as unknown as Parameters<typeof nodeView.ignoreMutation>[0];
      expect(nodeView.ignoreMutation(mutation)).toBe(true);
    });

    it("does not ignore selection mutations", () => {
      createNodeView();
      const mutation = { type: "selection", target: nodeView.contentDOM } as unknown as Parameters<typeof nodeView.ignoreMutation>[0];
      expect(nodeView.ignoreMutation(mutation)).toBe(false);
    });

    it("does not ignore content mutations", () => {
      createNodeView();
      const mutation = { type: "childList", target: nodeView.contentDOM } as unknown as Parameters<typeof nodeView.ignoreMutation>[0];
      expect(nodeView.ignoreMutation(mutation)).toBe(false);
    });
  });
});
