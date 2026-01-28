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
  timeout?: number;           // Request timeout in ms (default: 30000)
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

### Document Tools
- `document_get_content` - Get full document content
- `document_set_content` - Replace entire document
- `document_insert_at_cursor` - Insert text at cursor
- `document_insert_at_position` - Insert text at specific position
- `document_search` - Search for text in document
- `document_replace` - Find and replace text

### Selection Tools
- `selection_get` - Get current selection
- `selection_set` - Set selection range
- `selection_replace` - Replace selected text
- `selection_delete` - Delete selected text
- `cursor_get_context` - Get surrounding context
- `cursor_set_position` - Move cursor

### Editor Tools
- `editor_undo` - Undo last action
- `editor_redo` - Redo last action
- `editor_focus` - Focus the editor

### Formatting Tools
- `format_toggle` - Toggle bold/italic/code/strike/underline
- `format_set_link` - Create hyperlink
- `format_remove_link` - Remove hyperlink
- `format_clear` - Clear all formatting

### Block Tools
- `block_set_type` - Set block type (paragraph, heading, code, etc.)
- `block_toggle` - Toggle block type
- `block_insert_horizontal_rule` - Insert horizontal rule

### List Tools
- `list_toggle` - Toggle list type (bullet, ordered, task)
- `list_indent` - Increase list indentation
- `list_outdent` - Decrease list indentation

### Table Tools
- `table_insert` - Insert new table
- `table_delete` - Delete table
- `table_add_row` - Add row before/after
- `table_delete_row` - Delete current row
- `table_add_column` - Add column before/after
- `table_delete_column` - Delete current column
- `table_toggle_header_row` - Toggle header row

### VMark Tools
- `insert_math_inline` - Insert inline LaTeX math
- `insert_math_block` - Insert block LaTeX math
- `insert_mermaid` - Insert Mermaid diagram
- `insert_wiki_link` - Insert wiki-style link
- `cjk_punctuation_convert` - Convert CJK punctuation
- `cjk_spacing_fix` - Fix CJK-Latin spacing

### Workspace Tools
- `workspace_list_windows` - List all windows
- `workspace_get_focused` - Get focused window
- `workspace_focus_window` - Focus specific window
- `workspace_new_document` - Create new document
- `workspace_open_document` - Open document from path
- `workspace_save_document` - Save current document
- `workspace_close_window` - Close window

## Available Resources

- `vmark://document/outline` - Document heading hierarchy
- `vmark://document/metadata` - Document metadata (path, title, word count)
- `vmark://windows/list` - List of AI-exposed windows
- `vmark://windows/focused` - Currently focused window label

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
