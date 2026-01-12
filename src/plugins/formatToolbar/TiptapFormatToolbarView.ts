import type { EditorView } from "@tiptap/pm/view";
import { emit } from "@tauri-apps/api/event";
import type { AnchorRect } from "@/utils/popupPosition";
import { useFormatToolbarStore } from "@/stores/formatToolbarStore";
import type { ToolbarMode, ContextMode, NodeContext } from "@/stores/formatToolbarStore";
import { addRecentLanguage, getQuickLabel, getRecentLanguages, QUICK_LANGUAGES } from "@/plugins/sourceFormatPopup/languages";
import { expandedToggleMarkTiptap } from "@/plugins/editorPlugins.tiptap";
import { handleBlockquoteNest, handleBlockquoteUnnest, handleListIndent, handleListOutdent, handleRemoveBlockquote, handleRemoveList, handleToBulletList, handleToOrderedList } from "./nodeActions.tiptap";
import { toggleTiptapLanguageMenu } from "./tiptapLanguageMenu";
import { TIPTAP_FORMAT_BUTTONS, TIPTAP_HEADING_BUTTONS, tiptapToolbarIcons } from "./tiptapUi";
import { createToolbarButton, createToolbarRow } from "./tiptapToolbarDom";
import { getFocusableElements, installToolbarNavigation } from "./tiptapToolbarNavigation";
import { positionTiptapToolbar } from "./tiptapToolbarPosition";
import { appendTiptapTableRows } from "./tiptapTableRows";

export class TiptapFormatToolbarView {
  private container: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private wasOpen = false;
  private currentMode: ToolbarMode = "format";
  private currentContextMode: ContextMode = "format";
  private currentNodeContext: NodeContext = null;
  private removeNavigation: (() => void) | null = null;

  constructor(view: EditorView) {
    this.editorView = view;
    this.container = document.createElement("div");
    this.container.className = "format-toolbar";
    this.container.style.display = "none";
    document.body.appendChild(this.container);

    this.unsubscribe = useFormatToolbarStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        if (state.editorView) {
          this.editorView = state.editorView as unknown as EditorView;
        }

        const isFirstOpen = !this.wasOpen;
        const modeChanged = state.mode !== this.currentMode;
        const contextModeChanged = state.mode === "format" && state.contextMode !== this.currentContextMode;
        const nodeContextChanged = state.mode === "merged" && state.nodeContext?.type !== this.currentNodeContext?.type;

        // Render on first open OR when mode/context changes
        if (isFirstOpen || modeChanged || contextModeChanged || nodeContextChanged) {
          this.render(state.mode, state.contextMode, state.headingInfo?.level ?? 0, state.nodeContext);
          this.currentMode = state.mode;
          this.currentContextMode = state.contextMode;
          this.currentNodeContext = state.nodeContext;
        } else if (state.mode === "heading" && state.headingInfo) {
          this.updateHeadingActiveState(state.headingInfo.level);
        }

        if (isFirstOpen) {
          this.show(state.anchorRect);
        } else {
          positionTiptapToolbar({ container: this.container, editorView: this.editorView, anchorRect: state.anchorRect });
        }
        this.wasOpen = true;
      } else {
        this.hide();
        this.wasOpen = false;
      }
    });
  }

  private render(mode: ToolbarMode, contextMode: ContextMode, activeHeadingLevel: number, nodeContext: NodeContext) {
    this.container.innerHTML = "";

    if (mode === "heading") {
      const row = createToolbarRow();
      for (const btn of TIPTAP_HEADING_BUTTONS) {
        row.appendChild(
          createToolbarButton({
            icon: btn.icon,
            title: btn.title,
            active: btn.level === activeHeadingLevel,
            onClick: () => this.handleHeadingChange(btn.level),
          })
        );
      }
      this.container.appendChild(row);
      return;
    }

    if (mode === "code") {
      this.container.appendChild(this.buildCodeRow());
      return;
    }

    // mode === "format" or "merged"
    if (mode === "format") {
      if (contextMode === "format") {
        this.container.appendChild(this.buildFormatRow());
      } else {
        this.container.appendChild(this.buildInsertRow(contextMode));
      }
    } else if (mode === "merged") {
      this.container.appendChild(this.buildFormatRow());
    }

    if (mode === "merged" && nodeContext) {
      if (nodeContext.type === "table") {
        appendTiptapTableRows(this.container, this.editorView);
      } else if (nodeContext.type === "list") {
        this.container.appendChild(this.buildListRow());
      } else if (nodeContext.type === "blockquote") {
        this.container.appendChild(this.buildBlockquoteRow());
      }
    }
  }

  private buildFormatRow(): HTMLElement {
    const row = createToolbarRow();
    for (const btn of TIPTAP_FORMAT_BUTTONS) {
      if (!this.editorView.state.schema.marks[btn.markType]) continue;
      row.appendChild(
        createToolbarButton({
          icon: btn.icon,
          title: btn.title,
          onClick: () => this.handleFormat(btn.markType),
        })
      );
    }
    return row;
  }

  private buildListRow(): HTMLElement {
    const row = createToolbarRow();
    row.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.indent, title: "Indent", onClick: () => this.handleListAction("indent") }));
    row.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.outdent, title: "Outdent", onClick: () => this.handleListAction("outdent") }));
    row.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.bulletList, title: "Bullet List", onClick: () => this.handleListAction("bullet") }));
    row.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.orderedList, title: "Ordered List", onClick: () => this.handleListAction("ordered") }));
    row.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.removeList, title: "Remove List", onClick: () => this.handleListAction("remove") }));
    return row;
  }

  private buildInsertRow(contextMode: ContextMode): HTMLElement {
    const row = createToolbarRow();
    const addButton = (icon: string, title: string, onClick: () => void) => {
      row.appendChild(createToolbarButton({ icon, title, onClick }));
    };

    addButton(tiptapToolbarIcons.image, "Insert Image", () => this.handleInsertAction("image"));
    addButton(tiptapToolbarIcons.table, "Insert Table", () => this.handleInsertAction("table"));
    addButton(tiptapToolbarIcons.bulletList, "Bullet List", () => this.handleInsertAction("unordered-list"));
    addButton(tiptapToolbarIcons.orderedList, "Ordered List", () => this.handleInsertAction("ordered-list"));
    addButton(tiptapToolbarIcons.blockquote, "Blockquote", () => this.handleInsertAction("blockquote"));
    if (contextMode === "block-insert") {
      addButton(tiptapToolbarIcons.divider, "Divider", () => this.handleInsertAction("divider"));
    }

    return row;
  }

  private buildBlockquoteRow(): HTMLElement {
    const row = createToolbarRow();
    row.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.nestQuote, title: "Nest", onClick: () => this.handleQuoteAction("nest") }));
    row.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.unnestQuote, title: "Unnest", onClick: () => this.handleQuoteAction("unnest") }));
    row.appendChild(createToolbarButton({ icon: tiptapToolbarIcons.removeQuote, title: "Remove", onClick: () => this.handleQuoteAction("remove") }));
    return row;
  }

  private buildCodeRow(): HTMLElement {
    const row = createToolbarRow();
    row.classList.add("format-toolbar-quick-langs");

    const store = useFormatToolbarStore.getState();
    const currentLang = store.codeBlockInfo?.language || "";

    const quick = QUICK_LANGUAGES.map((l) => l.name);
    const recent = getRecentLanguages().filter((l) => !quick.includes(l));
    const merged = [...quick, ...recent].slice(0, 8);

    for (const lang of merged) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `format-toolbar-quick-btn${lang === currentLang ? " active" : ""}`;
      btn.textContent = getQuickLabel(lang);
      btn.title = lang;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleLanguageChange(lang);
      });
      row.appendChild(btn);
    }

    const dropdown = document.createElement("div");
    dropdown.className = "format-toolbar-dropdown";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "format-toolbar-btn format-toolbar-dropdown-trigger";
    trigger.innerHTML = `<span class="format-toolbar-lang-label">${currentLang || "lang"}</span>${tiptapToolbarIcons.chevronDown}`;
    trigger.addEventListener("mousedown", (e) => e.preventDefault());
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTiptapLanguageMenu({ dropdown, onSelect: (lang) => this.handleLanguageChange(lang) });
    });
    dropdown.appendChild(trigger);
    row.appendChild(dropdown);

    return row;
  }

  private updateHeadingActiveState(level: number) {
    const buttons = Array.from(this.container.querySelectorAll<HTMLButtonElement>(".format-toolbar-btn"));
    for (const btn of buttons) {
      btn.classList.remove("active");
    }
    const index = TIPTAP_HEADING_BUTTONS.findIndex((b) => b.level === level);
    if (index >= 0 && buttons[index]) {
      buttons[index].classList.add("active");
    }
  }

  private handleFormat(markType: string) {
    this.editorView.focus();
    expandedToggleMarkTiptap(this.editorView, markType);
    const store = useFormatToolbarStore.getState();
    store.clearOriginalCursor();
    store.closeToolbar();
  }

  private handleHeadingChange(level: number) {
    const store = useFormatToolbarStore.getState();
    const headingInfo = store.headingInfo;
    if (!headingInfo) return;

    const { state, dispatch } = this.editorView;
    const { nodePos } = headingInfo;

    if (level === 0) {
      const paragraphType = state.schema.nodes.paragraph;
      if (paragraphType) {
        dispatch(state.tr.setNodeMarkup(nodePos, paragraphType));
      }
    } else {
      const headingType = state.schema.nodes.heading;
      if (headingType) {
        dispatch(state.tr.setNodeMarkup(nodePos, headingType, { level }));
      }
    }

    this.editorView.focus();
    store.clearOriginalCursor();
    store.closeToolbar();
  }

  private handleLanguageChange(language: string) {
    const store = useFormatToolbarStore.getState();
    const info = store.codeBlockInfo;
    if (!info) return;

    const { state, dispatch } = this.editorView;
    const node = state.doc.nodeAt(info.nodePos);
    if (node) {
      dispatch(state.tr.setNodeMarkup(info.nodePos, undefined, { ...node.attrs, language }));
    }

    addRecentLanguage(language);
    this.editorView.focus();
    store.clearOriginalCursor();
    store.closeToolbar();
  }

  private handleListAction(action: "indent" | "outdent" | "bullet" | "ordered" | "remove") {
    if (action === "indent") handleListIndent(this.editorView);
    if (action === "outdent") handleListOutdent(this.editorView);
    if (action === "bullet") handleToBulletList(this.editorView);
    if (action === "ordered") handleToOrderedList(this.editorView);
    if (action === "remove") handleRemoveList(this.editorView);
    const store = useFormatToolbarStore.getState();
    store.clearOriginalCursor();
    store.closeToolbar();
  }

  private handleInsertAction(action: "image" | "table" | "unordered-list" | "ordered-list" | "blockquote" | "divider") {
    if (action === "image") void emit("menu:image");
    if (action === "table") void emit("menu:insert-table");
    if (action === "unordered-list") void emit("menu:unordered-list");
    if (action === "ordered-list") void emit("menu:ordered-list");
    if (action === "blockquote") void emit("menu:quote");
    if (action === "divider") void emit("menu:horizontal-line");
    const store = useFormatToolbarStore.getState();
    store.clearOriginalCursor();
    store.closeToolbar();
  }

  private handleQuoteAction(action: "nest" | "unnest" | "remove") {
    if (action === "nest") handleBlockquoteNest(this.editorView);
    if (action === "unnest") handleBlockquoteUnnest(this.editorView);
    if (action === "remove") handleRemoveBlockquote(this.editorView);
    const store = useFormatToolbarStore.getState();
    store.clearOriginalCursor();
    store.closeToolbar();
  }

  private show(anchorRect: AnchorRect) {
    this.container.style.display = "flex";
    positionTiptapToolbar({ container: this.container, editorView: this.editorView, anchorRect });
    this.removeNavigation?.();
    this.removeNavigation = installToolbarNavigation({
      container: this.container,
      isOpen: () => useFormatToolbarStore.getState().isOpen,
      onClose: () => useFormatToolbarStore.getState().closeToolbar(),
    });
    this.focusInitialControl();
  }

  private hide() {
    this.container.style.display = "none";
    this.removeNavigation?.();
    this.removeNavigation = null;
  }

  private focusInitialControl() {
    setTimeout(() => {
      const focusable = getFocusableElements(this.container);
      if (focusable.length === 0) return;
      const store = useFormatToolbarStore.getState();
      if (store.mode === "heading") {
        const active = this.container.querySelector<HTMLElement>(".format-toolbar-btn.active");
        if (active) {
          active.focus();
          return;
        }
      }
      focusable[0].focus();
    }, 30);
  }

  destroy() {
    this.unsubscribe();
    this.removeNavigation?.();
    this.removeNavigation = null;
    this.container.remove();
  }
}
