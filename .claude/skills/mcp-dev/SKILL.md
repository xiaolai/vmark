---
name: mcp-dev
description: Build or change VMark's MCP integration - the server/mcp sidecar's tools and schemas, the Rust bridge, the frontend bridge handlers - or register, remove and verify MCP servers in this project's configuration. Use when adding or changing an MCP tool, connecting an MCP server, or updating MCP docs.
---

# MCP Dev (VMark)

## Where things live

| Layer | Path |
|---|---|
| Sidecar (npm package, stdio MCP server, tool definitions) | `server/mcp/` — tools in `server/mcp/src/tools/` |
| Payload schemas (single source) | `server/mcp/src/bridge/operationSchemas.ts` |
| Rust bridge and client config | `src-tauri/src/mcp_bridge/` (`control.rs` is the entry), `src-tauri/src/mcp_config/` |
| Frontend bridge | `src/services/mcpBridge/` — `handleRequest.ts` → `v2/dispatch.ts` |
| Docs | `website/guide/mcp-tools.md`, `website/guide/mcp-setup.md`, `server/mcp/README.md` |

## Changing a tool

1. Edit the zod schema in `operationSchemas.ts`, then `pnpm gen:mcp-contracts`
   and commit the generated files (`pnpm lint:mcp-contracts` fails on stale or
   hand-edited output).
2. Handlers follow `.claude/rules/50-codebase-conventions.md` §4:
   `wrapHandler(id, async () => …)`, `respond()` on success,
   `structuredError()` for validation, `readOperationArgs()` for payloads.
3. Update the docs in the same change (`.claude/rules/21-website-docs.md`).
4. After sidecar changes: `pnpm --dir server/mcp build:sidecar`, reconfigure
   the client, restart it. E2E for AI features goes through VMark MCP only
   (`tauri-mcp-testing` skill).

## Registering an MCP server

- Project scope: edit `.mcp.json`. It registers exactly one server, `tauri`
  (`npx -y @hypothesi/tauri-mcp-server`), for driving a debug build. Never add
  Chrome DevTools MCP — VMark is a Tauri app.
- User scope: `claude mcp add <name> -- <command> <args…>` (add
  `-e KEY=VALUE` for env), `claude mcp remove <name>`; verify with
  `claude mcp list`.
- A `url` key means an HTTP server, `command`/`args` a stdio one. Servers load
  at session start, so the user must restart the session to pick one up.
- Never commit credentials into `.mcp.json`; a VMark MCP client authenticates
  with its per-client `VMARK_MCP_TOKEN`.
