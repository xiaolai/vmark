/**
 * Action Registry
 *
 * Purpose: Single source of truth for mapping Tauri menu events to editor actions,
 * with metadata (label, category, mode capability) for each action.
 *
 * Pipeline: Tauri menu event -> MENU_TO_ACTION lookup -> action dispatch -> mode-specific adapter
 *
 * Key decisions:
 *   - Menu IDs are validated against src/shared/menu-ids.json at dev time to catch Rust/TS drift
 *   - Actions declare per-mode capability (wysiwyg/source) so dispatchers can skip unsupported ops
 *
 * @coordinates-with types.ts — defines ActionId, ActionDefinition, and related types
 * @coordinates-with src/shared/menu-ids.json — Rust-extracted menu IDs used for dev-time validation
 * @coordinates-with menuMapping.ts — MENU_TO_ACTION constant
 * @coordinates-with actionDefinitions.ts — ACTION_DEFINITIONS constant
 * @module plugins/actions/actionRegistry
 */

import type {
  ActionId,
  ActionDefinition,
  MenuEventId,
  MenuActionMapping,
  HeadingLevel,
} from "./types";
import menuIdsData from "@shared/menu-ids.json";
import { MENU_TO_ACTION } from "./menuMapping";
import { ACTION_DEFINITIONS } from "./actionDefinitions";
import { actionRegistryWarn } from "@/utils/debug";

// Re-export for consumers that import from this module
export { MENU_TO_ACTION } from "./menuMapping";
export { ACTION_DEFINITIONS } from "./actionDefinitions";

// Type assertion for JSON import
const menuIds = menuIdsData as { menuIds: string[]; allMenuIds: string[] };

/**
 * Get action definition by ID.
 */
export function getActionDefinition(actionId: ActionId): ActionDefinition | undefined {
  return ACTION_DEFINITIONS[actionId];
}

/**
 * Get action mapping from menu event ID.
 */
export function getActionFromMenu(menuEvent: MenuEventId): MenuActionMapping | undefined {
  return MENU_TO_ACTION[menuEvent];
}

/**
 * Check if an action supports a specific mode.
 */
export function actionSupportsMode(actionId: ActionId, mode: "wysiwyg" | "source"): boolean {
  const def = ACTION_DEFINITIONS[actionId];
  if (!def) return false;
  return def.supports[mode];
}

/**
 * Extract heading level from params.
 */
export function getHeadingLevelFromParams(params?: Record<string, unknown>): HeadingLevel {
  const level = params?.level;
  // Require a whole number 1–6: HeadingLevel is the discrete set {1,2,3,4,5,6};
  // a fractional value (e.g. 2.5) would be cast through and produce a malformed
  // heading in the WYSIWYG/Source setters (audit-fix #4).
  if (typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 6) {
    return level as HeadingLevel;
  }
  return 1;
}

/**
 * Get all menu event IDs that are mapped.
 */
export function getMappedMenuEvents(): MenuEventId[] {
  return Object.keys(MENU_TO_ACTION) as MenuEventId[];
}

// === Dev-time validation ===

/* v8 ignore start -- DEV-only validation: false-branch unreachable (DEV=true in vitest); warning paths unreachable when registries are in sync */
if (import.meta.env?.DEV) {
  const mappedMenuIds = new Set(
    Object.keys(MENU_TO_ACTION).map((k) => k.replace("menu:", ""))
  );
  const missingInRegistry = menuIds.menuIds.filter((id) => !mappedMenuIds.has(id));
  const extraInRegistry = [...mappedMenuIds].filter(
    (id) => !menuIds.menuIds.includes(id)
  );

  if (missingInRegistry.length > 0) {
    actionRegistryWarn(
      "Menu IDs from Rust missing from MENU_TO_ACTION:",
      missingInRegistry
    );
  }
  if (extraInRegistry.length > 0) {
    console.info(
      "[ActionRegistry] Extra menu IDs in MENU_TO_ACTION (not extracted from Rust):",
      extraInRegistry
    );
  }
}
/* v8 ignore stop */
