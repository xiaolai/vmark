/**
 * Frontmatter Panel NodeView
 *
 * Purpose: Collapsible YAML editing panel for frontmatter in WYSIWYG mode.
 * Replaces the invisible atom node with a clickable panel that expands
 * to show a textarea for editing.
 *
 * Key decisions:
 *   - Collapsed by default — shows "Frontmatter" label, click to expand
 *   - Cmd+Enter commits and collapses, Escape reverts and collapses
 *   - Blur commits after 300ms debounce
 *   - Changes create undoable ProseMirror transactions
 *
 * @coordinates-with markdownArtifacts/frontmatter.ts — registers this NodeView
 * @module plugins/frontmatterPanel/nodeView
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import { isImeKeyEvent } from "@/utils/imeGuard";
import i18n from "@/i18n";
import "./frontmatter-panel.css";

function createChevronSvg(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "frontmatter-panel-chevron");
  svg.setAttribute("viewBox", "0 0 16 16");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M6 3.5l4.5 4.5-4.5 4.5");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("fill", "none");
  svg.appendChild(path);
  return svg;
}

class FrontmatterNodeView implements NodeView {
  dom: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private expanded = false;
  private committedValue: string;
  private view: EditorView;
  private getPos: () => number | undefined;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.view = view;
    this.getPos = getPos;
    this.committedValue = (node.attrs.value as string) ?? "";

    this.dom = document.createElement("div");
    this.dom.className = "frontmatter-panel";
    this.dom.contentEditable = "false";

    // Header — keyboard-accessible toggle
    const header = document.createElement("div");
    header.className = "frontmatter-panel-header";
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.appendChild(createChevronSvg());
    const label = document.createElement("span");
    label.textContent = i18n.t("editor:frontmatter.label");
    header.appendChild(label);
    header.addEventListener("click", this.toggleExpanded);
    header.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.toggleExpanded();
      }
    });
    this.dom.appendChild(header);

    // Editor area
    const editorArea = document.createElement("div");
    editorArea.className = "frontmatter-panel-editor";

    this.textarea = document.createElement("textarea");
    this.textarea.className = "frontmatter-panel-textarea";
    this.textarea.value = this.committedValue;
    this.textarea.addEventListener("keydown", this.handleKeydown);
    this.textarea.addEventListener("blur", this.handleBlur);
    editorArea.appendChild(this.textarea);

    this.dom.appendChild(editorArea);
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "frontmatter") return false;
    const newValue = (node.attrs.value as string) ?? "";
    if (newValue !== this.committedValue) {
      this.committedValue = newValue;
      if (this.textarea.value !== newValue) {
        this.textarea.value = newValue;
      }
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    if (this.expanded && this.textarea.contains(event.target as Node)) {
      return true;
    }
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    if (this.blurTimer) clearTimeout(this.blurTimer);
  }

  private toggleExpanded = () => {
    this.expanded = !this.expanded;
    this.dom.classList.toggle("expanded", this.expanded);
    if (this.expanded) {
      requestAnimationFrame(() => {
        this.textarea.focus();
      });
    }
  };

  private handleKeydown = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.commit();
      this.collapse();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      this.revert();
      this.collapse();
    }
  };

  private handleBlur = () => {
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.blurTimer = setTimeout(() => {
      if (this.textarea.value !== this.committedValue) {
        this.commit();
      }
    }, 300);
  };

  private commit() {
    const newValue = this.textarea.value;
    if (newValue === this.committedValue) return;

    const pos = this.getPos();
    if (pos === undefined) return;

    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "frontmatter") return;

    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      value: newValue,
    });
    this.view.dispatch(tr);
    this.committedValue = newValue;
  }

  private revert() {
    this.textarea.value = this.committedValue;
  }

  private collapse() {
    this.expanded = false;
    this.dom.classList.remove("expanded");
    this.view.focus();
  }
}

export function createFrontmatterNodeView(
  node: PMNode,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  return new FrontmatterNodeView(node, view, getPos);
}
