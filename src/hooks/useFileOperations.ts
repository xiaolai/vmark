/**
 * File Operations Hook
 *
 * Purpose: Central hook for file menu events — Open, Save, Save As,
 *   New Tab, New Window, Close Tab, and file-related keyboard shortcuts.
 *   Delegates to useFileSave, useFileOpen, and useFileShortcuts.
 *
 * Pipeline: Rust menu event -> Tauri `listen()` -> useFileShortcuts routes to
 *   the appropriate handler in useFileSave/useFileOpen -> store updates + file I/O
 *
 * @coordinates-with useFileSave.ts — save operations and workspace moves
 * @coordinates-with useFileOpen.ts — open operations and tab creation
 * @coordinates-with useFileShortcuts.ts — menu listeners and keyboard shortcuts
 * @module hooks/useFileOperations
 */

import { useWindowLabel } from "@/contexts/WindowContext";
import { useFileShortcuts } from "./useFileShortcuts";

// Re-export for testing and external consumers
export { moveTabToNewWorkspaceWindow } from "./useFileSave";
export { openFileInNewTabCore } from "./useFileOpen";

export function useFileOperations() {
  const windowLabel = useWindowLabel();
  useFileShortcuts(windowLabel);
}
