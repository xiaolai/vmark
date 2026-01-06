/**
 * Format Toolbar View
 *
 * DOM-based floating toolbar for inline formatting in Milkdown.
 * Supports four modes:
 * - format: inline formatting (bold, italic, etc.)
 * - heading: heading level selection (H1-H6, paragraph)
 * - code: language picker for code blocks
 * - merged: format + node-specific actions (table, list, blockquote)
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx } from "@milkdown/kit/core";
import {
  useFormatToolbarStore,
  type ToolbarMode,
  type ContextMode,
  type NodeContext,
} from "@/stores/formatToolbarStore";
import type { AnchorRect } from "@/utils/popupPosition";
import {
  FORMAT_BUTTONS,
  INLINE_INSERT_BUTTONS,
  BLOCK_INSERT_BUTTONS,
  HEADING_BUTTONS,
  buildFormatButton,
  buildHeadingButton,
  buildInsertButton,
} from "./formatToolbarDom";
import { buildMergedToolbar } from "./formatToolbarMerged";
import { buildLanguageRow } from "./formatToolbarLanguageMenu";
import {
  handleLanguageChange,
  handleFormat,
  handleHeadingChange,
  handleInsert,
} from "./formatToolbarHandlers";
import {
  KeyboardNavigationManager,
  getFocusableElements,
} from "./formatToolbarNavigation";
import {
  showToolbar,
  updateToolbarPosition,
  hideToolbar,
} from "./formatToolbarPosition";

type EditorGetter = () => { action: (fn: (ctx: Ctx) => void) => void } | undefined;

/**
 * Format toolbar view - manages the floating toolbar UI.
 */
export class FormatToolbarView {
  private container: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private ctx: Ctx | null = null;
  private wasOpen = false;
  private currentMode: ToolbarMode = "format";
  private currentContextMode: ContextMode = "format";
  private currentNodeContext: NodeContext = null;
  private keyboardNav: KeyboardNavigationManager;

  constructor(view: EditorView, ctx?: Ctx) {
    this.editorView = view;
    this.ctx = ctx ?? null;

    this.container = this.buildContainer("format");
    document.body.appendChild(this.container);
    this.keyboardNav = new KeyboardNavigationManager(this.container, this.editorView);

    this.unsubscribe = useFormatToolbarStore.subscribe((state) => {
      this.handleStateChange(state);
    });
  }

  private handleStateChange(state: ReturnType<typeof useFormatToolbarStore.getState>): void {
    if (state.isOpen && state.anchorRect) {
      if (state.editorView) {
        this.editorView = state.editorView;
        this.keyboardNav.updateEditorView(state.editorView);
      }
      this.handleOpenState(state);
    } else {
      this.hide();
      this.wasOpen = false;
    }
  }

  private handleOpenState(state: ReturnType<typeof useFormatToolbarStore.getState>): void {
    const modeChanged = state.mode !== this.currentMode;
    const contextModeChanged = state.mode === "format" && state.contextMode !== this.currentContextMode;
    const nodeContextChanged = state.mode === "merged" && this.nodeContextChanged(state.nodeContext);

    if (modeChanged || contextModeChanged || nodeContextChanged) {
      this.rebuildContainer(
        state.mode,
        state.headingInfo?.level,
        state.contextMode,
        state.codeBlockInfo?.language,
        state.nodeContext
      );
      this.currentMode = state.mode;
      this.currentContextMode = state.contextMode;
      this.currentNodeContext = state.nodeContext;
    } else if (state.mode === "heading" && state.headingInfo) {
      this.updateHeadingActiveState(state.headingInfo.level);
    }

    if (!this.wasOpen) {
      this.show(state.anchorRect!);
    } else {
      updateToolbarPosition(this.container, this.editorView, state.anchorRect!);
    }
    this.wasOpen = true;
  }

  private nodeContextChanged(newContext: NodeContext): boolean {
    if (this.currentNodeContext === null && newContext === null) return false;
    if (this.currentNodeContext === null || newContext === null) return true;
    return this.currentNodeContext.type !== newContext.type;
  }

  private getEditor: EditorGetter = () => {
    if (!this.ctx) return undefined;
    try {
      this.ctx.get(editorViewCtx);
      return {
        action: (fn: (ctx: Ctx) => void) => fn(this.ctx!),
      };
    } catch {
      return undefined;
    }
  };

  private buildContainer(
    mode: ToolbarMode,
    activeLevel?: number,
    contextMode: ContextMode = "format",
    activeLanguage?: string,
    nodeContext?: NodeContext
  ): HTMLElement {
    const container = document.createElement("div");
    container.className = "format-toolbar";
    container.style.display = "none";

    if (mode === "merged" && nodeContext) {
      buildMergedToolbar(container, nodeContext, this.editorView, this.getEditor, (m) => handleFormat(this.editorView, m));
    } else if (mode === "code") {
      container.appendChild(buildLanguageRow(activeLanguage, (l) => handleLanguageChange(this.editorView, l)));
    } else if (mode === "heading") {
      this.buildHeadingRow(container, activeLevel);
    } else if (contextMode === "inline-insert") {
      this.buildInsertRow(container, INLINE_INSERT_BUTTONS);
    } else if (contextMode === "block-insert") {
      this.buildInsertRow(container, BLOCK_INSERT_BUTTONS);
    } else {
      this.buildFormatRow(container);
    }

    return container;
  }

  private buildHeadingRow(container: HTMLElement, activeLevel?: number): void {
    const row = document.createElement("div");
    row.className = "format-toolbar-row";
    for (const btn of HEADING_BUTTONS) {
      const btnEl = buildHeadingButton(btn.icon, btn.title, btn.level, (l) => handleHeadingChange(this.editorView, l));
      if (btn.level === activeLevel) {
        btnEl.classList.add("active");
      }
      row.appendChild(btnEl);
    }
    container.appendChild(row);
  }

  private buildInsertRow(container: HTMLElement, buttons: typeof INLINE_INSERT_BUTTONS): void {
    const row = document.createElement("div");
    row.className = "format-toolbar-row";
    for (const btn of buttons) {
      row.appendChild(buildInsertButton(btn.icon, btn.title, btn.action, (a) => handleInsert(this.editorView, a)));
    }
    container.appendChild(row);
  }

  private buildFormatRow(container: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "format-toolbar-row";
    for (const btn of FORMAT_BUTTONS) {
      row.appendChild(buildFormatButton(btn.icon, btn.title, btn.markType, (m) => handleFormat(this.editorView, m)));
    }
    container.appendChild(row);
  }

  private rebuildContainer(
    mode: ToolbarMode,
    activeLevel?: number,
    contextMode: ContextMode = "format",
    activeLanguage?: string,
    nodeContext?: NodeContext
  ): void {
    const wasVisible = this.container.style.display !== "none";
    const oldContainer = this.container;

    this.container = this.buildContainer(mode, activeLevel, contextMode, activeLanguage, nodeContext);
    this.container.style.display = wasVisible ? "flex" : "none";
    this.container.style.position = "fixed";
    this.keyboardNav.updateContainer(this.container);

    oldContainer.replaceWith(this.container);
  }

  private updateHeadingActiveState(level: number): void {
    const buttons = this.container.querySelectorAll(".format-toolbar-btn");
    buttons.forEach((btn, index) => {
      if (HEADING_BUTTONS[index]?.level === level) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  private show(anchorRect: AnchorRect): void {
    showToolbar(this.container, this.editorView, anchorRect);
    this.keyboardNav.setup();

    setTimeout(() => {
      const focusable = getFocusableElements(this.container);
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 50);
  }

  private hide(): void {
    hideToolbar(this.container);
    this.keyboardNav.remove();
  }

  destroy(): void {
    this.unsubscribe();
    this.keyboardNav.remove();
    this.container.remove();
  }
}
