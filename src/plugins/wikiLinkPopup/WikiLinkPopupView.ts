/**
 * Wiki Link Popup View
 *
 * DOM management for editing a wiki link's target path (the display alias is
 * edited inline in the editor). Extends WysiwygPopupView for lifecycle.
 */

import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import i18n from "@/i18n";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { wikiLinkPopupWarn, wikiLinkPopupError } from "@/utils/debug";
import { IMAGE_EXTENSIONS } from "@/utils/mediaExtensions";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { buildPopupIconButton, buildPopupInput } from "@/utils/popupComponents";
import { WysiwygPopupView, type EditorViewLike, type PopupStoreBase } from "@/plugins/shared";
import { pathToWikiTarget, resolveWikiLinkPath } from "./wikiLinkPaths";

const DEFAULT_POPUP_WIDTH = 320;
const DEFAULT_POPUP_HEIGHT = 32;

/** Wiki link popup store state (extends base with wiki-link-specific fields) */
interface WikiLinkPopupState extends PopupStoreBase {
  target: string;
  nodePos: number | null;
  updateTarget: (target: string) => void;
}

export class WikiLinkPopupView extends WysiwygPopupView<WikiLinkPopupState> {
  constructor(view: EditorViewLike) {
    super(view, useWikiLinkPopupStore);
    // Handle mouse leaving the popup (arrow fields are initialized after super())
    this.container.addEventListener("mouseleave", this.handleMouseLeave);
  }

  // Lazy getters for DOM elements (avoids constructor timing issues)
  private get targetInput(): HTMLInputElement {
    return this.container.querySelector(".wiki-link-popup-target") as HTMLInputElement;
  }

  private get openBtn(): HTMLButtonElement {
    return this.container.querySelector(".wiki-link-popup-btn-open") as HTMLButtonElement;
  }

  protected buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "wiki-link-popup";

    // Single row: Input + Browse + Action buttons
    const targetInput = buildPopupInput({
      placeholder: i18n.t("editor:popup.wikiLink.target.placeholder"),
      className: "wiki-link-popup-target",
      onInput: (value) => this.handleTargetChange(value),
      onKeydown: (e) => this.handleInputKeydown(e),
    });

    const browseBtn = buildPopupIconButton({
      icon: "folder",
      title: i18n.t("editor:popup.wikiLink.browse"),
      onClick: () => void this.handleBrowse(),
    });

    const openBtn = buildPopupIconButton({
      icon: "open",
      title: i18n.t("editor:popup.wikiLink.open"),
      onClick: () => void this.handleOpen(),
    });
    openBtn.classList.add("wiki-link-popup-btn-open");

    const copyBtn = buildPopupIconButton({
      icon: "copy",
      title: i18n.t("editor:popup.wikiLink.copy"),
      onClick: () => void this.handleCopy(),
    });

    const saveBtn = buildPopupIconButton({
      icon: "save",
      title: i18n.t("editor:popup.wikiLink.save"),
      onClick: () => this.handleSave(),
      variant: "primary",
    });

    const deleteBtn = buildPopupIconButton({
      icon: "delete",
      title: i18n.t("editor:popup.wikiLink.remove"),
      onClick: () => this.handleDelete(),
      variant: "danger",
    });

    container.appendChild(targetInput);
    container.appendChild(browseBtn);
    container.appendChild(openBtn);
    container.appendChild(copyBtn);
    container.appendChild(saveBtn);
    container.appendChild(deleteBtn);

    return container;
  }

  protected getPopupDimensions() {
    const rect = this.container.getBoundingClientRect();
    return {
      width: rect.width || DEFAULT_POPUP_WIDTH,
      height: rect.height || DEFAULT_POPUP_HEIGHT,
      gap: 6,
      preferAbove: true,
    };
  }

  protected onShow(state: WikiLinkPopupState): void {
    this.targetInput.value = state.target;
    this.updateOpenButtonState(state.target);

    requestAnimationFrame(() => {
      this.targetInput.focus();
      this.targetInput.select();
    });
  }

  protected onHide(): void {
    // No special cleanup needed
  }

  private updateOpenButtonState(target: string): void {
    const hasTarget = target.trim().length > 0;
    this.openBtn.disabled = !hasTarget;
    this.openBtn.style.opacity = hasTarget ? "1" : "0.4";
  }

  private handleTargetChange(value: string): void {
    this.store.getState().updateTarget(value);
    this.updateOpenButtonState(value);
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.handleCancel();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleSave();
    }
  }

  private async handleBrowse(): Promise<void> {
    try {
      const selected = await open({
        filters: [
          { name: "Markdown", extensions: ["md", "markdown"] },
          { name: "Images", extensions: [...IMAGE_EXTENSIONS] },
          { name: "Documents", extensions: ["pdf", "txt", "html"] },
          { name: "All Files", extensions: ["*"] },
        ],
        multiple: false,
      });

      if (!selected || Array.isArray(selected)) return;

      const { rootPath } = useWorkspaceStore.getState();
      const target = pathToWikiTarget(selected, rootPath);

      this.targetInput.value = target;
      this.store.getState().updateTarget(target);
      this.updateOpenButtonState(target);

      this.targetInput.focus();
    } catch (error) {
      wikiLinkPopupError("Browse failed:", error);
    }
  }

  private async handleOpen(): Promise<void> {
    const target = this.targetInput.value.trim();
    if (!target) return;

    const { rootPath } = useWorkspaceStore.getState();
    const filePath = resolveWikiLinkPath(target, rootPath);

    if (!filePath) {
      wikiLinkPopupWarn("Cannot resolve wiki link target:", target);
      return;
    }

    try {
      const currentWindow = getCurrentWebviewWindow();
      await currentWindow.emit("open-file", { path: filePath });
      this.closePopup();
    } catch (error) {
      wikiLinkPopupError("Failed to open file:", error);
    }
  }

  private async handleCopy(): Promise<void> {
    const target = this.targetInput.value.trim();
    if (target) {
      try {
        await navigator.clipboard.writeText(target);
        // Keep popup open for further actions - don't close
      } catch (err) {
        wikiLinkPopupError("Failed to copy:", err);
      }
    }
  }

  private handleSave(): void {
    const state = this.store.getState();
    const { nodePos } = state;
    const target = this.targetInput.value.trim();

    if (!target || nodePos === null) {
      state.closePopup();
      return;
    }

    const { state: editorState, dispatch } = this.editorView;
    const node = editorState.doc.nodeAt(nodePos);
    if (!node || node.type.name !== "wikiLink") {
      state.closePopup();
      return;
    }

    const attrs = {
      ...node.attrs,
      value: target,
    };
    const tr = editorState.tr.setNodeMarkup(nodePos, undefined, attrs);
    dispatch(tr);

    state.closePopup();
    this.focusEditor();
  }

  private handleDelete(): void {
    const state = this.store.getState();
    const { nodePos } = state;

    if (nodePos === null) {
      state.closePopup();
      return;
    }

    const { state: editorState, dispatch } = this.editorView;
    const node = editorState.doc.nodeAt(nodePos);
    if (!node || node.type.name !== "wikiLink") {
      state.closePopup();
      return;
    }

    // Preserve display text: use node's text content (alias) or fall back to target
    const displayText = node.textContent || String(node.attrs.value ?? "");
    const schema = editorState.schema;
    const tr = editorState.tr;

    // Replace wikiLink node with plain text
    if (displayText) {
      const textNode = schema.text(displayText);
      tr.replaceWith(nodePos, nodePos + node.nodeSize, textNode);
    } else {
      // Empty display - just delete
      tr.delete(nodePos, nodePos + node.nodeSize);
    }
    dispatch(tr);

    state.closePopup();
    this.focusEditor();
  }

  private handleCancel(): void {
    this.closePopup();
    this.focusEditor();
  }

  private handleMouseLeave = (e: MouseEvent): void => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;

    // If moving back to a wiki link in the editor, don't close
    if (relatedTarget?.closest("span.wiki-link")) {
      return;
    }

    // If input is focused (user is editing), don't close on mouse leave
    if (document.activeElement === this.targetInput) {
      return;
    }

    // Close the popup
    this.closePopup();
  };

  destroy(): void {
    this.container.removeEventListener("mouseleave", this.handleMouseLeave);
    super.destroy();
  }
}
