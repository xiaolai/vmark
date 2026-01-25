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

/**
 * Minimal TipTap/ProseMirror-like editor view interface.
 * We use a structural type to avoid tight coupling to specific ProseMirror versions.
 */
export type EditorViewLike = {
  dom: HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: (tr: any) => void;
  focus: () => void;
};

/**
 * Minimal store interface for popup views.
 * Stores should have at least isOpen, anchorRect, and closePopup.
 */
export interface PopupStoreBase {
  isOpen: boolean;
  anchorRect: AnchorRect | null;
  closePopup: () => void;
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

  // Lifecycle flags
  private wasOpen = false;
  private justOpened = false;
  private host: HTMLElement | null = null;

  // Event handlers (bound for cleanup)
  private boundHandleClickOutside: (e: MouseEvent) => void;
  private boundHandleKeydown: (e: KeyboardEvent) => void;
  private boundHandleScroll: () => void;

  constructor(view: EditorViewLike, store: StoreApi<TState>) {
    this.editorView = view;
    this.store = store;

    // Build DOM - container will be appended to host in show()
    this.container = this.buildContainer();
    this.container.style.display = "none";

    // Bind event handlers
    this.boundHandleClickOutside = this.handleClickOutside.bind(this);
    this.boundHandleKeydown = this.handleKeydown.bind(this);
    this.boundHandleScroll = this.handleScroll.bind(this);

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
   * Get the first focusable element to focus when popup opens.
   * Subclasses can override for custom focus behavior.
   */
  protected getFirstFocusable(): HTMLElement | null {
    return this.container.querySelector<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
  }

  /**
   * Show the popup at the anchor position.
   */
  private show(anchorRect: AnchorRect, state: TState): void {
    // Mount to editor container if available, otherwise document.body
    this.host = getPopupHostForDom(this.editorView.dom) ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = this.host === document.body ? "fixed" : "absolute";
      this.host.appendChild(this.container);
    }

    this.container.style.display = "flex";

    // Set guard to prevent immediate close from same click
    this.justOpened = true;
    requestAnimationFrame(() => {
      this.justOpened = false;
    });

    // Calculate position
    this.updatePosition(anchorRect);

    // Attach event listeners
    document.addEventListener("mousedown", this.boundHandleClickOutside);
    document.addEventListener("keydown", this.boundHandleKeydown);
    this.editorView.dom.closest(".editor-container")?.addEventListener(
      "scroll",
      this.boundHandleScroll,
      true
    );

    // Attach Tab cycling handler to container
    this.container.addEventListener("keydown", this.handleTabNavigation);

    // Call subclass hook first to set up state
    this.onShow(state);

    // Then focus the first focusable element
    requestAnimationFrame(() => {
      const firstFocusable = this.getFirstFocusable();
      if (firstFocusable) {
        firstFocusable.focus();
      }
    });
  }

  /**
   * Hide the popup.
   */
  private hide(): void {
    this.container.style.display = "none";

    // Remove event listeners
    document.removeEventListener("mousedown", this.boundHandleClickOutside);
    document.removeEventListener("keydown", this.boundHandleKeydown);
    this.editorView.dom.closest(".editor-container")?.removeEventListener(
      "scroll",
      this.boundHandleScroll,
      true
    );
    this.container.removeEventListener("keydown", this.handleTabNavigation);

    this.host = null;

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
   * Handle scroll to close popup (position becomes stale).
   */
  private handleScroll(): void {
    const state = this.store.getState();
    if (state.isOpen) {
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
   * Update popup position.
   * Call this when the document changes while popup is open.
   */
  protected updatePosition(anchorRect: AnchorRect): void {
    const dimensions = this.getPopupDimensions();
    const bounds = this.host === document.body
      ? getViewportBounds()
      : getBoundaryRects(this.editorView.dom, this.editorView.dom);

    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: dimensions.width, height: dimensions.height },
      bounds,
      gap: dimensions.gap ?? 6,
      preferAbove: dimensions.preferAbove ?? true,
    });

    // Convert to host-relative coordinates if mounted inside editor container
    if (this.host !== document.body && this.host) {
      const hostPos = toHostCoordsForDom(this.host, { top, left });
      this.container.style.top = `${hostPos.top}px`;
      this.container.style.left = `${hostPos.left}px`;
    } else {
      this.container.style.top = `${top}px`;
      this.container.style.left = `${left}px`;
    }
  }

  /**
   * Check if popup is currently visible.
   */
  protected isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  /**
   * Build an icon button (helper for subclasses).
   */
  protected buildIconButton(
    iconSvg: string,
    title: string,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "popup-icon-btn";
    btn.title = title;
    btn.innerHTML = iconSvg;
    btn.addEventListener("click", onClick);
    return btn;
  }

  /**
   * Destroy the popup view and clean up.
   */
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
