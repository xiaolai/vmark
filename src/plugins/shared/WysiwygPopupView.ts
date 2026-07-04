/**
 * WYSIWYG Popup View Base Class
 *
 * Abstract base class for popup views in WYSIWYG mode (TipTap/ProseMirror).
 * Provides common functionality: DOM lifecycle, store subscription,
 * keyboard navigation, click-outside handling, and positioning.
 *
 * Mirrors SourcePopupView for consistency across editor modes.
 */

import type { AnchorRect } from "@/utils/popupPosition";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
} from "@/utils/popupPosition";
import { handlePopupTabNavigation } from "@/utils/popupComponents";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";
import { isImeKeyEvent } from "@/utils/imeGuard";
import type {
  EditorViewLike,
  PopupStoreBase,
  StoreApi,
  PopupPositionConfig,
} from "./types";

// Re-export types for convenience
export type { EditorViewLike, PopupStoreBase, StoreApi, PopupPositionConfig };

/**
 * Abstract base class for WYSIWYG mode popup views.
 *
 * Subclasses must implement:
 * - buildContainer(): Create the popup DOM structure
 * - onShow(): Called when popup becomes visible
 * - onHide(): Called when popup is hidden
 *
 * @template TState - The store state type
 */
export abstract class WysiwygPopupView<TState extends PopupStoreBase> {
  protected container: HTMLElement;
  protected editorView: EditorViewLike;
  protected store: StoreApi<TState>;
  protected unsubscribe: () => void;

  private wasOpen = false;
  private justOpened = false;
  private host: HTMLElement | null = null;
  private lastState: TState | null = null;

  private boundHandleClickOutside: (e: MouseEvent) => void;
  private boundHandleKeydown: (e: KeyboardEvent) => void;
  private boundHandleScroll: () => void;

  constructor(view: EditorViewLike, store: StoreApi<TState>) {
    this.editorView = view;
    this.store = store;

    this.container = this.buildContainer();
    this.container.style.display = "none";

    this.boundHandleClickOutside = this.handleClickOutside.bind(this);
    this.boundHandleKeydown = this.handleKeydown.bind(this);
    this.boundHandleScroll = this.handleScroll.bind(this);

    this.unsubscribe = store.subscribe((state) => {
      this.handleStoreState(state);
    });
  }

  private handleStoreState(state: TState): void {
    const { isOpen, anchorRect } = this.extractState(state);

    if (isOpen && anchorRect) {
      const reshow =
        this.wasOpen && this.lastState !== null && this.shouldReshow(this.lastState, state);
      if (!this.wasOpen || reshow) {
        this.show(anchorRect, state);
      }
      this.wasOpen = true;
    } else {
      if (this.wasOpen) {
        this.hide();
      }
      this.wasOpen = false;
    }
    this.lastState = state;
  }

  /**
   * Re-evaluate the current store state. Subclasses whose popup may already
   * be open at construction time (e.g. hover popups recreated with the
   * editor view) call this at the end of their constructor.
   */
  protected syncFromStore(): void {
    this.handleStoreState(this.store.getState());
  }

  /**
   * Whether an already-open popup should run show() again for this state
   * change (e.g. the popup was retargeted to a different node while open).
   * Default: never re-show while open.
   */
  protected shouldReshow(_prev: TState, _state: TState): boolean {
    return false;
  }

  /** Build the popup DOM container. */
  protected abstract buildContainer(): HTMLElement;

  /** Called when popup becomes visible. */
  protected abstract onShow(state: TState): void;

  /** Called when popup is hidden. */
  protected abstract onHide(): void;

  /** Extract isOpen and anchorRect from store state. */
  protected extractState(state: TState): { isOpen: boolean; anchorRect: AnchorRect | null } {
    return { isOpen: state.isOpen, anchorRect: state.anchorRect };
  }

  /** Get popup dimensions for positioning. */
  protected getPopupDimensions(): PopupPositionConfig {
    return { width: 320, height: 40, gap: 6, preferAbove: true };
  }

  /** Get first focusable element for initial focus. */
  protected getFirstFocusable(): HTMLElement | null {
    return this.container.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
  }

  private show(anchorRect: AnchorRect, state: TState): void {
    this.host = getPopupHostForDom(this.editorView.dom) ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = this.host === document.body ? "fixed" : "absolute";
      this.host.appendChild(this.container);
    }

    this.container.style.display = "flex";

    this.justOpened = true;
    requestAnimationFrame(() => {
      this.justOpened = false;
    });

    // Let the subclass populate content BEFORE positioning, so popups that
    // measure their own rect (getBoundingClientRect) see the final layout.
    this.onShow(state);

    this.updatePosition(anchorRect);

    document.addEventListener("mousedown", this.boundHandleClickOutside);
    document.addEventListener("keydown", this.boundHandleKeydown);
    this.editorView.dom.closest(".editor-container")?.addEventListener(
      "scroll",
      this.boundHandleScroll,
      true
    );
    this.container.addEventListener("keydown", this.handleTabNavigation);

    requestAnimationFrame(() => {
      const firstFocusable = this.getFirstFocusable();
      if (firstFocusable) {
        firstFocusable.focus();
      }
    });
  }

  private hide(): void {
    this.container.style.display = "none";

    document.removeEventListener("mousedown", this.boundHandleClickOutside);
    document.removeEventListener("keydown", this.boundHandleKeydown);
    this.editorView.dom.closest(".editor-container")?.removeEventListener(
      "scroll",
      this.boundHandleScroll,
      true
    );
    this.container.removeEventListener("keydown", this.handleTabNavigation);

    this.host = null;
    this.onHide();
  }

  private handleTabNavigation = (e: KeyboardEvent): void => {
    if (isImeKeyEvent(e)) return;
    handlePopupTabNavigation(e, this.container);
  };

  private handleClickOutside(e: MouseEvent): void {
    if (this.justOpened) return;
    const state = this.store.getState();
    /* v8 ignore next -- @preserve defensive guard; listener is removed on hide so isOpen is always true here */
    if (!state.isOpen) return;
    if (!this.container.contains(e.target as Node)) {
      this.closePopup();
    }
  }

  private handleScroll(): void {
    /* v8 ignore next -- @preserve defensive guard; listener is removed on hide so store is always open here */
    if (this.store.getState().isOpen) {
      this.closePopup();
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.closePopup();
      this.editorView.focus();
    }
  }

  protected closePopup(): void {
    const state = this.store.getState();
    if (typeof state.closePopup === "function") {
      state.closePopup();
    }
  }

  protected focusEditor(): void {
    this.editorView.focus();
  }

  protected updatePosition(anchorRect: AnchorRect): void {
    const dimensions = this.getPopupDimensions();
    // Horizontal bounds come from the editor content, vertical bounds from
    // the surrounding .editor-container (matches every popup's historical
    // behavior); fall back to the viewport when there is no container.
    const containerEl = this.editorView.dom.closest(".editor-container") as HTMLElement | null;
    const bounds = this.host === document.body || !containerEl
      ? getViewportBounds()
      : getBoundaryRects(this.editorView.dom, containerEl);

    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: dimensions.width, height: dimensions.height },
      bounds,
      gap: dimensions.gap ?? 6,
      preferAbove: dimensions.preferAbove ?? true,
    });

    if (this.host !== document.body && this.host) {
      const hostPos = toHostCoordsForDom(this.host, { top, left });
      this.container.style.top = `${hostPos.top}px`;
      this.container.style.left = `${hostPos.left}px`;
    } else {
      this.container.style.top = `${top}px`;
      this.container.style.left = `${left}px`;
    }
  }

  protected isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  destroy(): void {
    this.unsubscribe();
    document.removeEventListener("mousedown", this.boundHandleClickOutside);
    document.removeEventListener("keydown", this.boundHandleKeydown);
    this.editorView.dom.closest(".editor-container")?.removeEventListener(
      "scroll",
      this.boundHandleScroll,
      true
    );
    this.container.removeEventListener("keydown", this.handleTabNavigation);
    this.container.remove();
  }
}
