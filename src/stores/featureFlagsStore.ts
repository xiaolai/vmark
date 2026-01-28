/**
 * Feature flags for gradual rollout of new features.
 *
 * Usage:
 *   import { FEATURE_FLAGS } from "@/stores/featureFlagsStore";
 *   if (FEATURE_FLAGS.UNIFIED_MENU_DISPATCHER) { ... }
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
