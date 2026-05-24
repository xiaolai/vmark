/**
 * actionBridge — auto-register actionRegistry entries with CommandBus (ADR-012).
 *
 * The legacy `actionRegistry` (src/plugins/actions/) is a rich data set of
 * ~80 editor actions, each with id, category, label key, and mode support.
 * This module exposes it through CommandBus so palette + MCP + programmatic
 * callers can dispatch any editor action by name without needing to know
 * about the menu-dispatch path.
 *
 * The actual dispatch for these actions still happens inside
 * `useUnifiedMenuCommands` (mode-aware adapter routing). Bridge commands
 * here are no-op placeholders whose presence in the registry makes them
 * palette-visible; menu→action wiring remains the live path for now.
 *
 * @module services/commands/actionBridge
 */

import { ACTION_DEFINITIONS } from "@/plugins/actions/actionRegistry";
import { registerCommand } from "./CommandBus";

let bridged = false;

/**
 * Idempotently register every actionRegistry entry as a no-op command.
 * Palette / search surfaces immediately see the entire editor-action set.
 * Replacing the no-op with real dispatch is part of the per-hook migration
 * tracked in ADR-012.
 */
export function bridgeActionRegistry(): void {
  if (bridged) return;
  for (const [id, def] of Object.entries(ACTION_DEFINITIONS)) {
    try {
      registerCommand({
        id: `action.${id}`,
        title: def.label ?? id,
        category: def.category ?? "editor",
        scope: "editor",
        // Placeholder run; the real dispatcher (`useUnifiedMenuCommands`)
        // still handles menu-event-driven invocations. Programmatic
        // callers can still discover and inspect commands via
        // listCommands() / searchCommands(); execution wiring is the
        // follow-up.
        run: () => {
          /* bridged action — real dispatch lives in useUnifiedMenuCommands */
        },
      });
    } catch {
      // Duplicate registration — ignore (idempotent semantics).
    }
  }
  bridged = true;
}

/** Test-only reset. */
export function _resetActionBridge(): void {
  bridged = false;
}
