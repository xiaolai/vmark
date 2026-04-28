/**
 * Shared Popup Test Utilities
 *
 * Reusable helpers for testing popup views:
 * - DOM setup (editor containers, mocks)
 * - Store mocking patterns
 * - Async helpers
 */

// ============================================================================
// DOM Helpers
// ============================================================================

/**
 * Create a mock DOMRect with defaults.
 */
export function createMockRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    top: 100,
    left: 50,
    bottom: 120,
    right: 200,
    width: 150,
    height: 20,
    x: 50,
    y: 100,
    toJSON: () => ({}),
    ...overrides,
  };
}

// ============================================================================
// Store Mocking
// ============================================================================

export interface MockStoreApi<T> {
  getState: () => T;
  subscribe: (fn: (state: T) => void) => () => void;
  /** Test helper: update state and notify subscribers */
  _setState: (newState: Partial<T>) => void;
  /** Test helper: reset to initial state */
  _reset: () => void;
  /** Test helper: get current subscribers count */
  _getSubscriberCount: () => number;
}

/**
 * Create a mock Zustand-like store for testing popup views.
 *
 * Usage:
 * ```ts
 * vi.mock("@/stores/linkPopupStore", () => {
 *   const { createMockStore } = require("@/test/popupTestUtils");
 *   return { useLinkPopupStore: createMockStore(initialState) };
 * });
 * ```
 */
export function createMockStore<T extends Record<string, unknown>>(initialState: T): MockStoreApi<T> {
  let state = { ...initialState };
  let subscribers: Array<(state: T) => void> = [];

  return {
    getState: () => state,
    subscribe: (fn) => {
      subscribers.push(fn);
      return () => {
        subscribers = subscribers.filter((s) => s !== fn);
      };
    },
    _setState: (newState) => {
      state = { ...state, ...newState };
      subscribers.forEach((fn) => fn(state));
    },
    _reset: () => {
      state = { ...initialState };
      subscribers = [];
    },
    _getSubscriberCount: () => subscribers.length,
  };
}

// ============================================================================
// Async Helpers
// ============================================================================

/**
 * Wait for next requestAnimationFrame.
 */
export function waitForRAF(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Wait for a specified number of milliseconds.
 */
export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Get all focusable elements within a container.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null);
}
