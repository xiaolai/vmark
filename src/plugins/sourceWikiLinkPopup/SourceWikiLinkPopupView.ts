/**
 * Source Wiki Link Popup View
 *
 * Popup view for editing wiki links in Source mode (CodeMirror 6).
 * Allows editing target, opening, copying, and removing wiki links.
 */

import type { EditorView } from "@codemirror/view";
import { open } from "@tauri-apps/plugin-dialog";
import { SourcePopupView, type StoreApi } from "@/plugins/sourcePopup";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { popupIcons } from "@/utils/popupComponents";
import {
  copyWikiLinkTarget,
  openWikiLink,
  removeWikiLink,
  saveWikiLinkChanges,
} from "./sourceWikiLinkActions";

/**
 * Convert an absolute file path to a wiki link target (workspace-relative, without .md).
 */
function pathToWikiTarget(filePath: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return filePath;

  // Remove workspace root prefix
  let relative = filePath;
  if (filePath.startsWith(workspaceRoot)) {
    relative = filePath.slice(workspaceRoot.length);
    if (relative.startsWith("/")) {
      relative = relative.slice(1);
    }
  }

  // Remove .md extension
  if (relative.endsWith(".md")) {
    relative = relative.slice(0, -3);
  }

  return relative;
}

/**
 * Source wiki link popup view.
 * Extends the base SourcePopupView for common functionality.
 */
type WikiLinkPopupStoreState = ReturnType<typeof useWikiLinkPopupStore.getState>;

export class SourceWikiLinkPopupView extends SourcePopupView<WikiLinkPopupStoreState> {
  // Use 'declare' to avoid ES2022 class field initialization overwriting values set in buildContainer()
  private declare targetInput: HTMLInputElement;
  private declare openBtn: HTMLElement;

  constructor(view: EditorView, store: StoreApi<WikiLinkPopupStoreState>) {
    super(view, store);
  }

  protected buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "source-wiki-link-popup";

    // Row 1: Target input + buttons
    const targetRow = document.createElement("div");
    targetRow.className = "source-wiki-link-popup-row";

    this.targetInput = document.createElement("input");
    this.targetInput.type = "text";
    this.targetInput.className = "source-wiki-link-popup-target";
    this.targetInput.placeholder = "Target page...";
    this.targetInput.addEventListener("keydown", this.handleInputKeydown.bind(this));
    this.targetInput.addEventListener("input", this.handleTargetInput.bind(this));

    // Icon buttons: browse, open, copy, delete
    const browseBtn = this.buildIconButton(popupIcons.folder, "Browse for file", this.handleBrowse.bind(this));
    this.openBtn = this.buildIconButton(popupIcons.open, "Open linked file", this.handleOpen.bind(this));
    this.openBtn.classList.add("source-wiki-link-popup-btn-open");
    const copyBtn = this.buildIconButton(popupIcons.copy, "Copy target", this.handleCopy.bind(this));
    const deleteBtn = this.buildIconButton(popupIcons.delete, "Remove wiki link", this.handleRemove.bind(this));
    deleteBtn.classList.add("source-wiki-link-popup-btn-delete");

    targetRow.appendChild(this.targetInput);
    targetRow.appendChild(browseBtn);
    targetRow.appendChild(this.openBtn);
    targetRow.appendChild(copyBtn);
    targetRow.appendChild(deleteBtn);

    container.appendChild(targetRow);

    return container;
  }

  protected getPopupDimensions() {
    return {
      width: 340,
      height: 40,
      gap: 6,
      preferAbove: true,
    };
  }

  protected onShow(state: WikiLinkPopupStoreState): void {
    // Set input values from store
    this.targetInput.value = state.target;

    // Update open button state
    this.updateOpenButtonState(state.target);

    // Focus target input after a brief delay
    requestAnimationFrame(() => {
      this.targetInput.focus();
      this.targetInput.select();
    });
  }

  protected onHide(): void {
    // Clear inputs
    this.targetInput.value = "";
  }

  private buildIconButton(iconSvg: string, title: string, onClick: () => void): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "source-wiki-link-popup-btn";
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = iconSvg;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private updateOpenButtonState(target: string): void {
    const hasTarget = target.trim().length > 0;
    (this.openBtn as HTMLButtonElement).disabled = !hasTarget;
    this.openBtn.style.opacity = hasTarget ? "1" : "0.4";
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSave();
    }
    // Escape is handled by base class
  }

  private handleTargetInput(): void {
    const target = this.targetInput.value;
    useWikiLinkPopupStore.getState().updateTarget(target);
    this.updateOpenButtonState(target);
  }

  private handleSave(): void {
    const { target } = useWikiLinkPopupStore.getState();

    if (!target.trim()) {
      // Empty target - remove the wiki link
      this.handleRemove();
      return;
    }

    saveWikiLinkChanges(this.editorView);
    this.closePopup();
    this.focusEditor();
  }

  private async handleBrowse(): Promise<void> {
    try {
      const selected = await open({
        filters: [
          { name: "Markdown", extensions: ["md", "markdown"] },
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"] },
          { name: "Documents", extensions: ["pdf", "txt", "html"] },
          { name: "All Files", extensions: ["*"] },
        ],
        multiple: false,
      });

      if (!selected || Array.isArray(selected)) return;

      const { rootPath } = useWorkspaceStore.getState();
      const target = pathToWikiTarget(selected, rootPath);

      this.targetInput.value = target;
      useWikiLinkPopupStore.getState().updateTarget(target);
      this.updateOpenButtonState(target);

      this.targetInput.focus();
    } catch (error) {
      console.error("[SourceWikiLinkPopup] Browse failed:", error);
    }
  }

  private handleOpen(): void {
    openWikiLink();
  }

  private handleCopy(): void {
    copyWikiLinkTarget();
  }

  private handleRemove(): void {
    removeWikiLink(this.editorView);
    this.closePopup();
    this.focusEditor();
  }
}
