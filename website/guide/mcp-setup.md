# AI Integration (MCP)

VMark includes a built-in MCP (Model Context Protocol) server that allows AI assistants like Claude to interact directly with your editor.

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that enables AI assistants to interact with external tools and applications. VMark's MCP server exposes its editor capabilities as tools that AI assistants can use to:

- Read and write document content
- Apply formatting and create structures
- Navigate and manage documents
- Insert special content (math, diagrams, wiki links)

## Quick Setup

VMark makes it easy to connect AI assistants with one-click installation.

### 1. Enable MCP Server

Open **Settings → Integrations** and enable the MCP Server:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-server.png" alt="VMark MCP Server Settings" />
</div>

- **Enable MCP Server** - Turn on to allow AI connections
- **Start on launch** - Auto-start when VMark opens
- **Auto-approve saves to a new location and genie results** - Off by default. Lets an AI save a document to a *new* path without asking, and lets a genie apply its result directly instead of as a suggestion. Ordinary AI writes are never gated by it — their safety net is the [edit checkpoint history](#edit-checkpoints) (see [How Edits Work](#how-edits-work))

### 2. Install Configuration

Click **Install** for your AI assistant:

<div class="screenshot-container">
  <img src="/screenshots/mcp-settings-install.png" alt="VMark MCP Install Configuration" />
</div>

Supported AI assistants:
- **Claude Desktop** - Anthropic's desktop app
- **Claude Code** - CLI for developers
- **Codex CLI** - OpenAI's coding assistant
- **Antigravity CLI** - Google's `agy`, the successor to Gemini CLI
- **Grok CLI** - xAI's coding agent
- **opencode** - the open-source, provider-agnostic terminal agent

**Install writes a per-client credential.** Besides the path to VMark's MCP server, Install puts a secret token in the client's own config file, under `env.VMARK_MCP_TOKEN` (`environment.VMARK_MCP_TOKEN` for opencode). Each client gets its own token, and it is stored nowhere else. It tells VMark which client is connecting, rather than trusting the name the client reports. Today only delegated actions need it — answering a coherence question on your behalf with `coherence_resolve`; every other tool works without it. Install and **Repair** keep a token that is still valid; to issue a fresh one, Uninstall and Install again. Restart the AI client after either. Treat the token like a password: don't paste the config file into an issue or a chat.

::: info Gemini CLI is discontinued
Google replaced Gemini CLI with Antigravity. If an earlier VMark install left a
`vmark` entry in `~/.gemini/settings.json`, the Integrations panel shows a
**Discontinued** row for it with a **Remove** button; new installs target
Antigravity instead.
:::

::: info Other MCP-Compatible Clients
Other MCP-compatible clients such as Cursor, Windsurf, and similar tools can also connect to VMark's MCP server. Configure them manually by pointing to the MCP server binary path (see [Manual Configuration](#manual-configuration) below).
:::

#### CC-Switch

If you manage your AI CLIs with CC-Switch, the installer also shows a **CC-Switch** row. **Add to CC-Switch** opens a `ccswitch://v1/import` link that hands VMark's MCP server — its binary path — to CC-Switch, which then writes the `vmark` entry into whichever CLIs you manage there; a copy button gives you the link itself if you would rather paste it. The row is disabled until VMark has resolved its own MCP binary.

#### Status Icons

Each provider shows a status indicator:

| Icon | Status | Meaning |
|------|--------|---------|
| ✓ Green | Valid | Configuration is correct and working |
| ⚠ Amber | Path Mismatch | VMark was moved — click **Repair** |
| ✗ Red | Binary Missing | MCP binary not found — reinstall VMark |
| 🗎 Red | Config Unreadable | VMark cannot read or parse the config file, so whether it holds a VMark entry is unknown. The message names the file and the reason. Fix or move it, then click **Recheck** — install and repair are withheld until it parses, because writing to a file VMark cannot read would risk destroying its contents |
| ○ Gray | Not Configured | Not installed — click **Install** |

::: tip VMark Moved?
If you move VMark.app to a different location, the status will show amber "Path Mismatch". Simply click the **Repair** button to update the configuration with the new path.
:::

### 3. Restart Your AI Assistant

After installing or repairing, **restart your AI assistant** completely (quit and reopen) to load the new configuration. VMark will show a reminder after each configuration change.

### 4. Try It Out

In your AI assistant, try commands like:
- *"What's in my VMark document?"*
- *"Write a summary of quantum computing to VMark"*
- *"Add a table of contents to my document"*

## See It in Action

Ask Claude a question and have it write the answer directly to your VMark document:

<div class="screenshot-container">
  <img src="/screenshots/mcp-claude.png" alt="Claude Desktop using VMark MCP" />
  <p class="screenshot-caption">Claude Desktop calls <code>document</code> → <code>set_content</code> to write to VMark</p>
</div>

<div class="screenshot-container">
  <img src="/screenshots/mcp-result.png" alt="Content rendered in VMark" />
  <p class="screenshot-caption">The content appears instantly in VMark, fully formatted</p>
</div>

<!-- Styles in style.css -->

## Manual Configuration

If you prefer to configure manually, here are the config file locations:

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Claude Code

Edit `~/.claude.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### Antigravity CLI

Edit `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    }
  }
}
```

### Grok CLI

Edit `~/.grok/config.toml`:

```toml
[mcp_servers.vmark]
command = "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
```

### opencode

Edit `~/.config/opencode/opencode.json`. opencode's schema differs from the
`mcpServers` one: the key is `mcp`, and `command` is a single array holding
the program and its arguments:

```json
{
  "mcp": {
    "vmark": {
      "type": "local",
      "command": ["/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"],
      "enabled": true
    }
  }
}
```

If your own settings live in `opencode.jsonc`, leave them there — opencode
merges both files, so VMark's entry in `opencode.json` is additive. VMark writes
the plain-JSON file because it cannot round-trip the comments in a `.jsonc` one.

::: warning An existing `vmark` entry in `opencode.jsonc` wins
opencode merges `config.json`, then `opencode.json`, then `opencode.jsonc`, and
the last one read takes precedence. So if you previously added a `vmark` entry
to `opencode.jsonc` by hand, it overrides the one VMark manages — VMark will
report the provider as valid while opencode keeps using your older entry (and
its stale binary path). Delete the hand-written `mcp.vmark` block from
`opencode.jsonc` and let the Integrations panel own it.
:::

::: tip Finding the Binary Path
On macOS, the MCP server binary is inside VMark.app:
- `VMark.app/Contents/MacOS/vmark-mcp-server`

On Windows:
- `C:\Program Files\VMark\vmark-mcp-server.exe`

On Linux:
- `/usr/bin/vmark-mcp-server` (or where you installed it)

The port is auto-discovered — no `args` needed.
:::

### CLI flags (advanced)

The MCP server binary supports a small set of flags for diagnostics and legacy setups:

| Flag | What it does |
|---|---|
| `--version` (or `-v`) | Print the version (must match the running VMark) and exit. |
| `--health-check` | Run a self-test of the binary and exit: it starts the MCP server against a built-in mock bridge, prints its version and tool count as JSON, and exits non-zero if the tool count is not what this build expects. It does **not** contact a running VMark — use it to confirm the binary runs; use **Settings → Integrations** to check the live bridge. |
| `--port <number>` | Manual port override. Skip the auto-discovery handshake and connect on the given port. Only useful for legacy setups where the bridge port is fixed externally; the auto-discovery path is preferred. |

Example:

```bash
vmark-mcp-server --health-check
vmark-mcp-server --version
vmark-mcp-server --port 9223   # legacy / manual
```

Any other argument — a misspelled flag, `--port=9223`, or a stray word — is refused: the binary prints a usage error and exits with code 64 instead of falling back to auto-discovery.

## How It Works

```text
AI Assistant <--stdio--> MCP Server <--WebSocket--> VMark Editor
```

1. **VMark starts a WebSocket bridge** on an available port when launched
2. **The MCP server** reads the port and auth token from VMark's app data directory
3. **The MCP server** connects and authenticates via the WebSocket bridge
4. **AI assistant** communicates with the MCP server via stdio
5. **Commands are relayed** to VMark's editor through the bridge

## Available Capabilities

When connected, your AI assistant has ten tools:

| Tool | What it covers |
|------|----------------|
| `session` | Windows, tabs, the active document and browser tabs (read-only) |
| `workspace` | New, open, save, save-as, close, switch tabs, focus a window, open a workspace |
| `document` | Read and write the whole document as Markdown; CJK formatting transforms |
| `selection` | Read and replace the selected text |
| `comments` | List review comments on the document, reply to them and mark them addressed (an assistant cannot resolve them) |
| `workflow` | CST-safe patches and validation for GitHub Actions YAML |
| `browser` / `browser_read` | Embedded-browser automation on macOS — the mutating and read-only halves |
| `coherence` / `coherence_resolve` | Read the coherence layer; resolve stale edges under a delegation you granted |

Formatting is not a separate tool: the assistant writes Markdown, so headings, tables, math and diagrams are whatever it writes.

See the [MCP Tools Reference](/guide/mcp-tools) for complete documentation.

## Checking MCP Status

VMark provides multiple ways to check the MCP server status:

### Status Bar Indicator

The status bar shows an **MCP** indicator on the right side. When something
needs your attention, a small state word appears beside the satellite icon;
a healthy connection is just the green icon. Hovering it lists the AI clients
currently connected, by name and version:

| Color | Word | Status |
|-------|------|--------|
| Green | — | Connected and running |
| Gray | `off` | Disconnected or stopped |
| Pulsing (animated) | `…` | Starting up |
| Red | `error` | Server failed — hover for the reason |

Startup typically completes within 1-2 seconds.

Click the indicator to open **Settings → Integrations**.

### Settings Panel

**Settings → Integrations** is the other status surface — there is no separate status dialog. While the bridge is running it shows the address it listens on (`localhost:<port>`, with a copy button) and how many AI clients are connected, refreshed every few seconds. The **Test Connection** button (labelled **Check sidecar** while the bridge is stopped) runs the sidecar's own `--health-check` and reports the sidecar version, its tool count and when it was last checked — it confirms the installed binary works, not that a client is connected.

## Troubleshooting

### "Connection refused" or "No active editor"

- Ensure VMark is running and has a document open
- Check that the MCP Server is enabled in Settings → Integrations
- Verify the MCP bridge shows "Running" status
- Restart VMark if the connection was interrupted

### Path mismatch after moving VMark

If you moved VMark.app to a different location (e.g., from Downloads to Applications), the configuration will point to the old path:

1. Open **Settings → Integrations**
2. Look for the amber ⚠ warning icon next to affected providers
3. Click **Repair** to update the path
4. Restart your AI assistant

### Tools not appearing in AI assistant

- Restart your AI assistant after installing the configuration
- Verify the configuration was installed (check for green checkmark in Settings)
- Check your AI assistant's logs for MCP connection errors

### Commands fail with "No active editor"

- Make sure a document tab is active in VMark
- Click in the editor area to focus it
- Some commands require text to be selected first

## How Edits Work

The pruned MCP surface follows the read-write spine: AI assistants call `document.read` to get the current content + a revision token, reason about it, then call `document.write` with the new full content. The revision token guards against silent overwrites: if you typed in VMark while the AI was thinking, the write returns `STALE` and the AI re-reads.

For GitHub Actions workflow YAML files, the AI uses `workflow.apply_patch` instead — VMark's CST-aware mutators preserve comments, anchors, and key order that a raw text rewrite would lose.

There is no preview step for `document.write`, `selection.set` or `workflow.apply_patch` — the change lands in the editor as soon as the revision check passes. The safety net is the [edit checkpoint history](#edit-checkpoints) below; if you want to review before anything lands, keep the document under git and review the diff. The one approval gate is **Auto-approve saves to a new location and genie results**: with it off (the default), an AI cannot save a document to a new path — `workspace.save_as` returns `APPROVAL_REQUIRED` and VMark shows a toast naming the file. Even with it on, `save_as` refuses to overwrite a different existing file.

## Edit Checkpoints

Every AI document mutation — `document.write`, `document.transform`, `selection.set` and `workflow.apply_patch` — is recorded in VMark's edit history before it changes anything. The **history** button in the status bar opens a panel for the focused document. Its badge counts the document's AI revisions, and the button turns to a warning colour when changes are not being recorded. The panel updates live, in every window, as revisions are recorded.

The panel lists the document's revisions, newest first. Each row shows when it happened, what kind of change it was, the tool, and who made it: the provider of the AI client (for example `claude` or `codex`), its connection and its session label. A client with no token is shown as an **Unidentified client**, an unknown token as an **Unrecognized credential**, and a token shared by several clients as a **Credential shared by several providers** — never as a provider, whatever name the client gives itself. **Restore this version** puts that revision's text back; **Restore to before this change** puts back the text before it. Restoring bumps the document's revision, so an AI client still holding the old revision gets `STALE` on its next write instead of overwriting your restore. A restore is itself recorded: the text it replaces is kept first, and a document edited while the restore was in flight is left alone. When VMark cannot confirm that a restore's record reached the disk, it warns you beside the result.

Above the revisions, **Review AI Changes** lists the AI changes you have not reviewed yet, grouped by client and session; revisions whose changes are all reviewed are summarized as a count. Each change offers **Keep** or **Revert** (and **Undo keep** or **Undo revert** afterwards). A revert that would overwrite text you have edited since is not applied: the change is marked as conflicting, and once you have resolved it by hand, **Mark handled** records that. A change whose location can no longer be certified says why and offers no automatic revert. **Clear reviewed** settles every reviewed change for good, after a confirmation, since it cannot be undone. A document holds at most 500 unreviewed AI changes: at that limit a banner says so, and AI edits to it are refused with `REVIEW_BACKLOG_FULL` until you review and clear. A save that started from a different version than the one before it — the document was edited in two windows — is marked as such, with both restores to undo the merge. **Show both changes** opens two diffs of that save: *Against the version this save started from*, and *Against the version before it*, against the version before it in the history.

After them, **Comments** holds the document's comment threads. **Comment on selection** quotes the text selected in the editor (with only a cursor, the paragraph it is in) and adds your comment; unsaved text is recorded first, so a comment never points at an older version. Each thread shows its state — open, addressed, resolved or reopened — who wrote it, the quoted text and the replies. Comments are shown as plain text: HTML in a comment is displayed, never run. When the quoted text now appears several times, the thread says how many; when it is gone, the thread says so. You can **Reply** in any state, **Mark addressed** an open or reopened thread, **Resolve** it, and **Reopen** or **Delete** a resolved one; deleting asks first and cannot be undone. While a comment or reply is being sent it cannot be edited or cancelled, even if you close the panel and open it again; a refused one is kept so you can change it and send it again. Only you can resolve, reopen or delete a thread. A thread reopened after its original revision was cleared from the history reads *Creation revision no longer retained* and is matched against the current text.

The top of the panel says when changes are not being recorded: the history could not start or is read-only, it is behind (records queued and not yet on disk), this document's last save was refused or the history did not answer in time, AI edits were refused in a window with too many open pages, or some AI changes can no longer be reverted automatically. It also counts AI edits recorded as whole-document changes because their changed range could not be confirmed. A change that can no longer be reverted automatically reads **Blocked: reason (origin)** under the last revision where its location was certified, which is highlighted; when there is none, the panel says the location is unavailable. Writes that were applied but never recorded are listed under **Unrecorded writes**, each with a restore and a discard.

To tell several sessions of one client apart, set `VMARK_SESSION_LABEL` in the client's MCP configuration, beside `VMARK_MCP_TOKEN`:

```json
"env": { "VMARK_MCP_TOKEN": "…", "VMARK_SESSION_LABEL": "docs refactor" }
```

The label is at most 128 UTF-8 bytes, with no control characters; a label that breaks the rule is dropped with a warning and the client connects without it. It is chosen by the client's configuration, so it is shown for display only and decides nothing.

The history is kept in the `agent-journal` folder in VMark's app data directory, so it survives a restart. The folder holds the full previous text of every recorded edit and is owner-only (`0700` on macOS and Linux). Checkpoints from an earlier version of VMark (a `mcp-checkpoints.jsonl`, imported at the first start and then renamed aside) are listed under **Earlier checkpoints**, one list for every document and window. Restoring one opens its file; an untitled one, or a file that can no longer be opened, is restored into a new document. The section shows how much checkpoint text is kept and clears it all — every file and every window — in one action, deleting the texts from disk.

## Security Notes

- The MCP server only accepts local connections (localhost)
- No data is sent to external servers
- AI file operations are confined to the open workspace root and the folders of open documents — see [Privacy](/guide/privacy#what-an-ai-assistant-can-reach)
- All processing happens on your machine
- The WebSocket bridge is only accessible locally
- Each installed client carries its own `VMARK_MCP_TOKEN`. A client with no token, an unknown one, or one shared with another client still connects, but its delegated actions are refused with a message telling you to run Install for it in **Settings → Integrations** and restart it

## Next Steps

- Explore all [MCP Tools](/guide/mcp-tools) available
- Learn about [keyboard shortcuts](/guide/shortcuts)
- Check out other [features](/guide/features)
