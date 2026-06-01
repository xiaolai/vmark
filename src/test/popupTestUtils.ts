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
