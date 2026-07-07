/**
 * Workspace Identity Logic
 *
 * Purpose: Pure helpers for generating workspace identities and managing their trust level.
 * Each workspace gets a unique UUID persisted in its .vmark/config.json file.
 *
 * Key decisions:
 *   - UUID v4 (crypto.randomUUID) for globally unique workspace identification
 *   - Trust levels control capabilities (untrusted: limited, trusted: can run tasks)
 *   - Pure functions — no filesystem access (caller handles persistence)
 *
 * @coordinates-with workspaceStore.ts — stores workspace ID and trust level
 * @module utils/workspaceIdentity
 */

import {
  deriveWorkspaceDisplayName,
  normalizeWorkspacePathForIdentity,
  type WorkspacePlatform,
} from "./workspaceIdentityPaths";

export {
  normalizeWorkspacePathForIdentity,
  type WorkspacePlatform,
} from "./workspaceIdentityPaths";

/**
 * Trust levels for workspaces.
 *
 * - untrusted: Default for new workspaces. Limited capabilities.
 * - trusted: User has explicitly trusted this workspace. May run tasks.
 */
type WorkspaceTrustLevel = "untrusted" | "trusted";

/**
 * Workspace identity data stored in config
 */
export interface WorkspaceIdentity {
  /** Unique identifier for this workspace (UUID v4) */
  id: string;
  /** When this workspace was first created */
  createdAt: number;
  /** Current trust level */
  trustLevel: WorkspaceTrustLevel;
  /** When trust was granted (null if untrusted) */
  trustedAt: number | null;
}

/**
 * Generate a new workspace identity.
 *
 * @returns Fresh identity with unique ID and untrusted status
 */
export function createWorkspaceIdentity(): WorkspaceIdentity {
  return {
    id: generateUUID(),
    createdAt: Date.now(),
    trustLevel: "untrusted",
    trustedAt: null,
  };
}

/**
 * Generate a UUID v4.
 * Uses crypto.randomUUID when available, falls back to manual generation.
 */
export function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for older environments
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Mark a workspace as trusted.
 *
 * @param identity - Current identity to update
 * @returns Updated identity with trust granted
 */
export function grantTrust(identity: WorkspaceIdentity): WorkspaceIdentity {
  return {
    ...identity,
    trustLevel: "trusted",
    trustedAt: Date.now(),
  };
}

/**
 * Revoke trust from a workspace.
 *
 * @param identity - Current identity to update
 * @returns Updated identity with trust revoked
 */
export function revokeTrust(identity: WorkspaceIdentity): WorkspaceIdentity {
  return {
    ...identity,
    trustLevel: "untrusted",
    trustedAt: null,
  };
}

/**
 * Check if a workspace is trusted.
 *
 * @param identity - Identity to check (may be undefined for old configs)
 * @returns true if workspace has been granted trust
 */
export function isTrusted(identity: WorkspaceIdentity | undefined): boolean {
  return identity?.trustLevel === "trusted";
}

export type WorkspaceInstanceCreatedFrom =
  | "open"
  | "finderOpen"
  | "duplicate"
  | "dragOut"
  | "restore"
  | "placeholder";

export type WorkspaceInstanceKind = "workspace" | "loose" | "placeholder";

export interface WorkspaceRootIdentity {
  rootId: string;
  rootPath: string;
  displayName: string;
  platformIdentity: string;
  canonicalization: "canonical" | "fallback";
}

export type WorkspaceRootIdentityResult =
  | { ok: true; root: WorkspaceRootIdentity }
  | { ok: false; error: "emptyRootPath" };

export interface WorkspaceInstanceIdentity {
  workspaceInstanceId: string;
  kind: WorkspaceInstanceKind;
  rootId: string | null;
  rootPath: string | null;
  /**
   * Human-readable name. For real workspaces this is the root folder name. For
   * synthetic (loose/placeholder) instances it is an English fallback only —
   * render boundaries should prefer `displayNameKey` when present so the label
   * is translated.
   */
  displayName: string;
  /**
   * i18n key for synthetic instances (loose/placeholder). Absent for real
   * workspaces, whose `displayName` is a real path-derived name. Lets React
   * render boundaries translate "Loose Files" / "Untitled" instead of showing
   * the stored English fallback (T245).
   */
  displayNameKey?: string;
  ownerWindowLabel: string;
  createdFrom: WorkspaceInstanceCreatedFrom;
  activeTabId: string | null;
  tabIds: string[];
  closedTabIds: string[];
  unavailableRoot?: boolean;
}

/** i18n keys for synthetic-instance display names, translated at render time. */
const WORKSPACE_INSTANCE_DISPLAY_NAME_KEYS = {
  loose: "common:workspaceRail.looseFiles",
  placeholder: "common:untitled",
} as const;

export function createWorkspaceRootIdentity(
  rawPath: string | null,
  options: {
    canonicalPath?: string | null;
    displayName?: string;
    platform?: WorkspacePlatform;
  } = {}
): WorkspaceRootIdentityResult {
  if (rawPath == null || rawPath.trim() === "") {
    return { ok: false, error: "emptyRootPath" };
  }

  const platform = options.platform ?? "macos";
  const requested = normalizeWorkspacePathForIdentity(rawPath, platform);
  // Use trim only to detect a blank canonical path; the untrimmed value is what
  // gets normalized so surrounding spaces in a real canonical path are preserved
  // and don't collapse distinct paths into one identity.
  const rawCanonical = options.canonicalPath;
  const hasCanonical = rawCanonical != null && rawCanonical.trim() !== "";
  const identity = hasCanonical
    ? normalizeWorkspacePathForIdentity(rawCanonical, platform)
    : requested;

  return {
    ok: true,
    root: {
      rootId: `path:${platform}:${identity.platformIdentity}`,
      rootPath: requested.normalizedPath,
      displayName:
        options.displayName ?? deriveWorkspaceDisplayName(requested.normalizedPath, platform),
      platformIdentity: identity.platformIdentity,
      canonicalization: hasCanonical ? "canonical" : "fallback",
    },
  };
}

export function createWorkspaceInstance(options: {
  workspaceInstanceId: string;
  root: WorkspaceRootIdentity | null;
  ownerWindowLabel: string;
  createdFrom: WorkspaceInstanceCreatedFrom;
  kind?: WorkspaceInstanceKind;
  displayName?: string;
  unavailableRoot?: boolean;
}): WorkspaceInstanceIdentity {
  const kind = options.kind ?? inferWorkspaceInstanceKind(options.root, options.createdFrom);
  assertKindRootInvariant(kind, options.root);
  const displayNameKey = options.root
    ? undefined
    : WORKSPACE_INSTANCE_DISPLAY_NAME_KEYS[kind as "loose" | "placeholder"];
  return {
    workspaceInstanceId: options.workspaceInstanceId,
    kind,
    rootId: options.root?.rootId ?? null,
    rootPath: options.root?.rootPath ?? null,
    displayName: options.displayName ?? workspaceInstanceDisplayName(kind, options.root),
    displayNameKey,
    ownerWindowLabel: options.ownerWindowLabel,
    createdFrom: options.createdFrom,
    activeTabId: null,
    tabIds: [],
    closedTabIds: [],
    unavailableRoot: options.unavailableRoot,
  };
}

/**
 * Enforce the kind/root invariant so illegal instances can't be constructed:
 *   - kind "workspace" REQUIRES a root
 *   - kind "loose" / "placeholder" REQUIRE no root
 * A caller that supplies a contradictory `kind` is a programming error, not
 * user input, so we fail loud at the construction boundary (T216).
 */
function assertKindRootInvariant(
  kind: WorkspaceInstanceKind,
  root: WorkspaceRootIdentity | null,
): void {
  if (kind === "workspace" && !root) {
    throw new Error("createWorkspaceInstance: kind 'workspace' requires a root");
  }
  if (kind !== "workspace" && root) {
    throw new Error(`createWorkspaceInstance: kind '${kind}' must not have a root`);
  }
}

function inferWorkspaceInstanceKind(
  root: WorkspaceRootIdentity | null,
  createdFrom: WorkspaceInstanceCreatedFrom,
): WorkspaceInstanceKind {
  if (root) return "workspace";
  return createdFrom === "placeholder" ? "placeholder" : "loose";
}

function workspaceInstanceDisplayName(
  kind: WorkspaceInstanceKind,
  root: WorkspaceRootIdentity | null,
): string {
  if (root) return root.displayName;
  if (kind === "loose") return "Loose Files";
  return "Untitled";
}

export function disambiguateWorkspaceDisplayNames(
  instances: Array<{
    workspaceInstanceId: string;
    rootId: string | null;
    displayName: string;
  }>
): Record<string, string> {
  const seen = new Map<string, number>();
  const result: Record<string, string> = {};
  for (const instance of instances) {
    const count = seen.get(instance.displayName) ?? 0;
    const next = count + 1;
    seen.set(instance.displayName, next);
    result[instance.workspaceInstanceId] =
      count === 0 ? instance.displayName : `${instance.displayName} ${next}`;
  }
  return result;
}

