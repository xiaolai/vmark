/**
 * CodeBlock extension with line numbers support.
 *
 * Uses a custom NodeView to render line numbers in a gutter.
 */
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";

const lowlight = createLowlight(common);

/**
 * Custom NodeView for code blocks with line numbers.
 */
class CodeBlockNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private gutter: HTMLElement;
  private codeElement: HTMLElement;
  private node: ProseMirrorNode;

  constructor(node: ProseMirrorNode) {
    this.node = node;
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

    // Update line numbers
    this.updateLineNumbers();
    return true;
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

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Ignore mutations to the gutter
    if (mutation.type === "selection") {
      return false;
    }
    if (this.gutter.contains(mutation.target as Node)) {
      return true;
    }
    return false;
  }
}

/**
 * Extended CodeBlockLowlight with line numbers support.
 */
export const CodeBlockWithLineNumbers = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node }) => new CodeBlockNodeView(node);
  },
}).configure({ lowlight });
