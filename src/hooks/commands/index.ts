/**
 * Command Layer
 *
 * Pure decision logic for file operations.
 * Commands return actions to execute, not side effects.
 *
 * Usage pattern:
 * 1. Hooks call command functions to determine what to do
 * 2. Commands return action objects
 * 3. Hooks execute side effects based on action type
 */
export {
  shouldOpenInNewTab,
  resolveOpenTarget,
  type OpenInTabOptions,
  type OpenFileContext,
  type OpenFileResult,
} from "./openFileCommand";
