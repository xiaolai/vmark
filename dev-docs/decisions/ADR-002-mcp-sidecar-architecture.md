# ADR-002: MCP Sidecar Architecture

> Status: **Accepted** | Date: 2025-12-15

## Context

VMark needed to expose editor capabilities to external AI clients (Claude
Desktop, Cursor, etc.) via the Model Context Protocol (MCP). MCP servers are
typically long-running Node.js processes that communicate over stdio. Tauri apps
run a Rust backend — embedding a Node.js MCP server inside the Rust process was
not feasible without a JS runtime dependency.

## Considered Options

1. **Embedded MCP in Rust** — implement the MCP protocol directly in Rust.
2. **Node.js sidecar** — run a separate Node.js process that bridges MCP stdio
   to the Tauri backend via WebSocket.
3. **HTTP API** — expose a REST/GraphQL API from the Tauri backend, let AI
   clients call it directly.

## Decision

Chosen: **Node.js sidecar** (`vmark-mcp-server/`), because MCP's ecosystem is
JavaScript-first and a sidecar cleanly separates concerns.

Architecture:

- The MCP sidecar (`vmark-mcp-server`) handles stdio transport and tool
  registration per the MCP spec.
- A WebSocket bridge connects the sidecar to the Tauri backend
  (`mcp_bridge.rs`), which manages port discovery and connection lifecycle.
- Read operations execute concurrently; write operations are serialized via a
  write lock to prevent race conditions.
- Port discovery uses a file in Tauri's app data directory — the sidecar reads
  this file to find the WebSocket endpoint.

## Consequences

- Good: Full MCP spec compliance with the official `@modelcontextprotocol/sdk`.
- Good: Sidecar can be developed, tested, and versioned independently of the
  Rust backend.
- Good: No Node.js runtime dependency in the main app — the sidecar is bundled
  as a Tauri sidecar binary.
- Bad: Extra process to manage — startup ordering, health checks, and zombie
  process cleanup (`mcp-troubleshooting.md`).
- Bad: WebSocket adds a network hop for every tool call. Mitigated by localhost
  communication (sub-millisecond latency).
