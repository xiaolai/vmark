/**
 * Command Layer
 *
 * Purpose: Pure decision logic for file operations — commands return action
 *   objects describing what to do, not side effects. Hooks call commands
 *   to determine intent, then execute the resulting actions.
 *
 * @module hooks/commands
 */
export {
  shouldOpenInNewTab,
  resolveOpenTarget,
  type OpenInTabOptions,
  type OpenFileContext,
  type OpenFileResult,
} from "./openFileCommand";

export { applyPathReconciliation } from "./applyPathReconciliation";
