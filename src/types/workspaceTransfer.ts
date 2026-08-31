import type { TransferLineMetadata } from "@/utils/transferLineMetadata";

export type WorkspaceWindowOperation = "move" | "duplicate";

/**
 * A tab moving between workspace windows.
 *
 * Extends `TransferLineMetadata` for the same reason `TabTransferPayload`
 * does: `content` and `savedContent` are canonical editor text and cannot
 * carry the file's line ending or BOM, so a CRLF+BOM file moved here was
 * rewritten LF and BOM-less on its first save under `preserve`.
 */
export interface WorkspaceTransferTabPayload extends TransferLineMetadata {
  tabId: string;
  title: string;
  filePath: string | null;
  content: string;
  savedContent: string;
  isDirty: boolean;
  readOnly: boolean;
  isPinned: boolean;
  formatId: string;
  editingEnabled?: boolean;
  activeSchemaId?: string | null;
}

export interface WorkspaceTransferPayload {
  requestId: string;
  operation: WorkspaceWindowOperation;
  sourceWindowLabel: string;
  workspaceInstanceId: string;
  kind: "workspace" | "loose" | "placeholder";
  rootId: string | null;
  rootPath: string | null;
  displayName: string;
  activeTabId: string | null;
  tabs: WorkspaceTransferTabPayload[];
}

export interface WorkspaceTransferAckPayload {
  requestId: string;
  targetWindowLabel: string;
  workspaceInstanceId: string;
}

export interface WorkspaceActionOptions {
  timeoutMs?: number;
  cleanupTab?: (tabId: string) => void;
}

type WorkspaceActionFailureReason =
  | "disabled"
  | "missingInstance"
  | "invokeFailed"
  | "timeout"
  /** A move/duplicate for this instance is already in flight (audit
   *  20260831 #28 — mirrors closeWorkspaceInstance's `closing` guard). */
  | "busy";

export type WorkspaceWindowActionResult =
  | {
      ok: true;
      targetWindowLabel: string;
      skippedDirtyCount?: number;
      skippedUntitledCount?: number;
      skippedMissingCount?: number;
    }
  | {
      ok: false;
      reason: WorkspaceActionFailureReason;
      targetWindowLabel?: string;
    };

export type WorkspaceOpener = (
  rootPath: string,
  options: {
    windowLabel: string;
    workspaceInstanceId: string;
    createdFrom: "duplicate" | "dragOut";
  },
) => Promise<unknown>;
