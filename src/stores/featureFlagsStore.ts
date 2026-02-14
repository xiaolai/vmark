/**
 * Feature Flags
 *
 * Purpose: Compile-time constants for gradual feature rollout. Flags are
 *   `as const` so dead code is tree-shaken in production builds.
 *
 * Usage:
 *   import { FEATURE_FLAGS } from "@/stores/featureFlagsStore";
 *   if (FEATURE_FLAGS.UNIFIED_MENU_DISPATCHER) { ... }
 *
 * Key decisions:
 *   - Not a Zustand store — just a plain const object. No runtime overhead.
 *   - Flags should be removed (not set to false) once the feature is stable.
 *
 * @module stores/featureFlagsStore
 */

export const FEATURE_FLAGS = {
  /**
   * When enabled, uses the unified menu dispatcher instead of legacy per-hook handlers.
   * This routes all menu events through a single dispatcher with proper mode routing.
   *
   * Phase 4: Enable in dev only for testing
   * Phase 5: Enable in production after testing
   * Phase 6: Remove flag entirely after stable period
   */
  UNIFIED_MENU_DISPATCHER: true,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
