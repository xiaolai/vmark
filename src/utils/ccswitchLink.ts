/**
 * CC-Switch deep-link builder (issue #1008; wire format corrected in #1361).
 *
 * Builds a `ccswitch://v1/import` deep link that one-click-imports VMark's
 * MCP server into CC-Switch (the cross-CLI config manager). VMark is an MCP
 * server exposed via the sidecar binary; CC-Switch writes the resulting
 * `mcpServers.vmark` entry into whichever AI CLIs the user lists in `apps`.
 *
 * Format (CC-Switch v1):
 *   ccswitch://v1/import?resource=mcp&name=vmark&apps=<csv>&config=<urlenc base64 JSON>
 *
 * Pure (no Tauri/stores) — leaf util per ADR-013. The caller opens the link
 * via the OS opener.
 *
 * ## `config` is Base64, and it carries an `mcpServers` map (#1361)
 *
 * The first version sent URL-encoded raw JSON of a bare `{command}`, which
 * CC-Switch rejects on the user's screen with
 * `config 参数 Base64 解码失败：Invalid symbol 123, offset 0` — 123 is `{`,
 * the payload's own first byte. Two independent mistakes, both read off
 * CC-Switch's source rather than its prose docs, whose MCP example is stale:
 *
 * 1. `deeplink/mcp.rs` calls `decode_base64_param("config", …)` **before**
 *    parsing JSON, so the payload must be Base64.
 * 2. `import_mcp_from_deeplink` then requires `config.mcpServers` to be an
 *    object and takes each KEY as the server id. A bare `{command}` would
 *    import zero servers even with the Base64 fixed, and `name=vmark` cannot
 *    stand in — the MCP branch of `parse_mcp_deeplink` discards `name`.
 *
 * Standard Base64 plus `encodeURIComponent` is what CC-Switch's own generator
 * (`deplink.html`) emits, so it is the spelling every version that works with
 * that generator accepts. The escaping is load-bearing rather than cosmetic:
 * CC-Switch reads the query with `url::Url::query_pairs()`, which is
 * form-urlencoded, so a bare `+` would arrive as a SPACE.
 *
 * @module utils/ccswitchLink
 */

/**
 * The id VMark's MCP entry takes in every client config, CC-Switch included.
 *
 * Matching `mcp_config`'s `mcpServers.vmark` is what makes a re-import merge
 * onto the existing entry (CC-Switch looks the id up in its own store) instead
 * of leaving a second, differently-named copy behind.
 */
const SERVER_ID = "vmark";

/**
 * AI CLIs CC-Switch can sync VMark's MCP entry into, by default.
 *
 * These are **CC-Switch's** app ids, not VMark's provider ids, and its parser
 * rejects the whole link if any one of them is unknown — so this list may only
 * contain ids CC-Switch accepts: `claude`, `codex`, `gemini`, `grokbuild`,
 * `grok`, `opencode`, `openclaw`, `hermes`. In particular **Antigravity is not
 * one of them**, so VMark's own `antigravity` provider has no counterpart here;
 * it is installed through the panel's own Install button instead.
 *
 * `gemini` is deliberately absent: Gemini CLI is discontinued (see the legacy
 * provider in `providers.rs`), and a default hand-off should not write a fresh
 * entry into a tool VMark is retiring.
 */
const DEFAULT_APPS = ["claude", "codex", "grok", "opencode"];

/**
 * Standard Base64 of a string's UTF-8 bytes.
 *
 * `btoa` alone throws `InvalidCharacterError` on any codepoint above U+00FF,
 * so a home directory such as `/Users/张三` would break the button rather than
 * the import. Encoding to bytes first is the same two-step CC-Switch's own
 * generator uses, and it is what its Rust side decodes back to UTF-8.
 */
function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Build a CC-Switch import deep link for VMark's MCP server.
 *
 * @param binaryPath Absolute path to the `vmark-mcp-server` sidecar binary
 *   (this is machine-specific, so the link is for the user's own machine,
 *   not for sharing across machines).
 * @param apps CC-Switch app ids to import into (default: see `DEFAULT_APPS`).
 */
export function buildCcSwitchImportLink(
  binaryPath: string,
  apps: string[] = DEFAULT_APPS,
): string {
  const config = encodeURIComponent(
    base64Utf8(JSON.stringify({ mcpServers: { [SERVER_ID]: { command: binaryPath } } })),
  );
  // CC-Switch's documented example keeps `apps` commas literal; only the
  // Base64 config needs escaping.
  return `ccswitch://v1/import?resource=mcp&name=${SERVER_ID}&apps=${apps.join(",")}&config=${config}`;
}
