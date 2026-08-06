/**
 * CodeBlockNodeView — ProseMirror NodeView for the WYSIWYG code block.
 *
 * Owns the DOM scaffolding (wrapper, gutter, pre/code, language chip, copy
 * button, run button) and delegates the dropdown lifecycle to
 * {@link LanguageDropdown}.
 *
 * Behavior the class is responsible for:
 *   - Mounting the gutter, copy button, run button, and language chip.
 *   - Showing the run button ONLY for shell-language fences (WI-4.3), and
 *     re-evaluating that on every language change.
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
import { CHECK_ICON_SVG, X_ICON_SVG } from "./icons";
import { isShellLanguage, runInTerminal } from "@/services/terminal/runInTerminal";
import { LANGUAGES } from "./languages";
import { LanguageDropdown } from "./dropdown";
import {
  applyActionLabel,
  buildCodeBlockActions,
  createGutter,
  createLanguageChip,
  renderLineNumbers,
  type CopyFeedback,
} from "./nodeViewActions";
import { codeBlockError } from "@/utils/debug";

export class CodeBlockNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private gutter: HTMLElement;
  private codeElement: HTMLElement;
  private langSelector: HTMLElement;
  private copyBtn!: HTMLButtonElement;
  private runBtn!: HTMLButtonElement;
  private actionsContainer!: HTMLElement;
  private dropdownController: LanguageDropdown;
  private node: ProseMirrorNode;
  private editor: Editor;
  private getPos: () => number | undefined;
  private renderedLineCount = -1;
  private copyFeedback!: CopyFeedback;
  private runFeedback!: CopyFeedback;
  private destroyed = false;
  private readonly handleLanguageChanged = (): void => this.refreshLabels();

  constructor(node: ProseMirrorNode, editor: Editor, getPos: () => number | undefined) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "code-block-wrapper";
    this.gutter = createGutter();
    this.dom.appendChild(this.gutter);
    this.codeElement = this.buildCodeContent(node);
    this.contentDOM = this.codeElement;
    this.langSelector = createLanguageChip({
      onMouseDown: this.handleLangClick,
      onKeyDown: this.handleLangKeydown,
    });
    this.updateLangSelectorText();
    this.buildActions();

    this.dropdownController = new LanguageDropdown({
      anchor: this.langSelector,
      getCurrentLanguage: () => this.node.attrs.language || "plaintext",
      onSelect: (langId) => this.applyLanguage(langId),
      // Assistive tech must be able to tell whether the listbox is open —
      // including when an outside click closed it.
      onOpenChange: (open) => this.langSelector.setAttribute("aria-expanded", String(open)),
    });

    // Titles/aria-labels are translated at construction; refresh them when
    // the UI language changes at runtime.
    i18n.on("languageChanged", this.handleLanguageChanged);

    this.updateLineNumbers();
  }

  /** The pre/code pair ProseMirror renders the fence content into. */
  private buildCodeContent(node: ProseMirrorNode): HTMLElement {
    const pre = document.createElement("pre");
    this.dom.appendChild(pre);
    const code = document.createElement("code");
    if (node.attrs.language) {
      code.className = `language-${node.attrs.language}`;
    }
    pre.appendChild(code);
    return code;
  }

  /** Copy + run buttons and the language chip, mounted in one container. */
  private buildActions(): void {
    const actions = buildCodeBlockActions({
      chip: this.langSelector,
      onActionMouseDown: this.handleCopyMouseDown,
      onCopyClick: this.handleCopyClick,
      onRunClick: this.handleRunClick,
    });
    this.copyBtn = actions.copyBtn;
    this.runBtn = actions.runBtn;
    this.copyFeedback = actions.copyFeedback;
    this.runFeedback = actions.runFeedback;
    this.actionsContainer = actions.container;
    this.dom.appendChild(this.actionsContainer);
    this.updateRunButton();
  }

  /** Re-translate the button labels after a runtime language switch. */
  private refreshLabels(): void {
    applyActionLabel(this.copyBtn, "editor:plugin.copySource");
    applyActionLabel(this.runBtn, "editor:plugin.runInTerminal");
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
    this.updateRunButton();
    this.updateLineNumbers();
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.copyFeedback.dispose();
    this.runFeedback.dispose();
    i18n.off("languageChanged", this.handleLanguageChanged);
    this.dropdownController.destroy();
    this.langSelector.removeEventListener("mousedown", this.handleLangClick, { capture: true });
    this.langSelector.removeEventListener("keydown", this.handleLangKeydown);
    this.copyBtn.removeEventListener("mousedown", this.handleCopyMouseDown);
    this.copyBtn.removeEventListener("click", this.handleCopyClick);
    this.runBtn.removeEventListener("mousedown", this.handleCopyMouseDown);
    this.runBtn.removeEventListener("click", this.handleRunClick);
  }

  /** Show the run button only for shell fences (WI-4.3). */
  private updateRunButton(): void {
    const isShell = isShellLanguage(this.node.attrs.language);
    // The stylesheet's `.code-copy-btn[hidden] { display: none; }` rule makes
    // `hidden` the single source of truth for visibility.
    this.runBtn.hidden = !isShell;
  }

  /**
   * Paste the block into the terminal. It is NOT executed — see the security
   * note in services/terminal/runInTerminal.
   */
  private runInFlight = false;

  private handleRunClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    // One delivery at a time: rapid re-clicks while the terminal is opening
    // would paste the command once per click.
    if (this.runInFlight) return;
    this.runInFlight = true;
    // runInTerminal resolves ordinary failures as {ok:false, reason} — show
    // the error state on the button itself (the same transient feedback the
    // copy button uses); the catch keeps an unexpected rejection from
    // becoming an unhandled one.
    // .then(() => …) (not Promise.resolve(call)) so a SYNCHRONOUS throw from
    // runInTerminal is also captured by the catch below.
    void Promise.resolve()
      .then(() => runInTerminal(this.node.textContent, this.node.attrs.language || ""))
      .then((result) => {
        if (this.destroyed || result.ok) return;
        this.runFeedback.show(X_ICON_SVG, "error");
      })
      .catch((error) => {
        codeBlockError("run in terminal failed:", error);
        if (!this.destroyed) this.runFeedback.show(X_ICON_SVG, "error");
      })
      .finally(() => {
        this.runInFlight = false;
      });
  };

  private updateLangSelectorText(): void {
    const lang = this.node.attrs.language || "plaintext";
    const langInfo = LANGUAGES.find((l) => l.id === lang);
    this.langSelector.textContent = langInfo?.name || lang;
  }

  private updateLineNumbers(): void {
    const text = this.node.textContent;
    const lineCount = text.split("\n").length;

    // Most updates (language changes, same-line typing) keep the line count —
    // skip the gutter rebuild on the editor's hot path in that case.
    if (lineCount === this.renderedLineCount) return;
    this.renderedLineCount = lineCount;
    renderLineNumbers(this.gutter, lineCount);
  }

  private handleCopyMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  private copyInFlight = false;

  private handleCopyClick = async (e: MouseEvent): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();

    if (!navigator.clipboard?.writeText) {
      this.copyFeedback.show(X_ICON_SVG, "error");
      return;
    }
    // One write at a time: concurrent writes can resolve out of order,
    // letting an older request overwrite newer feedback.
    if (this.copyInFlight) return;
    this.copyInFlight = true;
    try {
      await navigator.clipboard.writeText(this.node.textContent);
      // The clipboard write may resolve after the node view is torn down;
      // don't mutate the detached button then.
      if (this.destroyed) return;
      this.copyFeedback.show(CHECK_ICON_SVG, "success");
    } catch {
      if (this.destroyed) return;
      this.copyFeedback.show(X_ICON_SVG, "error");
    } finally {
      this.copyInFlight = false;
    }
  };

  private handleLangClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    this.dropdownController.toggle();
  };

  private handleLangKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    this.dropdownController.toggle();
  };

  private applyLanguage(langId: string): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    // Target THIS block by position — updateAttributes would target the code
    // block at the selection, which is not necessarily the one whose chip was
    // clicked (the chip's mousedown is prevented and never moves the cursor).
    this.editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, language: langId });
        return true;
      })
      .focus()
      .run();
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
