import { Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import katex from "katex";

class MathInlineNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private preview: HTMLElement;
  private view: EditorView;
  private getPos: (() => number) | false;

  constructor(node: PMNode, view: EditorView, getPos: (() => number) | false) {
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement("span");
    this.dom.className = "math-inline";
    this.dom.dataset.type = "math_inline";

    this.preview = document.createElement("span");
    this.preview.className = "math-inline-preview";
    this.preview.addEventListener("click", this.handlePreviewClick);
    this.dom.appendChild(this.preview);

    this.contentDOM = document.createElement("span");
    this.contentDOM.className = "math-inline-content";
    this.dom.appendChild(this.contentDOM);

    this.renderPreview(node.textContent || "");
  }

  private handlePreviewClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();

    if (this.getPos === false) return;
    const pos = this.getPos();

    const { tr } = this.view.state;
    this.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))));
    this.view.focus();
  };

  private renderPreview(content: string): void {
    const trimmed = content.trim();
    if (!trimmed) {
      this.preview.textContent = "";
      return;
    }

    try {
      katex.render(trimmed, this.preview, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      this.preview.textContent = trimmed;
      this.preview.classList.add("math-error");
    }
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "math_inline") return false;
    this.renderPreview(node.textContent || "");
    return true;
  }

  destroy(): void {
    this.preview.removeEventListener("click", this.handlePreviewClick);
  }
}

export const mathInlineExtension = Node.create({
  name: "math_inline",
  group: "inline",
  inline: true,
  content: "text*",
  marks: "",
  atom: false,
  code: true,

  parseHTML() {
    return [{ tag: 'span[data-type="math_inline"]', preserveWhitespace: "full" as const }];
  },

  renderHTML() {
    return ["span", { "data-type": "math_inline", class: "math-inline" }, 0];
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      return new MathInlineNodeView(node as PMNode, view as EditorView, getPos as (() => number) | false);
    };
  },
});
