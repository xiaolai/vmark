# MCP Dev Paths

## Config
- `.mcp.json` (project MCP server registrations)
- `.claude/settings.json` (team-shared)
- `.claude/settings.local.json` (personal, gitignored)

## MCP server code (Rust side)
- `src-tauri/src/mcp_bridge/` (bridge handlers)
- `src-tauri/src/mcp_config/` (client config loader)
- `src-tauri/src/mcp_server.rs` (server entry)

## MCP frontend bridge
- `src/hooks/mcpBridge/` (central dispatcher + handlers)

## Standalone sidecar
- `vmark-mcp-server/` (npm package, runs as stdio MCP server)

## Website docs
- `website/guide/mcp-tools.md`
- `website/guide/mcp-setup.md`

## Useful scans
- `rg -n "mcp" src src-tauri`
- `rg -n "#\[tauri::command\]" src-tauri/src/mcp_bridge`
