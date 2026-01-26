# Claude Agent SDK Integration Plan

## Overview

Integrate Claude Agent SDK into VMark as a **bidirectional bridge**:

1. **Inbound** (existing): External AI agents control VMark via MCP
2. **Outbound** (new): VMark runs its own Agent SDK for built-in AI features

## Policy & Compliance (Must Read)

Anthropic’s Agent SDK docs include **explicit restrictions for third‑party applications**:

- **No “claude.ai login” in VMark**: Unless explicitly approved, third‑party developers should not offer claude.ai login/rate limits via the Agent SDK; use **API key authentication** instead.
- **Branding**: Avoid “Claude Code” branding in product UI/copy unless approved. Present this as “AI Assistant” (optionally showing “Anthropic / Claude” as the provider).

Implication for this plan:
- Treat “Claude Code subscription auth reuse” as **development-only** (internal testing), not a shipped path.
- Ship **API key / cloud provider** auth paths, and make tool permissions explicit (see “Tool Safety” below).

Sources:
- [Agent SDK Overview (restrictions + branding)](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK Quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart)

## Runtime Strategy

The Agent SDK uses **Claude Code as its runtime** (it invokes the `claude` CLI).

**Decision**: Require global Claude Code installation (not bundled).

**Rationale**:
- Claude Code updates frequently (weekly); bundling would ship stale versions
- Bundling adds ~100MB to VMark's binary size
- Users control their own Claude Code updates
- Avoids version conflicts between bundled and global installs

**User Setup Flow**:
1. User installs Claude Code from https://claude.ai/code
2. User runs `claude` once to authenticate (or sets `ANTHROPIC_API_KEY`)
3. VMark detects `claude` in PATH and enables AI features

## Authentication Strategy

| Auth Method | How It Works | Configuration |
|-------------|--------------|---------------|
| **API Key (recommended)** | User sets in VMark Settings or env var | `ANTHROPIC_API_KEY=sk-ant-...` |
| **Claude Code OAuth** | User runs `claude` to authenticate | Automatic (dev-only, not shipped) |
| **Amazon Bedrock** | AWS credentials + env var | `CLAUDE_CODE_USE_BEDROCK=1` |
| **Google Vertex AI** | GCP credentials + env var | `CLAUDE_CODE_USE_VERTEX=1` |
| **Azure AI Foundry** | Azure credentials + env var | `CLAUDE_CODE_USE_FOUNDRY=1` |

**For VMark**:
- Primary UX: Settings field for API key (stored in OS keychain), injected into sidecar at launch.
- Fallback: read `ANTHROPIC_API_KEY` from environment.
- Cloud providers: rely on user's existing credentials + `CLAUDE_CODE_USE_*` env vars.

Sources:
- [Claude Code Setup](https://code.claude.com/docs/en/setup)
- [Agent SDK Quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart)
- [OAuth Token Restrictions (Jan 2026)](https://github.com/anthropics/claude-code/issues/6536)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              VMark Application                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────┐        ┌─────────────────────────────────┐   │
│   │   INBOUND (existing)    │        │      OUTBOUND (new)             │   │
│   │   Claude Desktop, etc.  │        │      vmark-agent-sdk            │   │
│   │   External AI → VMark   │        │      VMark → Claude API         │   │
│   └───────────┬─────────────┘        └──────────────┬──────────────────┘   │
│               │                                      │                      │
│               │      ┌────────────────────────┐      │                      │
│               └─────►│   vmark-mcp-server     │◄─────┘                      │
│                      │   (shared tool surface) │                            │
│                      │   60+ editor tools      │                            │
│                      └───────────┬────────────┘                             │
│                                  │                                          │
│                                  ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                   WebSocket Bridge (Rust/Tauri)                      │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                         React Frontend                               │  │
│   │  ┌───────────────────────────────────────────┐ ┌─────────────────┐  │  │
│   │  │            Editor Container               │ │  AI Sidebar     │  │  │
│   │  │                                           │ │  (Right Panel)  │  │  │
│   │  │  ┌─────────────────────────────────────┐  │ │ ┌─────────────┐ │  │  │
│   │  │  │  Shortcut → 2-Level Context Menu    │  │ │ │ Session     │ │  │  │
│   │  │  │  ├── Category (from folder)         │  │ │ │ History     │ │  │  │
│   │  │  │  │   └── Commands (from .md files)  │  │ │ ├─────────────┤ │  │  │
│   │  │  └─────────────────────────────────────┘  │ │ │ Chat View   │ │  │  │
│   │  └───────────────────────────────────────────┘ │ │ + Streaming │ │  │  │
│   │                                                 │ └─────────────┘ │  │  │
│   │                                                 └─────────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘

Command Files Location:
  (Resolved via Tauri app data dir; bundle id is `app.vmark`.)
  Example macOS location:
    ~/Library/Application Support/app.vmark/agents/
  ├── writing/
  │   ├── improve.md
  │   ├── proofread.md
  │   └── simplify.md
  ├── translate/
  │   ├── to-chinese.md
  │   ├── to-english.md
  │   └── to-japanese.md
  └── research/
      ├── summarize.md
      └── expand.md
```

---

## Work Items

### Phase 0: Feasibility Spike (Day 1) ✅ COMPLETE

#### WI-0.1: Validate Agent SDK with Global Claude Code ✅
**Priority**: P0
**Estimate**: 4h
**Status**: COMPLETE (2026-01-26)

**Goal**: Prove that `@anthropic-ai/claude-agent-sdk` can run inside a Tauri sidecar (packaged with `pkg`) using a **globally installed** `claude` CLI.

**Results**:
- ✅ Sidecar can locate `claude` in PATH via `which` command
- ✅ SDK query works via `pathToClaudeCodeExecutable` option (crucial discovery!)
- ✅ Streaming works via async generator (`query()` returns `AsyncGenerator<SDKMessage>`)
- ⚠️ Binary size is 45.89MB (includes Node.js runtime) - larger than ideal but acceptable
- ✅ Error handling works (API key errors properly reported)
- ✅ **OAuth fallback works!** When no API key is set, SDK uses Claude Code's OAuth session

**Authentication Discovery**:
- If `ANTHROPIC_API_KEY` is set → SDK uses API key (fails if invalid)
- If no API key → SDK falls back to Claude Code's OAuth token (works with subscriptions!)
- Invalid API key takes precedence and blocks OAuth fallback

**Key Technical Findings**:

1. **`pathToClaudeCodeExecutable` is the critical option** that enables global claude:
   ```typescript
   const session = query({
     prompt,
     options: {
       pathToClaudeCodeExecutable: "/Users/xxx/.local/bin/claude",
     },
   });
   ```

2. **`query()` returns an AsyncGenerator**, not a Promise with result:
   ```typescript
   for await (const message of session) {
     if (message.type === "stream_event") { /* handle streaming */ }
     if (message.type === "result") { /* handle final result */ }
   }
   ```

3. **CommonJS format required for pkg** (ESM causes Babel parse errors)

4. **SDK throws after generator completes** when Claude exits with non-zero code, but we can still capture the result from messages before the throw.

**Files Created**:
- `vmark-agent-sdk/package.json` - Minimal dependencies (Agent SDK + zod v4)
- `vmark-agent-sdk/src/index.ts` - IPC loop with query handling
- `vmark-agent-sdk/scripts/build-sidecar.js` - esbuild + pkg pipeline
- `vmark-agent-sdk/tsconfig.json` - TypeScript config

**Binary Output**:
- `src-tauri/binaries/vmark-agent-sdk-aarch64-apple-darwin` (45.89MB)

---

### Phase 1: Foundation (Week 1)

#### WI-1.1: Create vmark-agent-sdk Package Structure ✅ (Mostly Done in Spike)
**Priority**: P0
**Estimate**: 4h → 2h remaining

Create the new Node.js sidecar package:

```
vmark-agent-sdk/
├── package.json              ✅ Created in spike
├── tsconfig.json             ✅ Created in spike
├── scripts/
│   └── build-sidecar.js      ✅ Created in spike (esbuild + pkg)
├── src/
│   ├── index.ts              ✅ Created in spike (IPC + query handling)
│   ├── agent.ts              ⬜ TODO: Extract agent wrapper
│   ├── mcp.ts                ⬜ TODO: MCP wiring
│   └── types.ts              ⬜ TODO: Type definitions
└── __tests__/
```

**Dependencies** (already installed):
- `@anthropic-ai/claude-agent-sdk` ^0.2.19
- `zod` v4.3.6 (required peer dependency for Agent SDK)

**Note**: `claude` CLI is NOT bundled. User must install Claude Code globally.

**Remaining Work**:
- [ ] Extract agent wrapper to `agent.ts`
- [ ] Add MCP integration to `mcp.ts`
- [ ] Add type definitions to `types.ts`
- [ ] Add tests

**Completed** (from spike):
- [x] Package builds successfully (esbuild → CommonJS)
- [x] TypeScript compiles without errors
- [x] Can import Agent SDK
- [x] Detects if `claude` is available in PATH via `which`
- [x] Binary packages with pkg (45.89MB)

---

#### WI-1.2: Reuse Existing `vmark-mcp-server` Tools (No Duplication)
**Priority**: P0
**Estimate**: 6h

Instead of re-implementing “editor tools” twice, the Agent SDK session should use the already-tested `vmark-mcp-server` MCP tool surface.

**Approach**:
1. Ensure VMark’s **bridge** is running (VMark already writes the port to `~/.vmark/mcp-port`).
2. Register an MCP server in the Agent SDK that runs `vmark-mcp-server` (stdio).
3. Restrict tools per command/agent (default deny; allow only what’s needed).

**Acceptance Criteria**:
- [ ] Agent sidecar can run a query that calls `mcp__vmark__document_get_content`
- [ ] Tool calls reach the running VMark bridge (via `~/.vmark/mcp-port`)
- [ ] Tool allowlist is enforced (disallowed tools are blocked)

Example:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

await query({
  prompt,
  options: {
    mcpServers: {
      vmark: {
        command: process.env.VMARK_MCP_SERVER_PATH ?? "vmark-mcp-server",
        args: [],
      },
    },
    allowedTools: [
      "mcp__vmark__document_get_content",
      "mcp__vmark__selection_get",
      "mcp__vmark__selection_replace",
      "mcp__vmark__document_insert_at_cursor",
    ],
    permissionMode: "default",
  },
});
```

---

#### WI-1.3: Implement API Key Storage
**Priority**: P0
**Estimate**: 4h

Store API key securely using OS keychain services.

**Implementation**:
- Use `tauri-plugin-store` with encryption OR native keychain via Rust (`keyring` crate)
- Settings UI field for API key entry (see WI-3.4)
- Key injected as `ANTHROPIC_API_KEY` env var when launching sidecar

**Tauri Commands** (`src-tauri/src/api_key.rs`):
```rust
#[tauri::command]
pub async fn set_api_key(key: String) -> Result<(), String>

#[tauri::command]
pub async fn get_api_key() -> Result<Option<String>, String>

#[tauri::command]
pub async fn clear_api_key() -> Result<(), String>

#[tauri::command]
pub async fn test_api_key() -> Result<bool, String>
```

**Security Requirements**:
- Key never written to disk in plaintext
- Key not logged or exposed in error messages
- Memory cleared after use where possible

**Acceptance Criteria**:
- [ ] API key persists across app restarts
- [ ] Key stored in OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- [ ] `test_api_key` validates key with a minimal API call
- [ ] Key available to sidecar via environment variable

---

### Phase 2: Tauri Integration (Week 1-2)

#### WI-2.1: Add Agent Sidecar Manager to Rust Backend
**Priority**: P0
**Estimate**: 6h

Create `src-tauri/src/agent_sidecar.rs`:

```rust
// Tauri commands
#[tauri::command]
pub async fn agent_start(app: AppHandle, state: State<AgentState>) -> Result<(), String>

#[tauri::command]
pub async fn agent_stop(state: State<AgentState>) -> Result<(), String>

#[tauri::command]
pub async fn agent_query(
    app: AppHandle,
    state: State<AgentState>,
    request: AgentRequest
) -> Result<(), String>

#[tauri::command]
pub async fn agent_status(state: State<AgentState>) -> Result<AgentStatus, String>
```

**Acceptance Criteria**:
- [ ] Can start/stop sidecar process
- [ ] IPC via stdin/stdout JSON lines
- [ ] Emits events for responses: `agent:response`
- [ ] Handles sidecar crash gracefully

---

#### WI-2.2: Build Sidecar Binary
**Priority**: P0
**Estimate**: 4h

Extend build system for multi-platform binaries:

```javascript
// vmark-agent-sdk/scripts/build-sidecar.js
// Similar to vmark-mcp-server build:
// 1. esbuild → bundle TypeScript
// 2. pkg → create platform binaries
```

**Platforms**:
- `vmark-agent-sdk-aarch64-apple-darwin`
- `vmark-agent-sdk-x86_64-apple-darwin`
- `vmark-agent-sdk-x86_64-pc-windows-msvc.exe`
- `vmark-agent-sdk-x86_64-unknown-linux-gnu`

**Acceptance Criteria**:
- [ ] Builds for all platforms
- [ ] Binaries placed in `src-tauri/binaries/`
- [ ] Added to `tauri.conf.json` externalBin

---

#### WI-2.3: Implement Agent Core Logic
**Priority**: P0
**Estimate**: 8h

Main agent runner in `vmark-agent-sdk/src/agent.ts`:

```typescript
export async function runAgent(
  request: AgentRequest,
  onMessage: (msg: AgentResponse) => void
): Promise<void> {
  // 1. Connect to VMark bridge
  // 2. Build prompt from request type
  // 3. Run Agent SDK query()
  // 4. Stream responses via callback
  // 5. Handle completion/errors
}
```

**Features**:
- Built-in request types: improve, translate, summarize, expand, custom
- Session management for multi-turn
- Streaming partial responses
- Graceful error handling

**Acceptance Criteria**:
- [ ] Handles all built-in request types
- [ ] Streams partial content
- [ ] Reports completion/errors
- [ ] Manages sessions

---

### Phase 3: Frontend Integration (Week 2)

#### WI-3.1: Create useAIAgent Hook
**Priority**: P0
**Estimate**: 6h

```typescript
// src/hooks/useAIAgent.ts
export function useAIAgent() {
  return {
    isProcessing: boolean,
    partialContent: string,
    error: string | null,

    // Actions
    improveWriting: (style?: Style) => Promise<void>,
    translate: (language: string) => Promise<void>,
    summarize: (length?: Length) => Promise<void>,
    expand: () => Promise<void>,
    customPrompt: (prompt: string) => Promise<void>,

    // Control
    cancel: () => Promise<void>,
  };
}
```

**Acceptance Criteria**:
- [ ] Listens for `agent:response` events
- [ ] Manages processing state
- [ ] Accumulates partial content
- [ ] Supports cancellation

---

#### WI-3.2: Implement AI Context Menu (Shortcut-Triggered)
**Priority**: P1
**Estimate**: 6h

**Design**: A single shortcut opens a 2-level context menu populated from markdown command files.

**Shortcut** (`src/stores/shortcutsStore.ts`):
```typescript
{ id: "aiMenu", label: "AI Commands", category: "ai", defaultKey: "Mod-Shift-a" },
```

**Context Menu Component** (`src/components/Editor/AIContextMenu/`):
```typescript
// AIContextMenu.tsx
interface CommandCategory {
  name: string;       // folder name (e.g., "writing")
  label: string;      // display name (e.g., "Writing")
  commands: Command[];
}

interface Command {
  id: string;         // filename without .md
  label: string;      // from frontmatter or filename
  description: string;// from frontmatter
  path: string;       // full path to .md file
}

// Menu structure:
// ├── Writing
// │   ├── Improve
// │   ├── Proofread
// │   └── Simplify
// ├── Translate
// │   ├── To Chinese
// │   ├── To English
// │   └── To Japanese
// └── Research
//     ├── Summarize
//     └── Expand
```

**Positioning**: Menu appears at cursor position (similar to existing popups).

**Files to create**:
- `src/components/Editor/AIContextMenu/AIContextMenu.tsx`
- `src/components/Editor/AIContextMenu/AIContextMenu.css`
- `src/components/Editor/AIContextMenu/index.ts`

**Files to update** (per rule 41):
- `src/stores/shortcutsStore.ts`
- `website/guide/shortcuts.md`

**Acceptance Criteria**:
- [ ] Shortcut opens 2-level context menu
- [ ] Menu populated from command files in Application Support
- [ ] Menu appears at cursor/selection position
- [ ] Selecting command triggers agent execution
- [ ] Documentation updated

---

#### WI-3.3: Add AI Status Indicator
**Priority**: P2
**Estimate**: 3h

Show AI processing status in StatusBar or dedicated indicator:

- Spinner during processing
- Partial content preview (optional)
- Cancel button
- Error display

**Acceptance Criteria**:
- [ ] Visual feedback during AI operations
- [ ] User can cancel in-progress requests

---

#### WI-3.4: Add AI Settings Section
**Priority**: P1
**Estimate**: 6h

Add AI configuration to the Settings dialog, including Claude Code detection.

**UI Layout** (in Settings → AI Assistant):
```
┌─────────────────────────────────────────────────────┐
│  AI Assistant                                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Claude Code:  ✓ Installed (v2.1.19)     [Check]   │
│                                                     │
│  ─── OR if not installed: ───────────────────────  │
│                                                     │
│  Claude Code:  ⚠ Not found                         │
│                                                     │
│  VMark's AI features require Claude Code.          │
│  1. Install from: https://claude.ai/code           │
│  2. Run `claude` once to authenticate              │
│  3. Click [Check] to verify                        │
│                                                     │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  Provider:  [Anthropic API ▼]                       │
│             (Anthropic API / Amazon Bedrock /       │
│              Google Vertex / Azure Foundry)         │
│                                                     │
│  API Key:   [•••••••••••••••••••] [Test] [Clear]   │
│             ✓ Connected (or ⚠ Not configured)       │
│                                                     │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  Commands Folder:                                   │
│  ~/Library/Application Support/app.vmark/agents/   │
│                                            [Open]   │
│                                                     │
│  [ ] Auto-approve AI edits (skip suggestion mode)  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Features**:
1. **Claude Code detection**: Check if `claude` is in PATH, show version
2. **Setup instructions**: If not found, guide user to install
3. **Provider dropdown**: Select auth method (shows relevant fields)
4. **API Key field**: Password-masked input with Test/Clear buttons
5. **Status indicator**: Shows connection state
6. **Commands folder**: Path display with "Open in Finder" button
7. **Auto-approve toggle**: Skip suggestion mode for power users (default: off)

**Tauri Commands** (`src-tauri/src/claude_detection.rs`):
```rust
#[tauri::command]
pub async fn detect_claude_code() -> Result<ClaudeCodeStatus, String> {
    // Check PATH for `claude`, return version if found
}

pub struct ClaudeCodeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}
```

**Files to create/modify**:
- `src-tauri/src/claude_detection.rs` - Claude Code detection
- `src/components/Settings/AISettings.tsx`
- `src/components/Settings/AISettings.css`
- Update Settings dialog to include AI section

**Acceptance Criteria**:
- [ ] Detects if Claude Code is installed (checks PATH)
- [ ] Shows version number when found
- [ ] Shows setup instructions when not found
- [ ] API key can be entered, tested, and cleared
- [ ] Provider selection works (Anthropic, Bedrock, Vertex, Foundry)
- [ ] Status shows "Connected" after successful test
- [ ] "Open" button reveals commands folder in file manager
- [ ] Auto-approve setting persists and is respected by agent

---

### Phase 4: Subagents (Week 2-3)

#### WI-4.1: Implement Built-in Subagents
**Priority**: P1
**Estimate**: 6h

Create specialized agent definitions:

```typescript
// vmark-agent-sdk/src/subagents/index.ts
export const builtInAgents: Record<string, AgentDefinition> = {
  "writing-improver": {
    description: "Expert writing improvement specialist...",
    prompt: "You are an expert writing assistant...",
    tools: ["mcp__vmark__selection_get", "mcp__vmark__selection_replace"],
    model: "sonnet"
  },
  "translator": {
    description: "Translation specialist...",
    prompt: "You are a professional translator...",
    tools: ["mcp__vmark__selection_get", "mcp__vmark__selection_replace"],
    model: "sonnet"
  },
  "researcher": {
    description: "Web research specialist...",
    prompt: "You are a research assistant...",
    tools: ["WebSearch", "WebFetch", "mcp__vmark__document_insert_at_cursor"],
    model: "sonnet"
  },
  "summarizer": {
    description: "Summarization specialist...",
    prompt: "You create concise summaries...",
    tools: ["mcp__vmark__selection_get", "mcp__vmark__document_insert_at_cursor"],
    model: "haiku"  // Faster for summaries
  },
};
```

**Acceptance Criteria**:
- [ ] Each built-in agent has clear description
- [ ] Appropriate tool restrictions
- [ ] Model selection based on task

---

#### WI-4.2: Implement Command File System
**Priority**: P1
**Estimate**: 8h

Users create AI commands as markdown files organized in folders (categories).

**Location**:
- Resolve via Tauri `appDataDir()` / `tauri::path::app_data_dir()` (bundle id: `app.vmark`).
- Example paths:
  - macOS: `~/Library/Application Support/app.vmark/agents/`
  - Linux: `~/.config/app.vmark/agents/`
  - Windows: `%APPDATA%\\app.vmark\\agents\\`

**Folder Structure** (2-level hierarchy):
```
agents/
├── writing/                    # Category folder → menu level 1
│   ├── improve.md              # Command file → menu level 2
│   ├── proofread.md
│   └── simplify.md
├── translate/
│   ├── to-chinese.md
│   ├── to-english.md
│   └── to-japanese.md
└── research/
    ├── summarize.md
    └── expand.md
```

**Command File Format** (markdown with frontmatter):
```markdown
---
label: Improve Writing
description: Enhance clarity and flow while preserving voice
model: sonnet
tools:
  - mcp__vmark__selection_get
  - mcp__vmark__selection_replace
---

You are an expert writing assistant. When improving text:
1. Enhance clarity and readability
2. Improve flow and transitions
3. Fix grammar and punctuation
4. Preserve the author's voice and intent

Always explain what you changed and why.
```

**Frontmatter Fields**:
| Field | Required | Description |
|-------|----------|-------------|
| `label` | No | Display name (defaults to filename titlecased) |
| `description` | No | Short description shown in menu tooltip |
| `model` | No | `sonnet`, `haiku`, `opus` (default: `sonnet`) |
| `tools` | No | List of allowed MCP tools (default: all vmark tools) |

**Implementation**:
1. Tauri command to list categories and commands
2. File watcher for hot-reload when files change
3. Frontmatter parser (gray-matter)
4. Category labels from folder names (titlecased)

**Tauri Commands** (`src-tauri/src/agent_commands.rs`):
```rust
#[tauri::command]
pub async fn list_agent_commands(app: AppHandle) -> Result<Vec<CommandCategory>, String>

#[tauri::command]
pub async fn read_agent_command(app: AppHandle, path: String) -> Result<AgentCommand, String>
```

**Bundled Defaults**:
- Store default command files in `src-tauri/resources/agents/` (Tauri resource bundling)
- On first launch, copy to app data dir if `agents/` folder doesn't exist
- Never overwrite user-modified files (check file existence before copying)
- Include a `.version` marker to enable future migrations

**Acceptance Criteria**:
- [ ] Reads 2-level folder structure from Application Support
- [ ] Parses markdown frontmatter
- [ ] Hot-reloads when files change
- [ ] Falls back to filename for label if frontmatter missing
- [ ] Default commands copied on first run
- [ ] User modifications preserved across app updates

---

### Phase 5: Session Persistence (Week 3)

#### WI-5.1: Implement Session Storage
**Priority**: P2
**Estimate**: 4h

Store session IDs for "continue conversation":

```typescript
interface SessionStore {
  currentSessionId: string | null;
  history: Array<{
    id: string;
    startedAt: Date;
    lastPrompt: string;
  }>;
}
```

**Storage**: Use Tauri's app data directory for consistency with command files:
- macOS: `~/Library/Application Support/app.vmark/ai-sessions.json`
- Linux: `~/.config/app.vmark/ai-sessions.json`
- Windows: `%APPDATA%\\app.vmark\\ai-sessions.json`

**Acceptance Criteria**:
- [ ] Sessions persist across app restarts
- [ ] Can resume previous session
- [ ] Session history limited (e.g., last 10)

---

#### WI-5.2: Implement AI Right Sidebar
**Priority**: P1
**Estimate**: 10h

A dedicated right sidebar panel for AI interactions and session management.

**Component Structure** (`src/components/AISidebar/`):
```
AISidebar/
├── AISidebar.tsx          # Main container
├── AISidebar.css
├── SessionList.tsx        # Session history list
├── ChatView.tsx           # Current conversation view
├── MessageBubble.tsx      # Individual message
├── StreamingIndicator.tsx # Typing/processing indicator
└── index.ts
```

**Layout**:
```
┌──────────────────────────────────────────┐
│  AI Assistant                     [×] [≡]│
├──────────────────────────────────────────┤
│  Sessions                    [+ New]     │
│  ├── Today                               │
│  │   ├── Improve writing... (2 min ago)  │
│  │   └── Translate to CN... (1 hr ago)   │
│  └── Yesterday                           │
│      └── Research summary... (yesterday) │
├──────────────────────────────────────────┤
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ 🤖 I've improved the selected text │  │
│  │ with better flow and clarity...    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ 👤 Make it more formal please      │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ 🤖 Here's the formal version...    │  │
│  │ ▌ (streaming)                      │  │
│  └────────────────────────────────────┘  │
│                                          │
├──────────────────────────────────────────┤
│  [Type a follow-up message...]     [Send]│
└──────────────────────────────────────────┘
```

**Features**:
1. **Session List**: Grouped by date, shows preview of last prompt
2. **Chat View**: Scrollable message history with user/assistant bubbles
3. **Streaming**: Real-time display of agent responses
4. **Follow-up Input**: Continue conversation with additional prompts
5. **Actions**:
   - New session button
   - Delete session (swipe or context menu)
   - Copy response to clipboard
   - Insert response at cursor

**State Management** (`src/stores/aiSidebarStore.ts`):
```typescript
interface AISidebarState {
  isOpen: boolean;
  sessions: Session[];
  currentSessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  partialResponse: string;
}
```

**Toggle Shortcut** (`src/stores/shortcutsStore.ts`):
```typescript
{ id: "toggleAISidebar", label: "Toggle AI Sidebar", category: "view", defaultKey: "Mod-Shift-i" },
```

**Files to update** (per rule 41):
- `src/stores/shortcutsStore.ts` (add toggle shortcut)
- `website/guide/shortcuts.md`

**Acceptance Criteria**:
- [ ] Sidebar toggles with shortcut
- [ ] Shows session history grouped by date
- [ ] Displays conversation messages with streaming
- [ ] Supports follow-up messages to continue session
- [ ] Can start new session or resume previous
- [ ] Insert AI response at cursor works
- [ ] Respects theme (light/dark)

---

### Phase 6: Polish & Testing (Week 3)

#### WI-6.1: Error Handling & Edge Cases
**Priority**: P1
**Estimate**: 4h

Handle error scenarios:
- No authentication configured
- Network errors
- Rate limits
- Sidecar crashes
- VMark bridge disconnection

**Acceptance Criteria**:
- [ ] Clear error messages for each case
- [ ] Graceful degradation
- [ ] Recovery suggestions

---

#### WI-6.2: Add Tests
**Priority**: P1
**Estimate**: 6h

Test coverage for:
- Agent sidecar request routing
- MCP server wiring (`vmark-mcp-server` launch + allowlist enforcement)
- Subagent loading
- Session management

**Acceptance Criteria**:
- [ ] Unit tests for allowlist + command parsing
- [ ] Integration tests for agent flow
- [ ] Tests pass in CI

---

#### WI-6.3: Update Documentation
**Priority**: P2
**Estimate**: 4h

**Files to create/update**:
- `website/guide/ai-assistant.md` - User guide
- `website/guide/custom-agents.md` - Agent file format
- `dev-docs/agent-sdk-architecture.md` - Technical docs
- Update `website/guide/shortcuts.md` - New shortcuts

**Acceptance Criteria**:
- [ ] User-facing documentation complete
- [ ] Examples for custom agents
- [ ] Troubleshooting section

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `vmark-agent-sdk/` | New sidecar package |
| `src-tauri/src/agent_sidecar.rs` | Rust sidecar manager |
| `src-tauri/src/agent_commands.rs` | Rust commands for listing/reading agent files |
| `src-tauri/src/api_key.rs` | Secure API key storage (keychain) |
| `src-tauri/src/claude_detection.rs` | Detect global Claude Code installation |
| `src-tauri/resources/agents/` | Bundled default command files |
| `src/hooks/useAIAgent.ts` | React hook for agent operations |
| `src/components/Editor/AIContextMenu/` | Shortcut-triggered 2-level command menu |
| `src/components/AISidebar/` | Right sidebar for sessions and chat |
| `src/components/Settings/AISettings.tsx` | AI configuration UI |
| `src/stores/aiSidebarStore.ts` | AI sidebar state management |
| `website/guide/ai-assistant.md` | User docs |
| `website/guide/custom-agents.md` | Command file format docs |

### Modified Files

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Register agent commands |
| `src-tauri/tauri.conf.json` | Add agent sidecar binary |
| `src/stores/shortcutsStore.ts` | Add `aiMenu`, `toggleAISidebar` shortcuts |
| `src/App.tsx` | Initialize agent hook, integrate AISidebar |
| `src/components/Editor/EditorContainer.tsx` | Add AIContextMenu |
| `website/guide/shortcuts.md` | Document AI shortcuts |

### Default Command Files (shipped with app)

Located in Application Support, copied on first run:

| Path | Purpose |
|------|---------|
| `agents/writing/improve.md` | Improve clarity and flow |
| `agents/writing/proofread.md` | Fix grammar and spelling |
| `agents/writing/simplify.md` | Make text more concise |
| `agents/translate/to-chinese.md` | Translate to Chinese |
| `agents/translate/to-english.md` | Translate to English |
| `agents/translate/to-japanese.md` | Translate to Japanese |
| `agents/research/summarize.md` | Summarize selected text |
| `agents/research/expand.md` | Expand with more detail |

---

## Dependencies

**Node.js (vmark-agent-sdk/package.json)**:
```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.9",
    "zod": "^4.0.0",
    "gray-matter": "^4.0.3"
  },
  "devDependencies": {
    "@yao-pkg/pkg": "^6.0.0",
    "esbuild": "^0.27.2",
    "typescript": "~5.8.3",
    "vitest": "^4.0.0"
  }
}
```

**Note**: `@anthropic-ai/claude-code` is NOT bundled. User must install Claude Code globally.

**Rust (src-tauri/Cargo.toml)**:
```toml
[dependencies]
keyring = "3"  # Cross-platform keychain access for API key storage
which = "7"    # Find executables in PATH (for claude detection)
```

**User Prerequisite**:
```bash
# User must install Claude Code globally
npm install -g @anthropic-ai/claude-code

# And authenticate once
claude
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Third-party auth restrictions | Cannot ship "Claude login" | Ship API key / cloud provider auth; treat subscription reuse as dev-only |
| User doesn't have Claude Code | AI features unavailable | Clear setup instructions in Settings; detect and guide user |
| Claude Code version incompatibility | Agent SDK may break | Test against multiple Claude Code versions; document minimum version |
| User's PATH doesn't include claude | Detection fails | Allow manual path override in Settings; check common install locations |
| Rate limits | Poor UX | Let Claude handle; show clear errors |
| Bridge port conflicts | Connection fails | Port auto-discovery already implemented |

---

## Tool Safety (Important)

VMark already has a “suggestion-first” safety model for AI-driven edits via the MCP bridge:
- Full-document replace is blocked.
- Insert/replace operations can be staged as **suggestions** for explicit user approval (with an “auto-approve” setting for power users).

This Agent SDK integration should reuse that model by:
- Restricting tools via `allowedTools` per command/agent (default deny).
- Defaulting to “suggestion mode” edits (no silent modifications).
- Keeping “auto-approve” off by default for the built-in assistant.

---

## Success Criteria

1. **API key users**: Can enable AI features by providing an API key (stored securely)
2. **Cloud provider users**: Can use Bedrock/Vertex/Foundry with their existing credentials
3. **Compliance**: No claude.ai login flow in-app; no “Claude Code” branding in UI
4. **Shortcut + Context Menu**: `Cmd+Shift+A` opens 2-level command menu at cursor
5. **Command Files**: Users can create/edit markdown files in Application Support
6. **AI Sidebar**: Right panel shows sessions, messages, streaming responses
7. **Sessions**: Conversations persist and can be resumed/continued
8. **Performance**: AI operations feel responsive with real-time streaming

---

## Timeline

| Week | Focus | Deliverables |
|------|-------|--------------|
| Day 1 | Spike | Prove packaged Agent SDK sidecar works (WI-0.1) |
| Week 1 | Foundation | Package structure, bundle `claude`, MCP reuse, API key storage (WI-1.x) |
| Week 1-2 | Tauri Integration | Sidecar manager, binary builds (WI-2.x) |
| Week 2 | Frontend | React hook, context menu, AI settings, AI sidebar (WI-3.x) |
| Week 2-3 | Subagents | Built-in commands, command file system (WI-4.x) |
| Week 3 | Sessions & Polish | Session storage, error handling, tests, docs (WI-5.x, WI-6.x) |

**Estimates by Phase**:
| Phase | Work Items | Hours |
|-------|------------|-------|
| 0 | WI-0.1 | 4h |
| 1 | WI-1.1, WI-1.2, WI-1.3 | 14h |
| 2 | WI-2.1, WI-2.2, WI-2.3 | 18h |
| 3 | WI-3.1, WI-3.2, WI-3.3, WI-3.4 | 21h |
| 4 | WI-4.1, WI-4.2 | 14h |
| 5 | WI-5.1, WI-5.2 | 14h |
| 6 | WI-6.1, WI-6.2, WI-6.3 | 14h |
| **Total** | | **99h** |

**Total estimate: 3-4 weeks** (assuming ~25h/week of focused work)

---

## Design Decisions (Resolved)

| Question | Decision |
|----------|----------|
| Claude Code runtime | **Require global install** (not bundled). User installs Claude Code separately. |
| AI menu location | Use shortcut (`Cmd+Shift+A`) to trigger context menu, no separate menu |
| Command organization | 2-level context menu: categories (folders) → commands (.md files) |
| Command storage | Application Support folder (user-editable markdown files) |
| Session history UI | Dedicated right sidebar with session list and chat view |

**Rationale for global Claude Code**:
- Claude Code updates frequently (weekly); bundling ships stale versions
- Bundling adds ~100MB to binary size
- Users control their own updates
- Avoids version conflicts

---

## References

- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Agent SDK Sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Agent SDK Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [Claude Code Setup](https://code.claude.com/docs/en/setup)
- [Claude Code Subagents (file format)](https://code.claude.com/docs/en/sub-agents)
