/**
 * File Operations Hook
 *
 * Purpose: Central hook for file menu events — Open, Save, Save As,
 *   New Tab, New Window, Close Tab, and file-related keyboard shortcuts.
 *   Now mounts only the OPEN_FILE_EVENT listener; file menu/keyboard actions moved to the CommandBus + keybinding registry.
 *
 * Pipeline: OPEN_FILE_EVENT (broadcast) -> useOpenFileEvent -> handleOpenFile.
 *   the appropriate handler in useFileSave or services/navigation/fileOpen
 *   -> store updates + file I/O
 *
 * @coordinates-with useFileSave.ts — save operations and workspace moves
 * @coordinates-with services/navigation/fileOpen.ts — open operations and tab creation
 * @module hooks/useFileOperations
 */

import { useOpenFileEvent } from "./useOpenFileEvent";

// Re-export for testing and external consumers
export { moveTabToNewWorkspaceWindow } from "./useFileSave";
export { openFileInNewTabCore } from "@/services/navigation/fileOpen";

/**
 * Hook for the document window's file plumbing. The file menu events (New, Open,
 * Save, Save As, Move To, Save All + Quit) and the keyboard save/save-as now flow
 * through the CommandBus / keybinding registry; what remains here is the custom
 * OPEN_FILE_EVENT listener (file explorer / wiki / markdown links).
 */
export function useFileOperations() {
  useOpenFileEvent();
}
