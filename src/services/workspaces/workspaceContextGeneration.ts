/**
 * Per-window workspace-context generation counter (WI-2R invariant 5).
 *
 * Purpose: every rail switch bumps the window's generation; every ASYNC
 * completion that applies context state (legacy config refresh WI-5R, content
 * search WI-12.3, split-persistence reads WI-10.3) captures the generation at
 * start and discards its result if the window has moved on. This is what makes
 * rapid A→B→C switching converge on C regardless of I/O ordering.
 *
 * Deliberately a leaf module (no store imports) so services AND stores can
 * consume it without cycles.
 *
 * @coordinates-with services/workspaces/switchWorkspaceInstance.ts — bumps
 * @coordinates-with services/workspaces/syncLegacyWorkspaceContext.ts — guards
 * @module services/workspaces/workspaceContextGeneration
 */

const generations = new Map<string, number>();

/** The window's current context generation (0 before any switch). */
export function currentContextGeneration(windowLabel: string): number {
  return generations.get(windowLabel) ?? 0;
}

/** Bump and return the window's new generation (a switch is starting). */
export function bumpContextGeneration(windowLabel: string): number {
  const next = currentContextGeneration(windowLabel) + 1;
  generations.set(windowLabel, next);
  return next;
}

/** True when `generation` is still the window's latest. */
export function isCurrentContextGeneration(
  windowLabel: string,
  generation: number,
): boolean {
  return currentContextGeneration(windowLabel) === generation;
}

/** Test-only: reset all counters. */
export function resetContextGenerations(): void {
  generations.clear();
}
