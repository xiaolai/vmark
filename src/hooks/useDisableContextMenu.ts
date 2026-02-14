/**
 * Disable Context Menu Hook (No-Op)
 *
 * Purpose: Previously disabled the browser context menu in production.
 *   Now a no-op — Tauri release builds don't expose devtools anyway,
 *   and blocking prevents useful system features (Copy, Paste, Spell Check).
 *
 * @module hooks/useDisableContextMenu
 */
export function useDisableContextMenu() {
  // No-op: allow system context menu everywhere
}
