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
import {
  copyWikiLinkTarget,
  openWikiLink,
  removeWikiLink,
  saveWikiLinkChanges,
} from "./sourceWikiLinkActions";

// SVG Icons (matching project style)
const icons = {
  folder: `<svg viewBox="0 0 24 24"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
  open: `<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  copy: `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  delete: `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
};

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
    this.targetInput.addEventListener("keydown", this.handleInputKeydown);
    this.targetInput.addEventListener("input", this.handleTargetInput);

    // Icon buttons: browse, open, copy, delete
    const browseBtn = this.buildIconButton(icons.folder, "Browse for file", this.handleBrowse);
    this.openBtn = this.buildIconButton(icons.open, "Open linked file", this.handleOpen);
    this.openBtn.classList.add("source-wiki-link-popup-btn-open");
    const copyBtn = this.buildIconButton(icons.copy, "Copy target", this.handleCopy);
    const deleteBtn = this.buildIconButton(icons.delete, "Remove wiki link", this.handleRemove);
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

  private handleInputKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSave();
    }
    // Escape is handled by base class
  };

  private handleTargetInput = (): void => {
    const target = this.targetInput.value;
    useWikiLinkPopupStore.getState().updateTarget(target);
    this.updateOpenButtonState(target);
  };

  private handleSave = (): void => {
    const { target } = useWikiLinkPopupStore.getState();

    if (!target.trim()) {
      // Empty target - remove the wiki link
      this.handleRemove();
      return;
    }

    saveWikiLinkChanges(this.editorView);
    this.closePopup();
    this.focusEditor();
  };

  private handleBrowse = async (): Promise<void> => {
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
  };

  private handleOpen = (): void => {
    openWikiLink();
  };

  private handleCopy = (): void => {
    copyWikiLinkTarget();
  };

  private handleRemove = (): void => {
    removeWikiLink(this.editorView);
    this.closePopup();
    this.focusEditor();
  };
}
