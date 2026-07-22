/**
 * File Operations Hook
 *
 * Purpose: Central hook for file menu events — Open, Save, Save As,
 *   New Tab, New Window, Close Tab, and file-related keyboard shortcuts.
 *   Delegates to useFileSave, services/navigation/fileOpen, and useFileShortcuts.
 *
 * Pipeline: Rust menu event -> Tauri `listen()` -> useFileShortcuts routes to
 *   the appropriate handler in useFileSave or services/navigation/fileOpen
 *   -> store updates + file I/O
 *
 * @coordinates-with useFileSave.ts — save operations and workspace moves
 * @coordinates-with services/navigation/fileOpen.ts — open operations and tab creation
 * @coordinates-with useFileShortcuts.ts — menu listeners and keyboard shortcuts
 * @module hooks/useFileOperations
 */

import { useWindowLabel } from "@/contexts/WindowContext";
import { useFileShortcuts } from "./useFileShortcuts";

// Re-export for testing and external consumers
export { moveTabToNewWorkspaceWindow } from "./useFileSave";
export { openFileInNewTabCore } from "@/services/navigation/fileOpen";

/** Hook that wires up file menu events (Open, Save, Save As, New Tab, Close Tab) for the current window. */
export function useFileOperations() {
  const windowLabel = useWindowLabel();
  useFileShortcuts(windowLabel);
}
