/**
 * Source Popup View Base Class
 *
 * Abstract base class for popup views in Source mode (CodeMirror 6).
 * Provides common functionality: DOM lifecycle, store subscription,
 * keyboard navigation, click-outside handling, and positioning.
 */

import type { EditorView } from "@codemirror/view";
import type { AnchorRect } from "@/utils/popupPosition";
import { calculatePopupPosition } from "@/utils/popupPosition";
import { handlePopupTabNavigation } from "@/utils/popupComponents";
import { getEditorBounds, getPopupHost, toHostCoords } from "./sourcePopupUtils";
import { isImeKeyEvent } from "@/utils/imeGuard";

/**
 * Minimal store interface for popup views.
 * Stores should have at least isOpen, anchorRect, and closePopup.
 */
export interface PopupStoreBase {
  isOpen: boolean;
  anchorRect: AnchorRect | null;
  closePopup?: () => void;
}

/**
 * Store-like interface that provides getState and subscribe.
 */
export interface StoreApi<T> {
  getState: () => T;
  subscribe: (listener: (state: T) => void) => () => void;
}

/**
 * Configuration options for popup positioning.
 */
export interface PopupPositionConfig {
  width: number;
  height: number;
  gap?: number;
  preferAbove?: boolean;
}

/**
 * Abstract base class for Source mode popup views.
 *
 * Subclasses must implement:
 * - buildContainer(): Create the popup DOM structure
 * - onShow(): Called when popup becomes visible
 * - onHide(): Called when popup is hidden
 * - extractState(): Extract relevant state for open/close detection
 *
 * @template TState - The store state type
 */
export abstract class SourcePopupView<TState extends PopupStoreBase> {
  protected container: HTMLElement;
  protected editorView: EditorView;
  protected store: StoreApi<TState>;
  protected unsubscribe: () => void;
  protected host: HTMLElement | null = null;

  // Lifecycle flags
  private wasOpen = false;
  private justOpened = false;

  // Event handlers (bound for cleanup)
  private boundHandleClickOutside: (e: MouseEvent) => void;
  private boundHandleKeydown: (e: KeyboardEvent) => void;

  constructor(view: EditorView, store: StoreApi<TState>) {
    this.editorView = view;
    this.store = store;

    // Build DOM
    this.container = this.buildContainer();
    this.container.style.display = "none";
    this.container.style.position = "absolute";
    this.host = getPopupHost(this.editorView) ?? this.editorView.dom;
    this.host.appendChild(this.container);

    // Bind event handlers
    this.boundHandleClickOutside = this.handleClickOutside.bind(this);
    this.boundHandleKeydown = this.handleKeydown.bind(this);

    // Subscribe to store
    this.unsubscribe = store.subscribe((state) => {
      const { isOpen, anchorRect } = this.extractState(state);

      if (isOpen && anchorRect) {
        if (!this.wasOpen) {
          this.show(anchorRect, state);
        }
        this.wasOpen = true;
      } else {
        if (this.wasOpen) {
          this.hide();
        }
        this.wasOpen = false;
      }
    });
  }

  /**
   * Build the popup DOM container.
   * Subclasses should create and return their popup element.
   */
  protected abstract buildContainer(): HTMLElement;

  /**
   * Called when popup becomes visible.
   * Subclasses can override to set up input values, focus, etc.
   */
  protected abstract onShow(state: TState): void;

  /**
   * Called when popup is hidden.
   * Subclasses can override for cleanup.
   */
  protected abstract onHide(): void;

  /**
   * Extract isOpen and anchorRect from store state.
   * Subclasses can override if using different field names.
   */
  protected extractState(state: TState): { isOpen: boolean; anchorRect: AnchorRect | null } {
    return {
      isOpen: state.isOpen,
      anchorRect: state.anchorRect,
    };
  }

  /**
   * Get the popup dimensions for positioning.
   * Subclasses can override for custom sizing.
   */
  protected getPopupDimensions(): PopupPositionConfig {
    return {
      width: 320,
      height: 40,
      gap: 6,
      preferAbove: true,
    };
  }

  /**
   * Show the popup at the anchor position.
   */
  private show(anchorRect: AnchorRect, state: TState): void {
    this.container.style.display = "flex";

    // Set guard to prevent immediate close from same click
    this.justOpened = true;
    requestAnimationFrame(() => {
      this.justOpened = false;
    });

    // Calculate position
    const bounds = getEditorBounds(this.editorView);
    const dimensions = this.getPopupDimensions();
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: dimensions.width, height: dimensions.height },
      bounds,
      gap: dimensions.gap ?? 6,
      preferAbove: dimensions.preferAbove ?? true,
    });

    const host = this.host ?? this.editorView.dom;
    const hostPos = toHostCoords(host, { top, left });
    this.container.style.top = `${hostPos.top}px`;
    this.container.style.left = `${hostPos.left}px`;

    // Attach event listeners
    document.addEventListener("mousedown", this.boundHandleClickOutside);
    document.addEventListener("keydown", this.boundHandleKeydown);

    // Attach Tab cycling handler to container
    this.container.addEventListener("keydown", this.handleTabNavigation);

    // Call subclass hook
    this.onShow(state);
  }

  /**
   * Hide the popup.
   */
  private hide(): void {
    this.container.style.display = "none";

    // Remove event listeners
    document.removeEventListener("mousedown", this.boundHandleClickOutside);
    document.removeEventListener("keydown", this.boundHandleKeydown);
    this.container.removeEventListener("keydown", this.handleTabNavigation);

    // Call subclass hook
    this.onHide();
  }

  /**
   * Handle Tab key for focus cycling within popup.
   */
  private handleTabNavigation = (e: KeyboardEvent): void => {
    if (isImeKeyEvent(e)) return;
    handlePopupTabNavigation(e, this.container);
  };

  /**
   * Handle click outside to close popup.
   */
  private handleClickOutside(e: MouseEvent): void {
    if (this.justOpened) return;

    const state = this.store.getState();
    if (!state.isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      this.closePopup();
    }
  }

  /**
   * Handle Escape key to close popup.
   */
  private handleKeydown(e: KeyboardEvent): void {
    if (isImeKeyEvent(e)) return;

    if (e.key === "Escape") {
      e.preventDefault();
      this.closePopup();
      this.editorView.focus();
    }
  }

  /**
   * Close the popup via store action.
   */
  protected closePopup(): void {
    const state = this.store.getState();
    if (typeof state.closePopup === "function") {
      state.closePopup();
    }
  }

  /**
   * Focus the editor.
   */
  protected focusEditor(): void {
    this.editorView.focus();
  }

  /**
   * Update popup position if anchor has moved.
   * Call this when the document changes while popup is open.
   */
  protected updatePosition(anchorRect: AnchorRect): void {
    if (this.container.style.display === "none") return;

    const bounds = getEditorBounds(this.editorView);
    const dimensions = this.getPopupDimensions();
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: dimensions.width, height: dimensions.height },
      bounds,
      gap: dimensions.gap ?? 6,
      preferAbove: dimensions.preferAbove ?? true,
    });

    const host = this.host ?? this.editorView.dom;
    const hostPos = toHostCoords(host, { top, left });
    this.container.style.top = `${hostPos.top}px`;
    this.container.style.left = `${hostPos.left}px`;
  }

  /**
   * Check if popup is currently visible.
   */
  protected isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  /**
   * Destroy the popup view and clean up.
   */
  destroy(): void {
    this.unsubscribe();
    document.removeEventListener("mousedown", this.boundHandleClickOutside);
    document.removeEventListener("keydown", this.boundHandleKeydown);
    this.container.removeEventListener("keydown", this.handleTabNavigation);
    this.container.remove();
  }
}
