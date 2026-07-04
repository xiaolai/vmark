/**
 * Action Definitions
 *
 * Single source of truth for all editor action metadata — labels, categories,
 * and per-mode capability flags (wysiwyg/source).
 *
 * The table is split by category into sibling slice modules
 * (`actionDefinitionsCore.ts`, `actionDefinitionsBlocks.ts`,
 * `actionDefinitionsText.ts`) to keep files under ~300 lines; this module
 * merges them and remains the only import surface for consumers. The
 * `Record<ActionId, ActionDefinition>` annotation keeps the merge
 * exhaustive — a missing action ID is a compile error.
 *
 * @coordinates-with actionRegistry.ts — registry logic and dev-time validation
 * @coordinates-with types.ts — defines ActionId, ActionDefinition
 * @module plugins/actions/actionDefinitions
 */

import type { ActionId, ActionDefinition } from "./types";
import { CORE_ACTIONS } from "./actionDefinitionsCore";
import { BLOCK_ACTIONS } from "./actionDefinitionsBlocks";
import { TEXT_ACTIONS } from "./actionDefinitionsText";

export const ACTION_DEFINITIONS: Record<ActionId, ActionDefinition> = {
  ...CORE_ACTIONS,
  ...BLOCK_ACTIONS,
  ...TEXT_ACTIONS,
};
