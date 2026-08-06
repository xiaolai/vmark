/**
 * Purpose: helpers every breakdown service shares — error narrowing and workspace-relative path resolution.
 *
 * Its own module rather than an export from breakdownService.ts: that file
 * re-exports the split services, so importing back from it would make the cycle
 * real.
 *
 * @coordinates-with src/services/breakdown/breakdownService.ts — re-exports these
 * @module services/breakdown/breakdownShared
 */


export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Join a workspace-relative path onto the workspace root. Pure — no
 * platform path module: Tauri accepts forward slashes on every platform,
 * so only a trailing separator on the root needs normalizing.
 */
export function resolveWorkspacePath(workspaceRoot: string, relative: string): string | null {
  // Ledger data crosses a trust boundary (audit T13): refuse traversal
  // segments, absolute paths, and backslashes before opening anything.
  if (relative.length === 0 || relative.startsWith("/") || relative.includes("\\")) return null;
  const segments = relative.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return `${workspaceRoot.replace(/[/\\]+$/, "")}/${relative}`;
}

/** Mirror of the Rust `ResolveRequest` (WI-1.9a). */
export interface ResolveEdgeRequest {
  action: "accept-newer" | "waive";
  txf: string;
  input: number;
  reason?: string;
  /** D3.2: optional waiver expiry (RFC 3339). */
  expires?: string;
}
