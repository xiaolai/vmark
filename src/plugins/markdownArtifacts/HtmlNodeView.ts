/**
 * HTML Node View (Block + Inline)
 *
 * Purpose: Renders raw HTML nodes in WYSIWYG mode with configurable rendering modes
 * (hidden, sanitized, sanitized-with-styles). Subscribes to settings store to
 * live-update when the user changes the HTML rendering preference.
 *
 * Key decisions:
 *   - Single BaseHtmlNodeView class handles both inline and block variants to avoid duplication.
 *   - Double-click triggers Source mode switch with cursor sync via sourceLine attribute,
 *     because raw HTML can only be meaningfully edited in source.
 *   - HTML is sanitized before innerHTML injection to prevent XSS from user content.
 *
 * @coordinates-with htmlBlock.ts, htmlInline.ts — factory functions wrap this view
 * @coordinates-with settingsStore.ts — subscribes to `markdown.htmlRenderingMode`
 * @module plugins/markdownArtifacts/HtmlNodeView
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import { useSettingsStore, type HtmlRenderingMode } from "@/stores/settingsStore";
import { useEditorStore } from "@/stores/editorStore";
import { sanitizeHtmlPreview } from "@/utils/sanitize";
import type { CursorInfo } from "@/types/cursorSync";

interface HtmlNodeViewOptions {
  inline: boolean;
  typeName: "html_inline" | "html_block";
  dataType: "html" | "html-block";
}

class BaseHtmlNodeView implements NodeView {
  dom: HTMLElement;

  private node: PMNode;
  private value: string;
  private renderMode: HtmlRenderingMode;
  private unsubscribe: (() => void) | null = null;
  private options: HtmlNodeViewOptions;

  constructor(node: PMNode, options: HtmlNodeViewOptions) {
    this.node = node;
    this.options = options;
    this.value = String(node.attrs.value ?? "");
    this.renderMode = useSettingsStore.getState().markdown.htmlRenderingMode;

    this.dom = document.createElement(options.inline ? "span" : "div");
    this.dom.setAttribute("data-type", options.dataType);
    this.dom.setAttribute("data-value", this.value);
    this.dom.setAttribute("contenteditable", "false");
    this.dom.className = options.inline ? "html-preview-inline" : "html-preview-block";

    // Double-click to switch to Source mode
    this.dom.addEventListener("dblclick", this.handleDoubleClick);

    this.render();

    this.unsubscribe = useSettingsStore.subscribe((state) => {
      const nextMode = state.markdown.htmlRenderingMode;
      if (nextMode === this.renderMode) return;
      this.renderMode = nextMode;
      this.render();
    });
  }

  private handleDoubleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const sourceLine = this.node.attrs.sourceLine as number | null;
    if (sourceLine !== null) {
      // Create cursor info to sync position
      const cursorInfo: CursorInfo = {
        sourceLine,
        wordAtCursor: "",
        offsetInWord: 0,
        nodeType: "paragraph", // HTML blocks treated as paragraph-like
        percentInLine: 0,
        contextBefore: "",
        contextAfter: "",
      };
      useEditorStore.getState().setCursorInfo(cursorInfo);
    }

    // Switch to source mode
    const editorStore = useEditorStore.getState();
    if (!editorStore.sourceMode) {
      editorStore.toggleSourceMode();
    }
  };

  update(node: PMNode): boolean {
    if (node.type.name !== this.options.typeName) return false;

    this.node = node;
    const nextValue = String(node.attrs.value ?? "");
    if (nextValue !== this.value) {
      this.value = nextValue;
      this.render();
    }

    return true;
  }

  destroy(): void {
    this.dom.removeEventListener("dblclick", this.handleDoubleClick);
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  ignoreMutation(): boolean {
    return true;
  }

  private render(): void {
    this.dom.setAttribute("data-value", this.value);
    this.dom.setAttribute("data-render-mode", this.renderMode);

    if (this.renderMode === "hidden") {
      this.dom.style.display = "none";
      this.dom.innerHTML = "";
      return;
    }

    this.dom.style.display = this.options.inline ? "inline" : "block";

    const allowStyles = this.renderMode === "sanitizedWithStyles";
    this.dom.setAttribute("data-allow-styles", allowStyles ? "true" : "false");
    this.dom.innerHTML = sanitizeHtmlPreview(this.value, {
      allowStyles,
      context: this.options.inline ? "inline" : "block",
    });
  }
}

export function createHtmlInlineNodeView(node: PMNode): NodeView {
  return new BaseHtmlNodeView(node, {
    inline: true,
    typeName: "html_inline",
    dataType: "html",
  });
}

export function createHtmlBlockNodeView(node: PMNode): NodeView {
  return new BaseHtmlNodeView(node, {
    inline: false,
    typeName: "html_block",
    dataType: "html-block",
  });
}
