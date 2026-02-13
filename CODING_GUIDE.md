# Coding Guide

This guide helps contributors understand VMark's project structure, conventions, and AI-assisted development setup.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19, Zustand v5, Tailwind v4 |
| Editor | Tiptap / ProseMirror |
| Build | Vite v7, pnpm |
| Tests | Vitest v4 |

## Getting Started

```bash
pnpm install
pnpm tauri:dev          # Start the app in dev mode
pnpm test               # Run all tests once
pnpm check:all          # Full quality gate (lint + coverage + build)
```

## Project Structure

```
vmark/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # Custom React hooks
│   ├── plugins/            # ProseMirror / Tiptap editor plugins
│   ├── stores/             # Zustand state stores
│   ├── styles/             # Global CSS and design tokens
│   ├── utils/              # Shared utilities
│   └── test/               # Test setup and shared helpers
├── src-tauri/              # Rust backend (Tauri)
│   └── src/                # Tauri commands, menu, plugins
├── shared/                 # Types shared between frontend and backend
├── website/                # VitePress documentation site
├── vmark-mcp-server/       # MCP server sidecar
├── AGENTS.md               # AI instructions (shared across all tools)
├── CLAUDE.md               # Claude Code entry point
├── .claude/                # Claude Code configuration
│   ├── rules/              # Auto-loaded project rules
│   ├── agents/             # Custom subagents
│   ├── skills/             # Custom skills (slash commands)
│   └── commands/           # Custom commands
├── .mcp.json               # MCP server configuration
├── vitest.config.ts        # Test config with coverage thresholds
└── package.json            # Scripts and dependencies
```

## Key Conventions

These apply to all contributors, human or AI.

### Code Style

- **Keep files under ~300 lines** — split proactively.
- **Zustand stores**: Never destructure in components; use selectors. Prefer `useXStore.getState()` inside callbacks.
- **Imports**: Use `@/` for cross-module, relative for same-module. Never use `../../../` chains.
- **Error handling**: Always narrow `unknown` errors with `instanceof Error` or `String()`.
- **CSS**: Never hardcode colors — use design tokens from `src/styles/index.css`. See `.claude/rules/31-design-tokens.md` for the full token reference.

### Testing (TDD)

Coverage thresholds are enforced in `vitest.config.ts`. The `check:all` gate runs `vitest run --coverage` — if coverage drops below the thresholds, the build fails.

- Write a failing test first (RED), implement minimally (GREEN), refactor (REFACTOR).
- Tests go next to the source: `foo.test.ts` beside `foo.ts`, or in a `__tests__/` subdirectory.
- See `.claude/rules/10-tdd.md` for a full pattern catalog with real file references.

### Keyboard Shortcuts

Three files must stay in sync when adding or changing shortcuts:

| File | Format |
|------|--------|
| `src-tauri/src/menu.rs` | `CmdOrCtrl+Shift+N` |
| `src/stores/shortcutsStore.ts` | `Mod-Shift-n` |
| `website/guide/shortcuts.md` | `Mod + Shift + N` |

See `.claude/rules/41-keyboard-shortcuts.md` for the full procedure.

### Version Bumps

Five files must be updated together. See `.claude/rules/40-version-bump.md`.

## Quality Gates

Run before pushing:

```bash
pnpm check:all
```

This runs, in order:
1. `eslint` + custom lints (selection styles, design tokens, em-dash spacing)
2. `vitest run --coverage` (with threshold enforcement)
3. `tsc && vite build`

## AI-Assisted Development

VMark uses multiple AI coding tools. The configuration is checked into the repo so the whole team shares the same context.

### Why `AGENTS.md`?

Different AI tools read different files:

| Tool | Reads |
|------|-------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `CLAUDE.md` + `.claude/rules/*.md` |
| [Codex CLI](https://github.com/openai/codex) | `AGENTS.md` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `GEMINI.md` |

The problem: maintaining the same instructions in three places. The solution: **write once in `AGENTS.md`, import everywhere**.

- `CLAUDE.md` contains `@AGENTS.md` — a Claude Code directive that inlines the file.
- `GEMINI.md` (if added) would use the same `@AGENTS.md` import.
- Codex CLI reads `AGENTS.md` directly.

This means `AGENTS.md` is the **single source of truth** for all AI tools. When you update instructions, update `AGENTS.md` — every tool picks up the change.

### File Map

```
AGENTS.md                      # Shared rules for all AI tools
CLAUDE.md                      # Claude Code entry point (imports AGENTS.md)
.claude/
  settings.json                # Team-shared Claude Code settings
  rules/                       # Auto-loaded into every Claude Code session
    00-engineering-principles.md
    10-tdd.md                  # TDD workflow and pattern catalog
    20-logging-and-docs.md
    21-website-docs.md
    30-ui-consistency.md
    31-design-tokens.md        # Full CSS token reference
    32-component-patterns.md   # Popup, toolbar, context menu patterns
    33-focus-indicators.md     # Accessibility focus rules
    34-dark-theme.md
    40-version-bump.md
    41-keyboard-shortcuts.md
    50-codebase-conventions.md # Store, hook, plugin, test patterns
  agents/                      # Subagents for specialized tasks
    implementer.md             # Implements scoped changes with tests
    auditor.md                 # Logic, duplication, dead-code checks
    planner.md                 # Turns goals into work items
    ...
  skills/                      # Slash commands (e.g., /release-gate)
    react-app-dev/
    rust-tauri-backend/
    tiptap-dev/
    ...
  commands/                    # Additional slash commands
    feature-workflow.md
    codex-audit.md
    ...
.mcp.json                     # MCP servers (Tauri E2E, Codex)
```

### Rules (`.claude/rules/`)

Rules are numbered by topic and auto-loaded into every Claude Code session. They contain project conventions that AI agents must follow — but they're also useful as references for human contributors:

- `10-tdd.md` — When tests are required, pattern catalog with real examples
- `31-design-tokens.md` — Every CSS custom property, its purpose, and default value
- `32-component-patterns.md` — Popup, toolbar, context menu CSS patterns
- `41-keyboard-shortcuts.md` — Procedure for adding/changing shortcuts
- `50-codebase-conventions.md` — Store, hook, plugin, test, and import patterns

### Private vs Shared Files

| File | In git? | Purpose |
|------|---------|---------|
| `AGENTS.md` | Yes | Shared AI instructions |
| `CLAUDE.md` | Yes | Claude Code entry point |
| `.claude/rules/`, `.claude/agents/`, `.claude/skills/` | Yes | Shared config |
| `.claude/settings.json` | Yes | Team-shared settings |
| `CLAUDE.local.md` | **No** | Personal overrides (gitignored) |
| `.claude/settings.local.json` | **No** | Personal settings (gitignored) |

To add personal instructions that don't affect the team, create `CLAUDE.local.md` in the project root.

### MCP Servers

`.mcp.json` configures [Model Context Protocol](https://modelcontextprotocol.io/) servers:

- **tauri** — E2E testing via `@hypothesi/tauri-mcp-server` (webview interaction, screenshots)
- **codex** — OpenAI Codex integration for audit commands

### Subscription Auth for AI Coding Tools

When vibe-coding this project, **always prefer subscription-based auth** over API keys for AI coding tools. Subscription plans are dramatically cheaper for sustained coding sessions — API billing can cost 10–30x more for the same work.

| Tool | Recommended Auth | Plan |
|------|-----------------|------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `claude` login (subscription) | Claude Max ($100–200/mo) |
| [Codex CLI](https://github.com/openai/codex) | `codex login` (subscription) | ChatGPT Plus/Pro ($20–200/mo) |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `gemini` login (Google account) | Free tier / Google One AI Premium |

API keys still work as a fallback, but for regular development, subscription auth is the way to go.

### Using Codex as a Second Opinion

VMark's `.mcp.json` registers an [OpenAI Codex](https://github.com/openai/codex) MCP server. This lets you ask Codex for help directly from Claude Code — useful as a second pair of eyes or for independent audits.

**Prerequisite:** Install the Codex CLI globally and log in with your subscription:

```bash
npm install -g @openai/codex
codex login                   # Log in with your ChatGPT subscription (recommended)
```

> **Avoid API keys for Codex.** `codex login` uses your ChatGPT Plus/Pro subscription, which is dramatically cheaper than `OPENAI_API_KEY` pay-per-token billing for heavy coding sessions.

Codex must be on your `PATH` for the MCP server to start. Verify with `codex --version`.

#### Slash Commands

The project provides four Codex-powered slash commands in `.claude/commands/`:

| Command | What it does |
|---------|-------------|
| `/codex-audit` | Full 9-dimension audit (security, correctness, compliance, etc.) |
| `/codex-audit-mini` | Fast 5-dimension check (logic, duplication, dead code, debt, shortcuts) |
| `/codex-verify` | Verify fixes from a previous audit report |
| `/codex-commit` | Inspect changes and generate commit messages |

#### Usage Examples

**Audit uncommitted changes:**

```
/codex-audit
```

**Audit the last 3 commits:**

```
/codex-audit commit -3
```

**Fast check on a specific directory:**

```
/codex-audit-mini src/plugins/search
```

**Verify fixes after addressing audit findings:**

```
/codex-verify
```

#### How It Works

1. You type a slash command in Claude Code (e.g., `/codex-audit`).
2. Claude reads the command definition from `.claude/commands/codex-audit.md`.
3. The command instructs Claude to discover the Codex MCP tool via `ToolSearch`.
4. Claude delegates per-file analysis to Codex through the MCP bridge.
5. If Codex is unavailable or returns empty results, Claude falls back to manual analysis using its own Read/Grep tools — the audit still completes.

#### Ad-hoc Help from Codex

Beyond slash commands, you can ask Claude to consult Codex at any point during a conversation. For example, if Claude is stuck on a tricky bug or unsure about an approach, just say:

```
Summarize your trouble, and ask Codex for help.
```

Claude will formulate a focused question, send it to Codex via the MCP bridge, and incorporate the response. This works because the Codex MCP server is always available — no special setup needed beyond the initial `codex` CLI install.

#### When to Use What

| Situation | Command |
|-----------|---------|
| Pre-push sanity check | `/codex-audit-mini` |
| PR review / thorough audit | `/codex-audit` |
| After fixing audit findings | `/codex-verify` |
| Quick fix with smart commit message | `/codex-commit` |
| General bug fix | `/fix [description]` |

### For Non-AI Contributors

You don't need any AI tools to contribute. The rules files in `.claude/rules/` double as living documentation of project conventions — read them to understand the patterns and standards the codebase follows.

The key files to read before your first PR:
1. `AGENTS.md` — Project overview and conventions
2. `.claude/rules/10-tdd.md` — Testing requirements
3. `.claude/rules/50-codebase-conventions.md` — Code patterns
