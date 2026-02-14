/**
 * Workspace Identity Logic
 *
 * Purpose: Pure helpers for generating and validating workspace identities.
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

/**
 * Trust levels for workspaces.
 *
 * - untrusted: Default for new workspaces. Limited capabilities.
 * - trusted: User has explicitly trusted this workspace. May run tasks.
 */
export type WorkspaceTrustLevel = "untrusted" | "trusted";

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
 * Validate that a string looks like a UUID v4.
 *
 * @param value - String to validate
 * @returns true if valid UUID format
 */
export function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
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
