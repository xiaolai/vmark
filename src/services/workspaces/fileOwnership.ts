import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import {
  useWorkspaceInstancesStore,
  type WorkspaceInstanceRecord,
} from "@/stores/workspaceInstancesStore";
import i18n from "@/i18n";
import { getRuntimePlatform } from "@/utils/platform";
import { normalizeWorkspacePathForIdentity } from "@/utils/workspaceIdentity";
import {
  claimTabForWorkspaceContext,
  classifyWorkspaceContextForTab,
  orderedWindowInstances,
} from "./workspaceContextOwnership";

type FileOwnershipPlatform = "macos" | "windows" | "linux";

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

type FileOpenOwnership =
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
  const windowLabel = findWindowLabelForTab(tabId);
  if (windowLabel) {
    claimTabForWorkspaceContext(windowLabel, tabId, filePath);
  }
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
    const windowInstances = orderedWindowInstances(windowLabel);
    const activeInstanceId =
      useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
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
      // Attribute the claim to the instance that actually OWNS this tab, not
      // the window's active instance — otherwise a conflict held by an
      // inactive workspace reports the wrong workspaceInstanceId/displayName.
      const owningInstance = resolveOwningInstance(
        tab.id,
        candidatePath,
        windowInstances,
        activeInstanceId,
      );
      claims.push({
        tabId: tab.id,
        windowLabel,
        workspaceInstanceId: owningInstance?.workspaceInstanceId ?? null,
        workspaceDisplayName: owningInstance?.displayName ?? null,
        filePath: candidatePath,
        identity,
        isDirty: doc?.isDirty ?? false,
        readOnly: doc?.readOnly ?? false,
      });
    }
  }

  return claims;
}

/**
 * Resolve which workspace instance owns a given tab. Prefer explicit tab
 * membership (`instance.tabIds`); fall back to root-based classification so a
 * not-yet-claimed tab still attributes to the most specific workspace.
 */
function resolveOwningInstance(
  tabId: string,
  filePath: string,
  windowInstances: WorkspaceInstanceRecord[],
  activeInstanceId: string | null,
): WorkspaceInstanceRecord | null {
  const byMembership = windowInstances.find((instance) =>
    instance.tabIds.includes(tabId),
  );
  if (byMembership) return byMembership;
  return classifyWorkspaceContextForTab({
    filePath,
    instances: windowInstances,
    activeWorkspaceInstanceId: activeInstanceId,
  });
}

function findWindowLabelForTab(tabId: string): string | null {
  const tabsByWindow = useTabStore.getState().tabs;
  for (const [windowLabel, tabs] of Object.entries(tabsByWindow)) {
    if (tabs.some((tab) => tab.id === tabId)) return windowLabel;
  }
  return null;
}

function toOwnershipIdentity(
  filePath: string,
  canonicalPath: string | null | undefined,
  platform: FileOwnershipPlatform | undefined,
): string {
  // Derive the OS at the boundary rather than defaulting to a single platform —
  // Windows/Linux path normalization differs and a wrong default silently
  // mis-detects conflicts (T-platform finding).
  const resolved = platform ?? getRuntimePlatform();
  const path = canonicalPath?.trim() || filePath;
  // Single source of truth for path normalization — reuse the same helper that
  // workspace root identity uses, instead of a divergent local normalizer.
  const { platformIdentity } = normalizeWorkspacePathForIdentity(path, resolved);
  // Default macOS volumes (APFS/HFS+) are case-insensitive, so a case-variant
  // open of the same file must resolve to the same identity — otherwise
  // dirty-writable conflict detection is silently bypassed. (Windows is already
  // case-folded by normalizeWorkspacePathForIdentity; Linux stays
  // case-sensitive.)
  return resolved === "macos"
    ? platformIdentity.toLocaleLowerCase("en-US")
    : platformIdentity;
}
