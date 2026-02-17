---
name: mcp-server-manager
description: Discover, register, and verify MCP servers. Use when a user asks to connect/add/install/remove an MCP server, or when you need to manage project MCP configuration.
---

# MCP Server Manager

## Workflow

1) **Discover candidate servers**
   - Check project `.mcp.json` for existing server configs.
   - Check `~/.claude.json` for global MCP servers (Claude Code).
   - Scan for MCP-related packages in `package.json` or `Cargo.toml`.

2) **Choose a registration target**
   - Project-local: edit `.mcp.json` directly.
   - Global (Claude Code): use `claude mcp add` / `claude mcp remove`.

3) **Register the server**
   - stdio server:
     ```bash
     claude mcp add <name> -- <command> <args...>
     ```
   - stdio with env:
     ```bash
     claude mcp add <name> -e KEY=VALUE -- <command> <args...>
     ```
   - Or edit `.mcp.json` directly for project-local config.

4) **Verify registration**
   - For `.mcp.json`: read the file and confirm the entry exists.
   - For global: run `claude mcp list` to verify.

5) **Explain reload requirement**
   - MCP servers are loaded at session start; ask the user to restart the session.

## Notes
- Infer type from config: `url` key = HTTP, `command`/`args` keys = stdio.
- When multiple sources define the same name, confirm which to use.
- For stdio servers using `npx`, the package downloads when the server first runs.

## VMark Example
```json
// .mcp.json
{
  "mcpServers": {
    "tauri": {
      "command": "npx",
      "args": ["-y", "@hypothesi/tauri-mcp-server"]
    }
  }
}
```
