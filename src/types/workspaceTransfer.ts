export type WorkspaceWindowOperation = "move" | "duplicate";

export interface WorkspaceTransferTabPayload {
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

export type WorkspaceActionFailureReason =
  | "disabled"
  | "missingInstance"
  | "invokeFailed"
  | "timeout";

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
