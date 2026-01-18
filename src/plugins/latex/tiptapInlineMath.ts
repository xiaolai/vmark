import { Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import type { NodeView, EditorView } from "@tiptap/pm/view";
import { loadKatex } from "./katexLoader";
import { getMathPreviewView } from "@/plugins/mathPreview/MathPreviewView";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { inlineNodeEditingKey } from "@/plugins/inlineNodeEditing/tiptap";

/**
 * NodeView for inline math with inline editing support.
 *
 * Two modes:
 * 1. Preview mode: Shows rendered KaTeX
 * 2. Edit mode: Shows editable input with floating preview
 *
 * The `.editing` class is added by the inlineNodeEditing plugin
 * when cursor is at the node.
 */
class MathInlineNodeView implements NodeView {
  dom: HTMLElement;
  private previewDom: HTMLElement;
  private inputDom: HTMLInputElement | null = null;
  private measureSpan: HTMLSpanElement | null = null;
  private renderToken = 0;
  private getPos: (() => number | undefined) | null;
  private currentLatex: string;
  private editorView: EditorView | null;
  private isEditing = false;
  private exitingLeft = false; // Prevents re-entry when exiting left
  private exitingRight = false; // Prevents re-entry when exiting right
  private observer: MutationObserver | null = null;

  constructor(
    node: PMNode,
    view: EditorView,
    getPos?: () => number | undefined
  ) {
    this.editorView = view;
    this.getPos = getPos ?? null;
    this.currentLatex = String(node.attrs.content || "");

    // Create DOM structure
    this.dom = document.createElement("span");
    this.dom.className = "math-inline";
    this.dom.dataset.type = "math_inline";

    this.previewDom = document.createElement("span");
    this.previewDom.className = "math-inline-preview";
    this.dom.appendChild(this.previewDom);

    this.renderPreview(this.currentLatex);

    // Observe class changes to detect editing state
    this.observer = new MutationObserver(this.handleClassChange);
    this.observer.observe(this.dom, { attributes: true, attributeFilter: ["class"] });

    // Handle click to enter edit mode
    this.dom.addEventListener("click", this.handleClick);
  }

  private handleClassChange = () => {
    const hasEditing = this.dom.classList.contains("editing");
    if (hasEditing && !this.isEditing) {
      this.enterEditMode();
    } else if (!hasEditing && this.isEditing) {
      this.exitEditMode();
    }
  };

  private handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!this.isEditing) {
      // Trigger selection of the node to add .editing class
      if (this.getPos && this.editorView) {
        const pos = this.getPos();
        if (pos !== undefined) {
          const { state, dispatch } = this.editorView;
          const tr = state.tr.setSelection(
            Selection.near(state.doc.resolve(pos + 1))
          );
          dispatch(tr);
          this.editorView.focus();
        }
      }
    }
  };

  private enterEditMode() {
    if (this.isEditing) return;
    // Prevent re-entry when we just exited (cursor still at node boundary)
    if (this.exitingLeft || this.exitingRight) return;
    this.isEditing = true;

    // Get entry direction from the inlineNodeEditing plugin state
    let enteredFromRight = false;
    if (this.editorView) {
      const pluginState = inlineNodeEditingKey.getState(this.editorView.state);
      if (pluginState?.entryDirection === "right") {
        enteredFromRight = true;
      }
    }

    // Hide preview, show input
    this.previewDom.style.display = "none";

    // Create hidden span for measuring text width
    this.measureSpan = document.createElement("span");
    this.measureSpan.className = "math-inline-measure";
    this.measureSpan.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: pre;
      font-family: var(--font-mono, monospace);
      font-size: inherit;
    `;
    this.dom.appendChild(this.measureSpan);

    // Create editable input
    this.inputDom = document.createElement("input");
    this.inputDom.type = "text";
    this.inputDom.className = "math-inline-input";
    this.inputDom.value = this.currentLatex;
    this.inputDom.placeholder = "$";
    // Size input to content using measurement span
    this.updateInputSize();
    this.dom.appendChild(this.inputDom);

    // Show floating preview
    this.showFloatingPreview();

    // Focus the input with cursor at correct position based on entry direction
    const cursorPos = enteredFromRight ? this.inputDom.value.length : 0;
    requestAnimationFrame(() => {
      if (this.inputDom) {
        this.inputDom.focus();
        this.inputDom.setSelectionRange(cursorPos, cursorPos);
      }
    });

    // Add event listeners
    this.inputDom.addEventListener("input", this.handleInput);
    this.inputDom.addEventListener("keydown", this.handleKeydown);
    this.inputDom.addEventListener("blur", this.handleBlur);
  }

  private exitEditMode() {
    if (!this.isEditing) return;
    this.isEditing = false;

    // Commit changes before exiting
    if (this.inputDom) {
      const newLatex = this.inputDom.value;
      if (newLatex !== this.currentLatex) {
        this.commitChanges(newLatex);
      }

      // Remove input
      this.inputDom.removeEventListener("input", this.handleInput);
      this.inputDom.removeEventListener("keydown", this.handleKeydown);
      this.inputDom.removeEventListener("blur", this.handleBlur);
      this.inputDom.remove();
      this.inputDom = null;
    }

    // Remove measurement span
    if (this.measureSpan) {
      this.measureSpan.remove();
      this.measureSpan = null;
    }

    // Hide floating preview
    getMathPreviewView().hide();

    // Show preview
    this.previewDom.style.display = "";
    this.renderPreview(this.currentLatex);
  }

  private showFloatingPreview() {
    const rect = this.dom.getBoundingClientRect();
    getMathPreviewView().show(
      this.currentLatex,
      {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      },
      this.editorView?.dom
    );
  }

  private updateInputSize() {
    if (!this.inputDom || !this.measureSpan) return;
    // Measure actual text width using hidden span
    const text = this.inputDom.value || "$";
    this.measureSpan.textContent = text;
    const width = this.measureSpan.offsetWidth;
    this.inputDom.style.width = `${Math.max(8, width)}px`;
  }

  private handleInput = () => {
    if (!this.inputDom) return;
    this.updateInputSize();
    const latex = this.inputDom.value;
    getMathPreviewView().updateContent(latex);
  };

  private handleKeydown = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;

    if (e.key === "Enter") {
      e.preventDefault();
      this.commitAndExit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Revert to original value
      if (this.inputDom) {
        this.inputDom.value = this.currentLatex;
      }
      this.exitAndFocusEditor();
    } else if (e.key === "ArrowLeft" && this.inputDom?.selectionStart === 0) {
      // Allow cursor to move out left
      e.preventDefault();
      this.commitAndExit(-1);
    } else if (e.key === "ArrowRight" && this.inputDom?.selectionEnd === this.inputDom?.value.length) {
      // Allow cursor to move out right
      e.preventDefault();
      this.commitAndExit(1);
    } else if ((e.key === "Backspace" || e.key === "Delete") && this.inputDom?.value === "") {
      // Delete empty math node entirely
      e.preventDefault();
      this.deleteNode();
    }
  };

  private deleteNode() {
    if (!this.getPos || !this.editorView) return;
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state, dispatch } = this.editorView;
    const node = state.doc.nodeAt(pos);
    if (!node) return;

    // Delete the node and exit
    const tr = state.tr.delete(pos, pos + node.nodeSize);
    dispatch(tr);
    this.editorView.focus();
  }

  private handleBlur = () => {
    // Small delay to allow click events to process
    setTimeout(() => {
      if (this.isEditing && !this.inputDom?.matches(":focus")) {
        this.commitAndExit();
      }
    }, 100);
  };

  private commitChanges(newLatex: string) {
    if (!this.getPos || !this.editorView) return;
    const pos = this.getPos();
    if (pos === undefined) return;

    const { state, dispatch } = this.editorView;
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== "math_inline") return;

    // If empty and was empty, delete the node
    if (!newLatex.trim() && !this.currentLatex.trim()) {
      const tr = state.tr.delete(pos, pos + node.nodeSize);
      dispatch(tr);
      return;
    }

    // Update the node's content attribute
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      content: newLatex,
    });
    dispatch(tr);
    this.currentLatex = newLatex;
  }

  private commitAndExit(cursorOffset = 0) {
    if (!this.inputDom) return;
    const newLatex = this.inputDom.value;
    if (newLatex !== this.currentLatex) {
      this.commitChanges(newLatex);
    }
    this.exitAndFocusEditor(cursorOffset);
  }

  private exitAndFocusEditor(cursorOffset = 0) {
    if (!this.getPos || !this.editorView) return;
    const pos = this.getPos();
    if (pos === undefined) return;

    // Calculate new cursor position BEFORE exiting edit mode
    // This prevents visual jump when input is removed
    const { state, dispatch } = this.editorView;
    const node = state.doc.nodeAt(pos);
    if (!node) return;

    let newPos: number;
    if (cursorOffset < 0) {
      newPos = pos; // Before the node
      // Set flag to prevent immediate re-entry (cursor will be at node boundary)
      this.exitingLeft = true;
      requestAnimationFrame(() => {
        this.exitingLeft = false;
      });
    } else if (cursorOffset > 0) {
      newPos = pos + node.nodeSize; // After the node
      // Set flag to prevent immediate re-entry (cursor will be at node boundary)
      this.exitingRight = true;
      requestAnimationFrame(() => {
        this.exitingRight = false;
      });
    } else {
      newPos = pos + node.nodeSize; // Default: after
    }

    // Set selection first - this positions the cursor correctly
    // before we remove the input (which would reveal old cursor position)
    const tr = state.tr.setSelection(
      Selection.near(state.doc.resolve(newPos))
    );
    dispatch(tr);

    // Now exit edit mode (removes input, shows preview)
    this.exitEditMode();

    this.editorView.focus();
  }

  private renderPreview(content: string): void {
    const trimmed = content.trim();
    if (!trimmed) {
      this.previewDom.innerHTML = '<span class="math-inline-placeholder">$...$</span>';
      this.dom.classList.remove("math-error");
      return;
    }

    const currentToken = ++this.renderToken;
    this.previewDom.textContent = trimmed;
    this.dom.classList.remove("math-error");

    const renderWithKatex = () => {
      loadKatex()
        .then((katex) => {
          if (currentToken !== this.renderToken) return;
          try {
            katex.default.render(trimmed, this.previewDom, {
              throwOnError: false,
              displayMode: false,
            });
          } catch {
            this.previewDom.textContent = trimmed;
            this.dom.classList.add("math-error");
          }
        })
        .catch(() => {
          if (currentToken !== this.renderToken) return;
          this.previewDom.textContent = trimmed;
          this.dom.classList.add("math-error");
        });
    };

    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(renderWithKatex, { timeout: 100 });
    } else {
      setTimeout(renderWithKatex, 0);
    }
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "math_inline") return false;
    const newLatex = String(node.attrs.content || "");

    // Check editing state synchronously (MutationObserver is async)
    // This ensures we catch the .editing class immediately after decoration
    const hasEditing = this.dom.classList.contains("editing");
    if (hasEditing && !this.isEditing) {
      this.enterEditMode();
    } else if (!hasEditing && this.isEditing) {
      this.exitEditMode();
    }

    // Only update preview if not currently editing this node
    if (!this.isEditing) {
      this.currentLatex = newLatex;
      this.renderPreview(newLatex);
    }

    return true;
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }

  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }

  destroy(): void {
    this.observer?.disconnect();
    this.dom.removeEventListener("click", this.handleClick);
    if (this.inputDom) {
      this.inputDom.removeEventListener("input", this.handleInput);
      this.inputDom.removeEventListener("keydown", this.handleKeydown);
      this.inputDom.removeEventListener("blur", this.handleBlur);
    }
    this.measureSpan?.remove();
    getMathPreviewView().hide();
  }

  stopEvent(event: Event): boolean {
    // When editing, stop ALL events to prevent ProseMirror interference
    if (this.isEditing) {
      return true;
    }
    // Always capture mouse events on the node
    if (event.type === "mousedown" || event.type === "click") {
      return true;
    }
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

/**
 * Inline math extension for Tiptap.
 *
 * Uses an atom approach: math content is stored as an attribute,
 * and the node displays rendered KaTeX output.
 * Supports inline editing with floating preview.
 */
export const mathInlineExtension = Node.create({
  name: "math_inline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: {
        default: "",
        parseHTML: (element) => element.textContent || "",
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math_inline"]' }];
  },

  renderHTML({ node }) {
    return ["span", { "data-type": "math_inline", class: "math-inline" }, node.attrs.content];
  },

  addNodeView() {
    return ({ node, view, getPos }) => new MathInlineNodeView(node as PMNode, view, getPos);
  },
});
