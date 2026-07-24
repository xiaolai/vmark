/**
 * Editor-action command bridge
 *
 * Purpose: lift every editor `ActionId` into the CommandBus as a `CommandSpec`,
 *   so the Command Palette can finally find and run editing actions (bold,
 *   headings, tables, undo…) — the adapter ADR-012 declared but never built.
 *
 *   Each spec's `run` calls the ONE shared executor, `runEditorAction`, and its
 *   `when` calls the ONE availability predicate, `actionAvailability`, so the
 *   palette runs an action identically to the menu (Phase 1) and offers exactly
 *   what is available (Phase 2/2b).
 *
 *   `setHeading` is PROJECTED into six searchable rows (`editor.setHeading.1..6`)
 *   — a palette projection over one action *operation*, NOT six actions. The
 *   ActionId stays `"setHeading"`; the level is an invocation parameter, and each
 *   row's `run` calls `runEditorAction("setHeading", { level })`. No plain,
 *   un-runnable `editor.setHeading` is ever produced (WI-3.1).
 *
 * @coordinates-with CommandBus.ts — registered as a batch via registerCommands
 * @coordinates-with actionAvailability.ts — each spec's `when`
 * @coordinates-with editor/runEditorAction.ts — each spec's `run`
 * @module services/commands/editorCommandBridge
 */

import i18n from "@/i18n";
import { ACTION_DEFINITIONS } from "@/plugins/actions/actionRegistry";
import type { ActionId, HeadingLevel } from "@/plugins/actions/types";
import { runEditorAction } from "@/services/editor/runEditorAction";
import { registerCommands, type CommandContext, type CommandDefinition } from "./CommandBus";
import type { CommandContextResolved } from "./commandContext";
import { actionAvailability } from "./actionAvailability";

/** Owner token the bridge registers its whole batch under (HMR-safe). */
export const EDITOR_COMMANDS_OWNER = "editor-actions";

const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6];

function windowLabelOf(ctx: CommandContext): string {
  const label = (ctx as CommandContextResolved).windowLabel;
  return typeof label === "string" ? label : "main";
}

function makeSpec(
  actionId: ActionId,
  spec: { id: string; i18nKey: string; label: string; params?: Record<string, unknown> },
): CommandDefinition {
  const def = ACTION_DEFINITIONS[actionId];
  return {
    id: spec.id,
    title: () => i18n.t(spec.i18nKey, { defaultValue: spec.label }),
    category: def.category,
    scope: "editor",
    when: (ctx) => actionAvailability(actionId, ctx as CommandContextResolved),
    run: (_args, ctx) =>
      runEditorAction(actionId, { windowLabel: windowLabelOf(ctx), params: spec.params }),
  };
}

/**
 * Build a CommandSpec for every editor ActionId (setHeading → six heading rows).
 * Pure — no registration; the bootstrap registers the batch via
 * `registerCommands(EDITOR_COMMANDS_OWNER, …)`.
 */
export function buildEditorCommandSpecs(): CommandDefinition[] {
  const specs: CommandDefinition[] = [];
  for (const actionId of Object.keys(ACTION_DEFINITIONS) as ActionId[]) {
    if (actionId === "setHeading") {
      for (const level of HEADING_LEVELS) {
        specs.push(
          makeSpec(actionId, {
            id: `editor.setHeading.${level}`,
            i18nKey: `commands:editor.setHeading.${level}`,
            label: `Heading ${level}`,
            params: { level },
          }),
        );
      }
      continue;
    }
    specs.push(
      makeSpec(actionId, {
        id: `editor.${actionId}`,
        i18nKey: `commands:editor.${actionId}`,
        label: ACTION_DEFINITIONS[actionId].label,
      }),
    );
  }
  return specs;
}

/**
 * Register the whole editor-command batch in the CommandBus under the bridge's
 * owner token, returning a disposer. HMR-safe (replace-own) via registerCommands.
 * Called once from the command bootstrap (WI-3.4).
 */
export function registerEditorCommands(): () => void {
  return registerCommands(EDITOR_COMMANDS_OWNER, buildEditorCommandSpecs());
}
