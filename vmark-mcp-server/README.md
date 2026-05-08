# @vmark/mcp-server

MCP (Model Context Protocol) server for VMark - expose Tiptap editor APIs to AI assistants.

## Installation

```bash
npm install @vmark/mcp-server
# or
pnpm add @vmark/mcp-server
```

## Quick Start

```typescript
import { WebSocketBridge, VMarkMcpServer, createVMarkMcpServer } from '@vmark/mcp-server';

// Create bridge connection to VMark
const bridge = new WebSocketBridge({
  host: 'localhost',
  port: 9224,
});

// Connect to VMark
await bridge.connect();

// Create server with all tools registered
const server = createVMarkMcpServer(bridge);

// Or create server manually for custom tool registration
const customServer = new VMarkMcpServer({ bridge });
```

## Configuration

### WebSocketBridge Options

```typescript
interface WebSocketBridgeConfig {
  host?: string;              // Default: 'localhost'
  port?: number;              // Default: 9224
  timeout?: number;           // Request timeout in ms (default: 10000)
  autoReconnect?: boolean;    // Auto-reconnect on disconnect (default: true)
  maxReconnectAttempts?: number; // Max reconnect attempts (default: 10)
  reconnectDelay?: number;    // Base reconnect delay in ms (default: 1000)
  maxReconnectDelay?: number; // Max reconnect delay in ms (default: 30000)
  logger?: Logger;            // Optional custom logger
  maxRequestsPerSecond?: number; // Rate limit (default: 100, 0 = unlimited)
  queueWhileDisconnected?: boolean; // Queue requests during reconnection (default: false)
  maxQueueSize?: number;      // Max queued requests (default: 100)
}
```

### Custom Logger

```typescript
const bridge = new WebSocketBridge({
  logger: {
    debug: (msg, ...args) => console.debug(`[MCP] ${msg}`, ...args),
    info: (msg, ...args) => console.info(`[MCP] ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[MCP] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[MCP] ${msg}`, ...args),
  },
});
```

## Available Tools

The server exposes a pruned 5-tool surface — `session`, `workspace`, `document`,
`workflow`, `selection`. Each tool has an `action` discriminator that routes to
its sub-operations. See `dev-docs/plans/20260504-mcp-pruning.md` for the
rationale behind the prune and ADR-7 for why `selection` was re-added.

### `session` — orientation (1 action)

| Action | Purpose |
|---|---|
| `get_state` | One-shot discovery: returns `{windows, capabilities}` with every open tab's `{id, filePath, title, dirty, revision, kind}`. Replaces the legacy `get_capabilities`/`tabs.list`/`workspace.get_focused`/`workspace.list_windows`/`workspace.get_document_info` chain. |

### `workspace` — file and window lifecycle (7 actions)

| Action | Purpose |
|---|---|
| `new` | Create a new document (markdown or workflow). |
| `open` | Open a file from disk. |
| `save` | Save the current document. |
| `save_as` | Save to a new path. |
| `close` | Close a tab. |
| `switch_tab` | Activate a tab in its window. |
| `focus_window` | Bring a window to focus. |

### `document` — read/write spine (3 actions)

| Action | Purpose |
|---|---|
| `read` | Returns `{content, revision, filePath, kind, dirty}` for a tab. Always read before writing — pass `revision` back into `write`. |
| `write` | Replace full document content. Optimistic concurrency via `expected_revision`; mismatch returns `STALE` with `current_revision`. |
| `transform` | Apply a deterministic CJK rewriter — `cjk-format`, `cjk-spacing`, or `cjk-punctuation`. |

### `workflow` — GitHub Actions YAML (2 actions)

| Action | Purpose |
|---|---|
| `apply_patch` | CST-safe patch application via the `IRPatch` discriminated union — preserves comments and anchors that a raw rewrite would lose. |
| `validate` | Run actionlint and return diagnostics. |

### `selection` — targeted edits on the user's selection (2 actions)

| Action | Purpose |
|---|---|
| `get` | Returns `{text, isEmpty, range, mode, kind, tabId, revision}` for the current selection. `text` is the markdown serialization (WYSIWYG) or raw text (source). `mode` is `"wysiwyg"` or `"source"` — `range.{from,to}` lives in PM positions or character offsets respectively. |
| `set` | Replace the current selection. Args: `{tabId?, content, expected_revision?}`. **WYSIWYG mode**: plain inline text round-trips exactly; markdown structure is parsed and inserted as nodes. **Source mode**: `content` is always spliced as raw text. STALE on revision mismatch. |

`selection` exists so AI agents can edit large documents without paying the
full-doc round-trip required by `document.read`/`document.write` — input
tokens for the whole doc, output tokens for the whole doc, a long write
window that widens the stale-revision retry loop, and a faithfulness risk
on the bytes the AI didn't change.

## Available Resources

The pruned surface exposes no MCP resources. All discovery flows through
`session.get_state`.

## Multi-Window Support

All tools support an optional `windowId` parameter:

```typescript
// Target specific window
await server.callTool('document_get_content', { windowId: 'editor-1' });

// Target focused window (default)
await server.callTool('document_get_content', { windowId: 'focused' });
await server.callTool('document_get_content', {}); // Same as above
```

## Connection Events

```typescript
const unsubscribe = bridge.onConnectionChange((connected) => {
  if (connected) {
    console.log('Connected to VMark');
  } else {
    console.log('Disconnected from VMark');
  }
});

// Later: unsubscribe()
```

## Rate Limiting

The bridge includes built-in rate limiting to prevent overwhelming VMark:

```typescript
const bridge = new WebSocketBridge({
  maxRequestsPerSecond: 50, // Limit to 50 requests/second
});
```

Set to `0` for unlimited requests. Exceeding the rate limit throws `Error: Rate limit exceeded`.

## Request Queueing

Enable request queueing to buffer requests during temporary disconnections:

```typescript
const bridge = new WebSocketBridge({
  autoReconnect: true,
  queueWhileDisconnected: true,
  maxQueueSize: 50,
});
```

Queued requests are automatically sent when the connection is restored. If the queue fills, new requests throw `Error: Request queue full`.

## Error Handling

```typescript
try {
  await bridge.connect();
} catch (error) {
  console.error('Failed to connect:', error.message);
}

const result = await server.callTool('document_get_content', {});
if (!result.success) {
  console.error('Tool error:', result.content[0].text);
}
```

## Requirements

- Node.js >= 18
- VMark running with MCP bridge enabled

## License

MIT
