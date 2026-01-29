import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";
import { useSettingsStore, type HtmlRenderingMode } from "@/stores/settingsStore";
import { useViewSettingsStore } from "@/stores/viewSettingsStore";
import { sanitizeHtmlPreview } from "@/utils/sanitize";

interface HtmlNodeViewOptions {
  inline: boolean;
  typeName: "html_inline" | "html_block";
  dataType: "html" | "html-block";
}

class BaseHtmlNodeView implements NodeView {
  dom: HTMLElement;

  private value: string;
  private renderMode: HtmlRenderingMode;
  private unsubscribe: (() => void) | null = null;
  private options: HtmlNodeViewOptions;

  constructor(node: PMNode, options: HtmlNodeViewOptions) {
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

    // Switch to source mode
    const viewSettings = useViewSettingsStore.getState();
    if (!viewSettings.sourceMode) {
      viewSettings.toggleSourceMode();
    }
  };

  update(node: PMNode): boolean {
    if (node.type.name !== this.options.typeName) return false;

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
