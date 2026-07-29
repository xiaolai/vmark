/**
 * Editor action executor
 *
 * Purpose: the single semantic executor for editor actions. Both the native
 *   menu (`useUnifiedMenuCommands`) and — once the bridge lands — the Command
 *   Palette call `runEditorAction`, so an action runs IDENTICALLY regardless of
 *   invocation source: same effective-mode/target resolution, format +
 *   capability gates, unified cross-mode undo/redo, IME-safe dispatch, and
 *   tab-bound retry.
 *
 * This file is the GATE + ROUTER: it resolves the context once, applies the
 *   executor's correctness policy, then routes to the dispatch mechanics in
 *   `editorActionDispatch.ts` (origin capture, per-surface dispatch, tab-bound
 *   retry, IME-safe unified history).
 *
 * NOT here (by design): the focus gate (`shouldBlockMenuAction`). It rejects
 *   focus inside the palette's own `.quick-open` container, so pulling it into
 *   the executor would make the palette block its own commands. It stays at the
 *   native-menu boundary; the executor is invocation-source agnostic.
 *   (ADR-017 / command-registry WI-1.2.)
 *
 * @coordinates-with commands/commandContext.ts — the resolved gate context
 * @coordinates-with commands/actionAvailability.ts — isActionExecutable gate
 * @coordinates-with editorActionDispatch.ts — origin + per-surface dispatch + retry
 * @coordinates-with editorActionOwner.ts — the per-window retry owner
 * @module services/editor/runEditorAction
 */

import { ACTION_DEFINITIONS } from "@/plugins/actions/actionRegistry";
import type { ActionId } from "@/plugins/actions/types";
import { menuDispatcherLog, menuDispatcherWarn } from "@/utils/debug";
import { getEditorActionOwner } from "./editorActionOwner";
import {
  captureOrigin,
  dispatchToSource,
  dispatchToWysiwyg,
  dispatchWithRetry,
} from "./editorActionDispatch";
import { runUnifiedHistoryImeSafe } from "./unifiedHistoryDispatch";
import { resolveCommandContext } from "@/services/commands/commandContext";
import { isActionExecutable } from "@/services/commands/actionAvailability";

/** Options for a single `runEditorAction` invocation. */
export interface RunEditorActionOptions {
  /** The webview window the action targets (retry + ownership are per-window). */
  windowLabel: string;
  /** Parameterized-action payload, e.g. `{ level }` for `setHeading`. */
  params?: Record<string, unknown>;
}

/**
 * Execute an editor action. Resolves the effective surface, enforces the
 * format-policy + capability gates at execution time (never delegated to a
 * caller's stale `when()`), routes undo/redo through unified history, and
 * dispatches to the active editor with IME-safe, tab-bound retry.
 *
 * The caller is responsible for any invocation-source policy (e.g. the native
 * menu's focus gate) BEFORE calling this.
 */
export function runEditorAction(actionId: ActionId, options: RunEditorActionOptions): void {
  const { windowLabel, params } = options;

  if (!ACTION_DEFINITIONS[actionId]) {
    menuDispatcherWarn(`Unknown action: ${actionId}`);
    return;
  }

  // Single shared gate (WI-2.3): resolve the context once, then apply the
  // executor's correctness policy — live document + mode capability + format.
  // (Node/selection are the palette's discoverability concern, not enforced
  // here; the executor's retry handles a not-yet-mounted editor.)
  const ctx = resolveCommandContext(windowLabel);
  if (!isActionExecutable(actionId, ctx)) {
    menuDispatcherLog(`Action ${actionId} not executable in the current context`);
    return;
  }

  const sourceMode = ctx.mode === "source";

  // Undo/redo go through unified history (cross-mode), not the per-editor
  // adapters — and carry no tab-bound retry (the history system is per-window).
  // They still run behind the active surface's IME guard: a native accelerator
  // can deliver undo/redo while the editor is composing, and running history
  // against an in-progress composition reorders content — so defer to
  // compositionend like every other mutating action (audit-fix #3).
  if (actionId === "undo" || actionId === "redo") {
    runUnifiedHistoryImeSafe(actionId, windowLabel, sourceMode);
    return;
  }

  const origin = captureOrigin(windowLabel, sourceMode);
  const owner = getEditorActionOwner(windowLabel);
  if (sourceMode) {
    dispatchWithRetry(`${actionId} (source)`, origin, owner, () =>
      dispatchToSource(actionId, params, origin, owner),
    );
  } else {
    dispatchWithRetry(`${actionId} (wysiwyg)`, origin, owner, () =>
      dispatchToWysiwyg(actionId, params, origin, owner),
    );
  }
}
