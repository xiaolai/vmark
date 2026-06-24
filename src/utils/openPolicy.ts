/**
 * Open / save / external-change policy — barrel
 *
 * Purpose: Backward-compatible entry point for the pure policy helpers that
 * decide where to open a file, whether to block a save, how to react to an
 * external change, and whether to open a workspace after save. The
 * implementation is split by policy area under `openPolicy/` to stay under the
 * ~300-line guideline; import from here so existing call sites are unchanged.
 *
 * @module utils/openPolicy
 */

export type {
  ReplaceableTabInfo,
  OpenActionContext,
  OpenActionResult,
  MissingFileSaveContext,
  MissingFileSaveAction,
  ExternalChangeContext,
  ExternalChangeAction,
  PostSaveWorkspaceContext,
  PostSaveWorkspaceAction,
  TabInfo,
} from "./openPolicy/types";

export {
  resolveOpenAction,
  resolveWorkspaceRootForExternalFile,
} from "./openPolicy/openRouting";
export { resolveMissingFileSaveAction } from "./openPolicy/savePolicy";
export { resolveExternalChangeAction } from "./openPolicy/externalChangePolicy";
export { resolvePostSaveWorkspaceAction } from "./openPolicy/postSavePolicy";
export { findReplaceableTab } from "./openPolicy/replaceableTab";
