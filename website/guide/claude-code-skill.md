# Claude Code Skill

VMark provides a comprehensive skill for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that teaches the AI how to effectively use VMark's 76 MCP tools for writing assistance.

## What is a Skill?

A skill is a set of instructions and reference materials that help Claude Code understand how to work with specific tools. The VMark skill includes:

- **Core principles** — Read-before-write, suggestion mode, revision management
- **Intent mapping** — "I want to X" → use these tools
- **Workflows** — Step-by-step patterns for common tasks
- **Examples** — Real tool calls with parameters and responses

## Installation

### Option 1: From VMark Repository (Recommended)

Add VMark as a marketplace source and install directly:

```bash
# Add VMark as a marketplace
claude marketplace add github:xiaolai/vmark

# Install the skill
claude plugins install vmark-mcp@vmark-marketplace
```

### Option 2: From Every Marketplace

If the plugin has been accepted into [every-marketplace](https://github.com/EveryInc/every-marketplace):

```bash
# Install from every-marketplace
claude plugins install vmark-mcp@every-marketplace
```

### Verify Installation

Check that the skill is installed:

```bash
claude plugins list
```

You should see `vmark-mcp` in the list.

## Usage

Once installed, the skill is automatically available. Claude Code will use it when you ask for help with VMark documents.

### Example Prompts

**Continue writing:**
> "Continue this paragraph in VMark"

**Improve content:**
> "Make the introduction in my VMark document more concise"

**Reorganize:**
> "Move the Conclusion section before Methods in VMark"

**Find and replace:**
> "Replace all instances of 'machine learning' with 'ML' in my document"

**Format content:**
> "Convert these bullet points to a numbered list"

## What the Skill Teaches

### Core Principles

| Principle | Description |
|-----------|-------------|
| **Read before write** | Always understand the document before modifying |
| **Suggest, don't force** | Use suggestion mode for content changes |
| **Respect revisions** | Handle conflicts when document changes |
| **Work with structure** | Target nodes by ID, not character positions |

### Workflows Included

1. **AI Writing Partner** — Continue/expand at cursor
2. **Improve a Section** — Refine existing content
3. **Reorganize Document** — Move sections around
4. **Find and Replace** — Pattern-based changes
5. **Convert Notes to Prose** — Transform bullet points
6. **Multi-Document Reference** — Work across tabs
7. **Format Cleanup** — Batch formatting
8. **Handling Conflicts** — Recover from revision errors
9. **Creating Tables** — Table workflows

### Tool Categories

The skill covers all 76 MCP tools organized by intent:

| Intent | Key Tools |
|--------|-----------|
| Understand document | `get_document_digest`, `get_document_ast` |
| Make edits | `batch_edit`, `apply_diff` |
| Work with sections | `get_section`, `update_section`, `move_section` |
| Format text | `format_toggle`, `block_set_type` |
| Manage lists/tables | `list_modify`, `table_modify` |
| Handle suggestions | `suggestion_list`, `suggestion_accept` |

## Suggestion Mode

The skill emphasizes **suggestion mode** for all content changes. When Claude makes edits:

1. Changes appear as highlighted suggestions in VMark
2. You review and accept (Enter) or reject (Escape) each suggestion
3. Your undo history is preserved

This gives you full control over AI-generated content.

## Limitations

The skill is honest about what MCP can and cannot do:

| Capability | Status |
|------------|--------|
| Insert/edit content | ✅ Supported |
| Read document structure | ✅ Supported |
| Format text | ✅ Supported |
| Real-time co-writing | ❌ Not supported |
| Show multiple alternatives | ❌ Not supported |
| Watch for errors as you type | ❌ Not supported |

## Updating the Skill

When VMark releases updates, the skill is automatically synced to the marketplace. To get the latest version:

```bash
claude plugins update vmark-mcp
```

## Troubleshooting

### Skill not found

Make sure you've added the marketplace:

```bash
claude marketplace add github:xiaolai/vmark
```

### Tools not working

1. Ensure VMark is running with MCP enabled
2. Check MCP server status in VMark's status bar
3. Restart Claude Code after configuration changes

### Suggestions not appearing

1. Verify auto-approve is disabled in VMark settings
2. Check that the document has focus in VMark
3. Look for the suggestion highlight in the editor

## Related Plugins

### init-workspace

If you use multiple AI tools (Claude Code, Codex CLI, Gemini CLI), the [init-workspace](https://github.com/xiaolai/init-workspace) plugin helps set up a unified workspace:

```bash
claude plugins install init-workspace@init-workspace-marketplace
```

**What it does:**
- Creates `AGENTS.md` as single source of truth for AI instructions
- Sets up shared configuration across all AI tools
- Includes `/doc` command for creating documentation (which you can edit in VMark)

**Useful for:**
- Writers managing documentation projects
- Developers using multiple AI assistants
- Teams wanting consistent AI behavior

## Source Code

The skill source is available in the VMark repository:

- [plugins/vmark-mcp/skills/vmark-mcp/](https://github.com/xiaolai/vmark/tree/main/plugins/vmark-mcp/skills/vmark-mcp)

Contributions welcome!

## Next Steps

- [MCP Setup](/guide/mcp-setup) — Configure VMark's MCP server
- [MCP Tools Reference](/guide/mcp-tools) — Full tool documentation
- [Features](/guide/features) — Other VMark capabilities
