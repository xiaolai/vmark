/**
 * CodeBlockNodeView — ProseMirror NodeView for the WYSIWYG code block.
 *
 * Owns the DOM scaffolding (wrapper, gutter, pre/code, language chip, copy
 * button) and delegates the dropdown lifecycle to {@link LanguageDropdown}.
 *
 * Behavior the class is responsible for:
 *   - Mounting the gutter, copy button, and language chip.
 *   - Recounting line numbers on every relevant mutation.
 *   - Driving the copy button: async writeText with success/error feedback.
 *   - Triggering ProseMirror language attribute updates when the dropdown
 *     emits a selection.
 *   - Telling ProseMirror to ignore mutations originating from non-content
 *     subtrees (gutter, action buttons, dropdown).
 *
 * @module plugins/codeBlockLineNumbers/nodeView
 */
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";
import i18n from "@/i18n";
import { COPY_ICON_SVG, CHECK_ICON_SVG, X_ICON_SVG } from "./icons";
import { LANGUAGES } from "./languages";
import { LanguageDropdown } from "./dropdown";

export class CodeBlockNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private gutter: HTMLElement;
  private codeElement: HTMLElement;
  private langSelector: HTMLElement;
  private copyBtn: HTMLButtonElement;
  private actionsContainer: HTMLElement;
  private dropdownController: LanguageDropdown;
  private node: ProseMirrorNode;
  private editor: Editor;
  private getPos: () => number | undefined;

  constructor(node: ProseMirrorNode, editor: Editor, getPos: () => number | undefined) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "code-block-wrapper";

    this.gutter = document.createElement("div");
    this.gutter.className = "code-line-numbers";
    this.gutter.setAttribute("aria-hidden", "true");
    this.gutter.contentEditable = "false";
    this.dom.appendChild(this.gutter);

    const pre = document.createElement("pre");
    this.dom.appendChild(pre);

    this.codeElement = document.createElement("code");
    if (node.attrs.language) {
      this.codeElement.className = `language-${node.attrs.language}`;
    }
    pre.appendChild(this.codeElement);
    this.contentDOM = this.codeElement;

    this.langSelector = document.createElement("div");
    this.langSelector.className = "code-lang-selector";
    this.langSelector.contentEditable = "false";
    this.updateLangSelectorText();
    // mousedown with capture so we get the event before ProseMirror does
    this.langSelector.addEventListener("mousedown", this.handleLangClick, { capture: true });

    this.copyBtn = document.createElement("button");
    this.copyBtn.className = "code-copy-btn";
    this.copyBtn.innerHTML = COPY_ICON_SVG;
    const copyLabel = i18n.t("editor:plugin.copySource");
    this.copyBtn.title = copyLabel;
    this.copyBtn.setAttribute("aria-label", copyLabel);
    this.copyBtn.addEventListener("mousedown", this.handleCopyMouseDown);
    this.copyBtn.addEventListener("click", this.handleCopyClick);

    this.actionsContainer = document.createElement("div");
    this.actionsContainer.className = "code-block-actions";
    this.actionsContainer.contentEditable = "false";
    this.actionsContainer.appendChild(this.copyBtn);
    this.actionsContainer.appendChild(this.langSelector);
    this.dom.appendChild(this.actionsContainer);

    this.dropdownController = new LanguageDropdown({
      anchor: this.langSelector,
      getCurrentLanguage: () => this.node.attrs.language || "plaintext",
      onSelect: (langId) => this.applyLanguage(langId),
    });

    this.updateLineNumbers();
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
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
    this.dropdownController.destroy();
    this.langSelector.removeEventListener("mousedown", this.handleLangClick, { capture: true });
    this.copyBtn.removeEventListener("mousedown", this.handleCopyMouseDown);
    this.copyBtn.removeEventListener("click", this.handleCopyClick);
  }

  private updateLangSelectorText(): void {
    const lang = this.node.attrs.language || "plaintext";
    const langInfo = LANGUAGES.find((l) => l.id === lang);
    this.langSelector.textContent = langInfo?.name || lang;
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

  private handleCopyMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  private handleCopyClick = async (e: MouseEvent): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();

    const showState = (icon: string, modifier: "success" | "error"): void => {
      this.copyBtn.innerHTML = icon;
      this.copyBtn.classList.add(`code-copy-btn--${modifier}`);
      setTimeout(() => {
        this.copyBtn.innerHTML = COPY_ICON_SVG;
        this.copyBtn.classList.remove(`code-copy-btn--${modifier}`);
      }, 1500);
    };

    if (!navigator.clipboard?.writeText) {
      showState(X_ICON_SVG, "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(this.node.textContent);
      showState(CHECK_ICON_SVG, "success");
    } catch {
      showState(X_ICON_SVG, "error");
    }
  };

  private handleLangClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    this.dropdownController.toggle();
  };

  private applyLanguage(langId: string): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.editor.chain().focus().updateAttributes("codeBlock", { language: langId }).run();
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") {
      return false;
    }
    if (this.gutter.contains(mutation.target as Node)) {
      return true;
    }
    if (this.actionsContainer.contains(mutation.target as Node)) {
      return true;
    }
    if (this.dropdownController.contains(mutation.target as Node)) {
      return true;
    }
    return false;
  }
}
