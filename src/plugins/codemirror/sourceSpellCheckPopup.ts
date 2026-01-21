/**
 * Source Spell Check Popup View
 *
 * DOM-based popup for spell check suggestions in Source mode.
 * Shows when right-clicking on a misspelled word in CodeMirror.
 */

import type { EditorView } from "@codemirror/view";
import { useSpellCheckStore } from "@/stores/spellCheckStore";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { getPopupHost, toHostCoords } from "@/plugins/sourcePopup";

/**
 * Source spell check popup view.
 */
export class SourceSpellCheckPopupView {
  private container: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private host: HTMLElement;

  constructor(view: EditorView) {
    this.editorView = view;

    // Build DOM structure
    this.container = this.buildContainer();

    // Append to editor container
    this.host = getPopupHost(view) ?? view.dom;
    this.container.style.position = "absolute";
    this.host.appendChild(this.container);

    // Subscribe to store changes
    this.unsubscribe = useSpellCheckStore.subscribe((state) => {
      if (state.isPopupOpen && state.popupPosition && state.currentWord) {
        this.show(state.popupPosition, state.currentWord.text, state.suggestions);
      } else {
        this.hide();
      }
    });

    // Handle click outside
    document.addEventListener("mousedown", this.handleClickOutside);

    // Handle escape key
    document.addEventListener("keydown", this.handleKeydown);
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "spell-check-popup";
    container.style.display = "none";
    return container;
  }

  private show(
    position: { top: number; left: number },
    word: string,
    suggestions: string[]
  ): void {
    // Clear previous content
    this.container.innerHTML = "";

    // Add suggestions
    if (suggestions.length > 0) {
      suggestions.forEach((suggestion) => {
        const item = document.createElement("div");
        item.className = "spell-check-popup-item spell-check-popup-suggestion";
        item.textContent = suggestion;
        item.addEventListener("click", () => this.handleReplace(suggestion));
        this.container.appendChild(item);
      });
    } else {
      const empty = document.createElement("div");
      empty.className = "spell-check-popup-empty";
      empty.textContent = "No suggestions";
      this.container.appendChild(empty);
    }

    // Divider
    const divider = document.createElement("div");
    divider.className = "spell-check-popup-divider";
    this.container.appendChild(divider);

    // Add to Dictionary action
    const addItem = document.createElement("div");
    addItem.className = "spell-check-popup-item spell-check-popup-action";
    addItem.textContent = "Add to Dictionary";
    addItem.addEventListener("click", () => this.handleAddToDictionary(word));
    this.container.appendChild(addItem);

    // Position and show
    const hostPos = toHostCoords(this.host, position);
    this.container.style.top = `${hostPos.top}px`;
    this.container.style.left = `${hostPos.left}px`;
    this.container.style.display = "block";

    // Adjust if off-screen
    requestAnimationFrame(() => {
      const rect = this.container.getBoundingClientRect();
      const hostRect = this.host.getBoundingClientRect();
      const hostWidth = hostRect.width;

      if (rect.right > hostRect.right - 10) {
        const adjustedLeft = hostWidth - rect.width - 10 + this.host.scrollLeft;
        this.container.style.left = `${adjustedLeft}px`;
      }
      if (rect.bottom > hostRect.bottom - 10) {
        const adjustedTop = hostPos.top - rect.height - 8;
        this.container.style.top = `${adjustedTop}px`;
      }
    });
  }

  private hide(): void {
    this.container.style.display = "none";
  }

  private handleReplace = (replacement: string): void => {
    const state = useSpellCheckStore.getState();
    if (!state.currentWord) return;

    const { from, to } = state.currentWord;

    runOrQueueCodeMirrorAction(this.editorView, () => {
      this.editorView.dispatch({
        changes: { from, to, insert: replacement },
      });
    });

    this.editorView.focus();
    useSpellCheckStore.getState().closePopup();
  };

  private handleAddToDictionary = (word: string): void => {
    useSpellCheckStore.getState().addToIgnored(word);
    useSpellCheckStore.getState().closePopup();
    this.editorView.focus();
  };

  private handleClickOutside = (event: MouseEvent): void => {
    const state = useSpellCheckStore.getState();
    if (!state.isPopupOpen) return;

    const target = event.target as Node;
    if (!this.container.contains(target)) {
      useSpellCheckStore.getState().closePopup();
    }
  };

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      const state = useSpellCheckStore.getState();
      if (state.isPopupOpen) {
        useSpellCheckStore.getState().closePopup();
        this.editorView.focus();
      }
    }
  };

  destroy(): void {
    this.unsubscribe();
    document.removeEventListener("mousedown", this.handleClickOutside);
    document.removeEventListener("keydown", this.handleKeydown);
    this.container.remove();
  }
}

/**
 * Create a ViewPlugin that manages the spell check popup.
 */
import { ViewPlugin } from "@codemirror/view";

export function createSourceSpellCheckPopupPlugin() {
  return ViewPlugin.fromClass(
    class {
      popup: SourceSpellCheckPopupView;

      constructor(view: EditorView) {
        this.popup = new SourceSpellCheckPopupView(view);
      }

      destroy() {
        this.popup.destroy();
      }
    }
  );
}
