/**
 * Spell Check Popup View
 *
 * DOM-based popup for spell check suggestions.
 * Shows when right-clicking on a misspelled word.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import { useSpellCheckStore } from "@/stores/spellCheckStore";

/**
 * Spell check popup view - manages the floating suggestions UI.
 */
export class SpellCheckPopupView {
  private container: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorView;

  constructor(view: EditorView) {
    this.editorView = view;

    // Build DOM structure
    this.container = this.buildContainer();

    // Append to document body
    document.body.appendChild(this.container);

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
    this.container.style.top = `${position.top}px`;
    this.container.style.left = `${position.left}px`;
    this.container.style.display = "block";

    // Adjust if off-screen
    requestAnimationFrame(() => {
      const rect = this.container.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (rect.right > viewportWidth - 10) {
        this.container.style.left = `${viewportWidth - rect.width - 10}px`;
      }
      if (rect.bottom > viewportHeight - 10) {
        this.container.style.top = `${position.top - rect.height - 8}px`;
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
    const tr = this.editorView.state.tr.replaceWith(
      from,
      to,
      this.editorView.state.schema.text(replacement)
    );
    this.editorView.dispatch(tr);
    this.editorView.focus();

    useSpellCheckStore.getState().closePopup();
  };

  private handleAddToDictionary = (word: string): void => {
    useSpellCheckStore.getState().addToIgnored(word);
    useSpellCheckStore.getState().closePopup();
    this.editorView.focus();

    // Trigger re-check by dispatching empty transaction
    this.editorView.dispatch(this.editorView.state.tr);
  };

  private handleClickOutside = (event: MouseEvent): void => {
    const state = useSpellCheckStore.getState();
    if (!state.isPopupOpen) return;

    const target = event.target as Node;
    if (!this.container.contains(target)) {
      useSpellCheckStore.getState().closePopup();
    }
  };

  destroy(): void {
    this.unsubscribe();
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.container.remove();
  }
}
