import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { selectActiveWorkspaceInstance, useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import i18n from "@/i18n";
import { normalizePath } from "@/utils/paths";

export type FileOwnershipPlatform = "macos" | "windows" | "linux";

export interface FileOwnershipOptions {
  currentTabId?: string | null;
  canonicalPath?: string | null;
  canonicalPaths?: Record<string, string>;
  platform?: FileOwnershipPlatform;
}

export interface WritableFileOwnershipOptions extends FileOwnershipOptions {
  force?: boolean;
}

export interface FileOwnershipClaim {
  tabId: string;
  windowLabel: string;
  workspaceInstanceId: string | null;
  workspaceDisplayName: string | null;
  filePath: string;
  identity: string;
  isDirty: boolean;
  readOnly: boolean;
}

export type FileOpenOwnership =
  | "disabled"
  | "writable"
  | "readonlyDuplicate"
  | "readonlyConflict";

export interface FileOpenOwnershipResolution {
  mode: FileOpenOwnership;
  identity: string;
  claims: FileOwnershipClaim[];
}

export type WritableFileOwnershipResolution =
  | {
      ok: true;
      mode: "disabled" | "writable" | "forced";
      identity: string;
      conflicts: FileOwnershipClaim[];
    }
  | {
      ok: false;
      reason: "dirtyWritableConflict";
      identity: string;
      conflicts: FileOwnershipClaim[];
    };

export function resolveFileOpenOwnership(
  filePath: string,
  options: FileOwnershipOptions = {},
): FileOpenOwnershipResolution {
  const identity = toOwnershipIdentity(filePath, options.canonicalPath, options.platform);
  if (!isWorkspaceRailEnabled()) return { mode: "disabled", identity, claims: [] };
  const claims = collectFileOwnershipClaims(filePath, options);
  if (claims.length === 0) return { mode: "writable", identity, claims };
  const hasDirtyWritable = claims.some((claim) => claim.isDirty && !claim.readOnly);
  return {
    mode: hasDirtyWritable ? "readonlyConflict" : "readonlyDuplicate",
    identity,
    claims,
  };
}

export function applyFileOwnershipAfterOpen(
  tabId: string,
  filePath: string,
  options: FileOwnershipOptions = {},
): FileOpenOwnershipResolution {
  const resolution = resolveFileOpenOwnership(filePath, { ...options, currentTabId: tabId });
  if (resolution.mode === "readonlyDuplicate" || resolution.mode === "readonlyConflict") {
    useDocumentStore.getState().setReadOnly(tabId, true);
  }
  return resolution;
}

export function resolveWritableFileOwnership(
  tabId: string,
  filePath: string,
  options: WritableFileOwnershipOptions = {},
): WritableFileOwnershipResolution {
  const identity = toOwnershipIdentity(filePath, options.canonicalPath, options.platform);
  if (!isWorkspaceRailEnabled()) {
    return { ok: true, mode: "disabled", identity, conflicts: [] };
  }

  const conflicts = collectFileOwnershipClaims(filePath, {
    ...options,
    currentTabId: tabId,
  }).filter((claim) => claim.isDirty && !claim.readOnly);

  if (conflicts.length === 0) {
    return { ok: true, mode: "writable", identity, conflicts };
  }
  if (options.force) return { ok: true, mode: "forced", identity, conflicts };
  return { ok: false, reason: "dirtyWritableConflict", identity, conflicts };
}

export function setDocumentReadOnlyWithOwnership(
  tabId: string,
  readOnly: boolean,
  options: WritableFileOwnershipOptions = {},
): boolean {
  const doc = useDocumentStore.getState().getDocument(tabId);
  if (!doc) return false;
  if (!readOnly && doc.filePath) {
    const ownership = resolveWritableFileOwnership(tabId, doc.filePath, options);
    if (!ownership.ok) {
      showFileOwnershipConflictToast(doc.filePath, ownership.conflicts);
      return false;
    }
  }
  useDocumentStore.getState().setReadOnly(tabId, readOnly);
  return true;
}

export function toggleDocumentReadOnlyWithOwnership(
  tabId: string,
  options: WritableFileOwnershipOptions = {},
): boolean {
  const doc = useDocumentStore.getState().getDocument(tabId);
  if (!doc) return false;
  return setDocumentReadOnlyWithOwnership(tabId, !doc.readOnly, options);
}

export function showFileOwnershipConflictToast(
  filePath: string,
  conflicts: FileOwnershipClaim[],
): void {
  const conflict = conflicts[0];
  toast.error(
    i18n.t("dialog:toast.sameFileDirtyConflict", {
      file: filePath,
      workspace: conflict?.workspaceDisplayName ?? conflict?.windowLabel ?? "",
    }),
    { pin: true },
  );
}

function collectFileOwnershipClaims(
  filePath: string,
  options: FileOwnershipOptions,
): FileOwnershipClaim[] {
  const targetIdentity = toOwnershipIdentity(filePath, options.canonicalPath, options.platform);
  const tabState = useTabStore.getState();
  const documentState = useDocumentStore.getState();
  const claims: FileOwnershipClaim[] = [];

  for (const [windowLabel, tabs] of Object.entries(tabState.tabs)) {
    const activeInstance = selectActiveWorkspaceInstance(
      useWorkspaceInstancesStore.getState(),
      windowLabel,
    );
    for (const tab of tabs) {
      if (tab.id === options.currentTabId) continue;
      const doc = documentState.getDocument(tab.id);
      const candidatePath = doc?.filePath ?? tab.filePath;
      if (!candidatePath) continue;
      const identity = toOwnershipIdentity(
        candidatePath,
        options.canonicalPaths?.[candidatePath],
        options.platform,
      );
      if (identity !== targetIdentity) continue;
      claims.push({
        tabId: tab.id,
        windowLabel,
        workspaceInstanceId: activeInstance?.workspaceInstanceId ?? null,
        workspaceDisplayName: activeInstance?.displayName ?? null,
        filePath: candidatePath,
        identity,
        isDirty: doc?.isDirty ?? false,
        readOnly: doc?.readOnly ?? false,
      });
    }
  }

  return claims;
}

function toOwnershipIdentity(
  filePath: string,
  canonicalPath: string | null | undefined,
  platform: FileOwnershipPlatform | undefined,
): string {
  const path = canonicalPath?.trim() || filePath;
  const normalized = normalizePath(path);
  return platform === "windows"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}
