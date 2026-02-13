# .claude/ — AI Development Configuration

This directory contains configuration for AI coding tools — primarily [Claude Code](https://docs.anthropic.com/en/docs/claude-code), with cross-tool support via `AGENTS.md`.

## Prerequisites

### Codex CLI (Required for audit commands)

Several slash commands (`/codex-audit`, `/codex-verify`, `/codex-audit-mini`, `/fix-issue`, `/audit-fix`) use OpenAI's Codex as an independent second opinion. Codex runs as an MCP server that Claude Code consults during audits.

Install globally:

```bash
npm install -g @openai/codex
```

Verify it's on your PATH:

```bash
codex --version
```

Set your OpenAI API key:

```bash
export OPENAI_API_KEY="sk-..."
```

### Why Codex?

Using a second AI model for code review catches blind spots that a single model might miss. Claude writes the code; Codex audits it independently. This cross-model verification is built into the `/codex-audit` and `/fix-issue` workflows.

## How Codex MCP Works

The project root contains `.mcp.json`, which Claude Code auto-loads at session start:

```json
{
  "mcpServers": {
    "codex": {
      "command": "codex",
      "args": ["mcp-server"]
    }
  }
}
```

This registers Codex as an MCP tool (`mcp__codex__codex`) inside Claude Code. Slash commands call it via `ToolSearch` to load the tool, then invoke it with audit prompts. Codex runs in a sandboxed read-only context — it can read the codebase but cannot modify files.

## Directory Structure

```
.claude/
├── README.md              # This file
├── settings.json          # Team-shared settings (checked in)
├── settings.local.json    # Personal settings (gitignored)
├── rules/                 # Auto-loaded project rules
├── commands/              # Slash commands (/fix, /codex-audit, etc.)
├── skills/                # Extended capabilities (planning, Tauri, etc.)
└── agents/                # Subagent definitions for /feature-workflow
```

### Settings Files

| File | Shared? | Purpose |
|------|---------|---------|
| `settings.json` | Yes | Team-wide plugin config (e.g., enabled plugins) |
| `settings.local.json` | **No** (gitignored) | Personal permissions, tool approvals, output style |

`settings.local.json` accumulates permissions as you approve tool calls during sessions. It's machine-specific and should not be committed.

### Rules (`rules/`)

Auto-loaded into every Claude Code session. These enforce project conventions:

| File | Scope |
|------|-------|
| `00-engineering-principles.md` | Core working agreement |
| `10-tdd.md` | TDD workflow, coverage thresholds, test patterns |
| `20-logging-and-docs.md` | Dev docs update policy |
| `21-website-docs.md` | Website documentation sync triggers |
| `30-ui-consistency.md` | UI design principles |
| `31-design-tokens.md` | Full CSS token reference |
| `32-component-patterns.md` | Popup, toolbar, menu patterns |
| `33-focus-indicators.md` | Accessibility focus rules |
| `34-dark-theme.md` | Dark theme implementation rules |
| `40-version-bump.md` | Five-file version bump procedure |
| `41-keyboard-shortcuts.md` | Three-file shortcut sync procedure |
| `50-codebase-conventions.md` | Store, hook, plugin, test conventions |

### Slash Commands (`commands/`)

| Command | Purpose |
|---------|---------|
| `/fix` | Root-cause bug fixing with TDD |
| `/fix-issue` | End-to-end GitHub issue resolver (fetch, branch, fix, audit, PR) |
| `/codex-audit` | Full 9-dimension code audit via Codex |
| `/codex-audit-mini` | Fast 5-dimension audit for small changes |
| `/codex-verify` | Verify fixes from a previous audit report |
| `/codex-commit` | Smart commit messages from change analysis |
| `/audit-fix` | Audit, fix all findings, verify — repeat until clean |
| `/feature-workflow` | Gated agent-driven workflow with specialized subagents |
| `/release-gate` | Run `pnpm check:all` and produce a gate report |
| `/merge-prs` | Review and merge open PRs sequentially |
| `/bump` | Version bump across all 5 files, commit, tag, push |
| `/test-guide` | Generate manual testing guide |

### Skills (`skills/`)

Extended capabilities that Claude Code loads on demand:

| Skill | When used |
|-------|-----------|
| `react-app-dev` | React UI changes (components, hooks, stores) |
| `rust-tauri-backend` | Rust/Tauri backend changes |
| `tauri-v2-integration` | Frontend-backend IPC bridges |
| `tiptap-dev` / `tiptap-editor` | Rich text editor work |
| `tauri-mcp-testing` | E2E testing via Tauri MCP |
| `css-design-tdd` | CSS token auditing |
| `planning` / `plan-audit` / `plan-verify` | Implementation planning |
| `shortcut-audit` | Keyboard shortcut consistency |
| `mcp-dev` / `mcp-server-manager` | MCP server configuration |
| `release-gate` | Quality gate checks |
| `ai-coding-agents` | Multi-tool orchestration guidance |

### Agents (`agents/`)

Subagent definitions used by `/feature-workflow` for complex tasks:

| Agent | Role |
|-------|------|
| `planner` | Research, edge cases, modular work items |
| `implementer` | TDD-driven code changes |
| `auditor` | Diff review for correctness and rule violations |
| `test-runner` | Test execution and E2E coordination |
| `verifier` | Final pre-release checklist |
| `spec-guardian` | Validates work against specifications |
| `impact-analyst` | Finds minimal correct change set |
| `release-steward` | Commit messages and release notes |
| `manual-test-author` | Manual testing guide maintenance |

## Related Files (Project Root)

| File | Purpose |
|------|---------|
| `AGENTS.md` | Single source of truth for all AI tool instructions |
| `CLAUDE.md` | Claude Code entry point — `@AGENTS.md` directive |
| `CLAUDE.local.md` | Personal instructions (gitignored) |
| `.mcp.json` | MCP server registrations (Codex, Tauri) |
