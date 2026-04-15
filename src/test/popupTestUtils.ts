/**
 * Shared Popup Test Utilities
 *
 * Reusable helpers for testing popup views:
 * - DOM setup (editor containers, mocks)
 * - Store mocking patterns
 * - Event simulation
 * - Async helpers
 */

import { vi } from "vitest";

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
// Mock CodeMirror View (for source mode)
// ============================================================================

export interface MockCMView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  coordsAtPos: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  state: {
    doc: {
      toString: () => string;
      length: number;
    };
    selection: {
      main: { from: number; to: number };
    };
  };
  dispatch: ReturnType<typeof vi.fn>;
}

/**
 * Create a mock CodeMirror EditorView.
 */
export function createMockCMView(editorDom: HTMLElement): MockCMView {
  const contentDOM = document.createElement("div");
  contentDOM.contentEditable = "true";
  editorDom.appendChild(contentDOM);

  return {
    dom: editorDom,
    contentDOM,
    coordsAtPos: vi.fn((pos: number) => ({
      top: 100 + pos,
      left: 50,
      bottom: 120 + pos,
      right: 100,
    })),
    focus: vi.fn(),
    state: {
      doc: {
        toString: () => "",
        length: 1000,
      },
      selection: {
        main: { from: 0, to: 0 },
      },
    },
    dispatch: vi.fn(),
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
// Event Simulation
// ============================================================================

/**
 * Simulate a keydown event on an element.
 */
export function simulateKeydown(
  target: EventTarget,
  key: string,
  options: Partial<KeyboardEventInit> = {}
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

/**
 * Simulate a keyup event on an element.
 */
export function simulateKeyup(
  target: EventTarget,
  key: string,
  options: Partial<KeyboardEventInit> = {}
): KeyboardEvent {
  const event = new KeyboardEvent("keyup", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

/**
 * Simulate a click event on an element.
 */
export function simulateClick(target: EventTarget): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

/**
 * Simulate a mousedown event on an element.
 */
export function simulateMousedown(target: EventTarget): MouseEvent {
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

/**
 * Simulate an input event (for text input changes).
 */
export function simulateInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
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

/**
 * Wait for DOM updates (microtasks + RAF).
 */
export async function waitForDom(): Promise<void> {
  await Promise.resolve(); // Flush microtasks
  await waitForRAF();
}

/**
 * Wait for store subscription callbacks to fire.
 * Store updates are synchronous, but some views use RAF for rendering.
 */
export async function waitForStoreUpdate(): Promise<void> {
  await waitMs(10);
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

// ============================================================================
// Common Mock Factories
// ============================================================================

/**
 * Create common Tauri API mocks for popup tests.
 */
export function createTauriMocks() {
  return {
    "@tauri-apps/api/core": {
      convertFileSrc: vi.fn((path: string) => `asset://${path}`),
      invoke: vi.fn(),
    },
    "@tauri-apps/api/path": {
      dirname: vi.fn(() => Promise.resolve("/test/dir")),
      join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
    },
    "@tauri-apps/plugin-opener": {
      openUrl: vi.fn(() => Promise.resolve()),
    },
  };
}

/**
 * Create imeGuard mock (default: not in IME composition).
 */
export function createImeGuardMock(inComposition = false) {
  return {
    isImeKeyEvent: vi.fn(() => inComposition),
  };
}
