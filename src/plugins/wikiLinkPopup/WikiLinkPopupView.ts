/**
 * Wiki Link Popup View
 *
 * DOM management for editing wiki link target.
 * The display text (alias) is edited inline in the editor.
 * This popup handles the target path and provides actions.
 */

import type { EditorView } from "@tiptap/pm/view";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { isImeKeyEvent } from "@/utils/imeGuard";
import {
  buildPopupIconButton,
  buildPopupInput,
  handlePopupTabNavigation,
} from "@/utils/popupComponents";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

const DEFAULT_POPUP_WIDTH = 320;
const DEFAULT_POPUP_HEIGHT = 32;

/**
 * Resolve a wiki link target to a full file path.
 */
function resolveWikiLinkPath(target: string, workspaceRoot: string | null): string | null {
  if (!target || !workspaceRoot) return null;

  // If target already looks like a path, use it directly
  if (target.includes("/") || target.endsWith(".md")) {
    const normalized = target.endsWith(".md") ? target : `${target}.md`;
    return `${workspaceRoot}/${normalized}`;
  }

  // Simple target name - assume it's in workspace root with .md extension
  return `${workspaceRoot}/${target}.md`;
}

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

export class WikiLinkPopupView {
  private container: HTMLElement;
  private targetInput: HTMLInputElement;
  private openBtn: HTMLButtonElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private justOpened = false;
  private wasOpen = false;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private host: HTMLElement | null = null;

  constructor(view: EditorView) {
    this.editorView = view;

    this.container = this.buildContainer();
    this.targetInput = this.container.querySelector(
      ".wiki-link-popup-target"
    ) as HTMLInputElement;
    this.openBtn = this.container.querySelector(
      ".wiki-link-popup-btn-open"
    ) as HTMLButtonElement;
    // Container will be appended to host in show()

    this.unsubscribe = useWikiLinkPopupStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        if (!this.wasOpen) {
          this.show(state.target, state.anchorRect);
        }
        this.wasOpen = true;
      } else {
        this.hide();
        this.wasOpen = false;
      }
    });

    document.addEventListener("mousedown", this.handleClickOutside);

    // Handle mouse leaving the popup
    this.container.addEventListener("mouseleave", this.handleMouseLeave);

    // Close popup on scroll (popup position becomes stale)
    this.editorView.dom.closest(".editor-container")?.addEventListener("scroll", this.handleScroll, true);
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "wiki-link-popup";
    container.style.display = "none";

    // Single row: Input + Browse + Action buttons
    const targetInput = buildPopupInput({
      placeholder: "Target page",
      className: "wiki-link-popup-target",
      onInput: this.handleTargetChange,
      onKeydown: this.handleInputKeydown,
    });

    const browseBtn = buildPopupIconButton({
      icon: "folder",
      title: "Browse for file",
      onClick: this.handleBrowse,
    });

    const openBtn = buildPopupIconButton({
      icon: "open",
      title: "Open linked file",
      onClick: this.handleOpen,
    });
    openBtn.classList.add("wiki-link-popup-btn-open");

    const copyBtn = buildPopupIconButton({
      icon: "copy",
      title: "Copy target",
      onClick: this.handleCopy,
    });

    const saveBtn = buildPopupIconButton({
      icon: "save",
      title: "Save",
      onClick: this.handleSave,
      variant: "primary",
    });

    const deleteBtn = buildPopupIconButton({
      icon: "delete",
      title: "Remove wiki link",
      onClick: this.handleDelete,
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

  private setupKeyboardNavigation() {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      handlePopupTabNavigation(e, this.container);
    };
    document.addEventListener("keydown", this.keydownHandler);
  }

  private removeKeyboardNavigation() {
    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  private show(target: string, anchorRect: AnchorRect) {
    this.targetInput.value = target;

    // Mount to editor container if available, otherwise document.body
    this.host = getPopupHostForDom(this.editorView.dom) ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = this.host === document.body ? "fixed" : "absolute";
      this.host.appendChild(this.container);
    }

    this.container.style.display = "flex";

    this.updateOpenButtonState(target);

    this.justOpened = true;
    requestAnimationFrame(() => {
      this.justOpened = false;
    });

    const containerEl = this.editorView.dom.closest(
      ".editor-container"
    ) as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.editorView.dom as HTMLElement, containerEl)
      : getViewportBounds();

    const popupRect = this.container.getBoundingClientRect();
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: {
        width: popupRect.width || DEFAULT_POPUP_WIDTH,
        height: popupRect.height || DEFAULT_POPUP_HEIGHT,
      },
      bounds,
      gap: 6,
      preferAbove: true,
    });

    // Convert to host-relative coordinates if mounted inside editor container
    if (this.host !== document.body) {
      const hostPos = toHostCoordsForDom(this.host, { top, left });
      this.container.style.top = `${hostPos.top}px`;
      this.container.style.left = `${hostPos.left}px`;
    } else {
      this.container.style.top = `${top}px`;
      this.container.style.left = `${left}px`;
    }

    this.setupKeyboardNavigation();

    requestAnimationFrame(() => {
      this.targetInput.focus();
      this.targetInput.select();
    });
  }

  private hide() {
    this.container.style.display = "none";
    this.host = null;
    this.removeKeyboardNavigation();
  }

  private updateOpenButtonState(target: string) {
    const hasTarget = target.trim().length > 0;
    this.openBtn.disabled = !hasTarget;
    this.openBtn.style.opacity = hasTarget ? "1" : "0.4";
  }

  private handleTargetChange = (value: string) => {
    useWikiLinkPopupStore.getState().updateTarget(value);
    this.updateOpenButtonState(value);
  };

  private handleInputKeydown = (e: KeyboardEvent) => {
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
  };

  private handleBrowse = async () => {
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
      console.error("[WikiLinkPopup] Browse failed:", error);
    }
  };

  private handleOpen = async () => {
    const target = this.targetInput.value.trim();
    if (!target) return;

    const { rootPath } = useWorkspaceStore.getState();
    const filePath = resolveWikiLinkPath(target, rootPath);

    if (!filePath) {
      console.warn("[WikiLinkPopup] Cannot resolve wiki link target:", target);
      return;
    }

    try {
      const currentWindow = getCurrentWebviewWindow();
      await currentWindow.emit("open-file", { path: filePath });
      useWikiLinkPopupStore.getState().closePopup();
    } catch (error) {
      console.error("[WikiLinkPopup] Failed to open file:", error);
    }
  };

  private handleCopy = async () => {
    const target = this.targetInput.value.trim();
    if (target) {
      try {
        await navigator.clipboard.writeText(target);
        // Keep popup open for further actions - don't close
      } catch (err) {
        console.error("[WikiLinkPopup] Failed to copy:", err);
      }
    }
  };

  private handleSave = () => {
    const state = useWikiLinkPopupStore.getState();
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
    this.editorView.focus();
  };

  private handleDelete = () => {
    const state = useWikiLinkPopupStore.getState();
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
    this.editorView.focus();
  };

  private handleCancel = () => {
    useWikiLinkPopupStore.getState().closePopup();
    this.editorView.focus();
  };

  private handleClickOutside = (e: MouseEvent) => {
    if (this.justOpened) return;
    const { isOpen } = useWikiLinkPopupStore.getState();
    if (!isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      useWikiLinkPopupStore.getState().closePopup();
    }
  };

  private handleMouseLeave = (e: MouseEvent) => {
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
    useWikiLinkPopupStore.getState().closePopup();
  };

  private handleScroll = () => {
    // Close popup on scroll - position becomes stale
    const { isOpen } = useWikiLinkPopupStore.getState();
    if (isOpen) {
      useWikiLinkPopupStore.getState().closePopup();
    }
  };

  destroy() {
    this.unsubscribe();
    this.removeKeyboardNavigation();
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.container.removeEventListener("mouseleave", this.handleMouseLeave);
    this.editorView.dom.closest(".editor-container")?.removeEventListener("scroll", this.handleScroll, true);
    this.container.remove();
  }
}
