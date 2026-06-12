/**
 * CC-Switch deep-link builder (issue #1008).
 *
 * Builds a `ccswitch://v1/import` deep link that one-click-imports VMark's
 * MCP server into CC-Switch (the cross-CLI config manager). VMark is an MCP
 * server exposed via the sidecar binary; CC-Switch writes the resulting
 * `mcpServers.vmark` entry into whichever AI CLIs the user lists in `apps`.
 *
 * Format (CC-Switch v1):
 *   ccswitch://v1/import?resource=mcp&name=vmark&apps=<csv>&config=<urlenc JSON>
 *
 * Pure (no Tauri/stores) — leaf util per ADR-013. The caller opens the link
 * via the OS opener.
 *
 * @module utils/ccswitchLink
 */

/** AI CLIs CC-Switch can sync VMark's MCP entry into, by default. */
const DEFAULT_APPS = ["claude", "codex", "gemini"];

/**
 * Build a CC-Switch import deep link for VMark's MCP server.
 *
 * @param binaryPath Absolute path to the `vmark-mcp-server` sidecar binary
 *   (this is machine-specific, so the link is for the user's own machine,
 *   not for sharing across machines).
 * @param apps CC-Switch app ids to import into (default: claude, codex, gemini).
 */
export function buildCcSwitchImportLink(
  binaryPath: string,
  apps: string[] = DEFAULT_APPS,
): string {
  // CC-Switch's documented example keeps `apps` commas literal and
  // URL-encodes only the config JSON.
  const config = encodeURIComponent(JSON.stringify({ command: binaryPath }));
  return `ccswitch://v1/import?resource=mcp&name=vmark&apps=${apps.join(",")}&config=${config}`;
}
