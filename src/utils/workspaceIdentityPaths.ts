/**
 * Workspace Identity — Path Normalization
 *
 * Purpose: Pure platform-aware path normalization and display-name derivation
 * for workspace identities. Split out of workspaceIdentity.ts to keep each
 * module under the file-size limit.
 *
 * Key decisions:
 *   - POSIX paths keep surrounding spaces (path segments may contain them)
 *   - Windows paths normalize separators, drive-letter case, and UNC prefixes
 *   - Pure functions — no filesystem access
 *
 * @coordinates-with workspaceIdentity.ts — consumes these helpers
 * @module utils/workspaceIdentityPaths
 */

export type WorkspacePlatform = "macos" | "windows" | "linux";

export interface WorkspacePathIdentity {
  normalizedPath: string;
  platformIdentity: string;
}

export function normalizeWorkspacePathForIdentity(
  rawPath: string,
  platform: WorkspacePlatform
): WorkspacePathIdentity {
  // Do NOT trim: POSIX/macOS path segments may legitimately contain leading or
  // trailing spaces, and trimming would collide distinct workspaces (e.g.
  // "/Users/me/Repo" vs "/Users/me/Repo "). Blank validation happens in
  // createWorkspaceRootIdentity, which is the only caller that rejects emptiness.
  const input = rawPath;
  if (platform === "windows") {
    const usesUnc = input.replace(/\//g, "\\").startsWith("\\\\");
    let normalizedPath = input.replace(/\//g, "\\").replace(/\\+/g, "\\");
    if (usesUnc && !normalizedPath.startsWith("\\\\")) {
      normalizedPath = `\\${normalizedPath}`;
    }
    normalizedPath = normalizedPath.replace(/^([a-zA-Z]):/, (_, drive: string) =>
      `${drive.toUpperCase()}:`
    );
    normalizedPath = stripTrailingWindowsSeparator(normalizedPath);
    return {
      normalizedPath,
      platformIdentity: normalizedPath.toLocaleLowerCase("en-US"),
    };
  }

  const normalizedPath = stripTrailingPosixSeparator(input.replace(/\/+/g, "/"));
  return { normalizedPath, platformIdentity: normalizedPath };
}

export function deriveWorkspaceDisplayName(path: string, platform: WorkspacePlatform): string {
  if (platform === "windows") {
    if (/^[A-Z]:\\$/i.test(path)) return path;
    const parts = path.split("\\").filter(Boolean);
    return parts.at(-1) ?? path;
  }
  if (path === "/") return path;
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function stripTrailingPosixSeparator(path: string): string {
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}

function stripTrailingWindowsSeparator(path: string): string {
  if (/^[A-Z]:\\?$/i.test(path)) return path.endsWith("\\") ? path : `${path}\\`;
  return path.replace(/\\+$/, "");
}
