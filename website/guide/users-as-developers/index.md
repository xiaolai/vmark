# Users as Developers

In the age of AI coding tools, the line between "user" and "developer" is disappearing. If you can describe a bug, you can fix it. If you can imagine a feature, you can build it — with an AI assistant that already understands the codebase.

VMark embraces this philosophy. The repo ships with project rules, architecture docs, and conventions pre-loaded for AI coding tools. Clone the repo, open your AI assistant, and start contributing — the AI already knows how VMark works.

## Ready Out of the Box

If you use AI coding tools like [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli), VMark's repo is ready for them out of the box.

## One File, Every Tool

AI coding tools each read their own config file:

| Tool | Config file |
|------|------------|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

Maintaining the same instructions in three places is error-prone. VMark solves this with a single source of truth:

- **`AGENTS.md`** — Contains all project rules, conventions, and architecture notes.
- **`CLAUDE.md`** — Just one line: `@AGENTS.md` (a Claude Code directive that inlines the file).
- **Codex CLI** — Reads `AGENTS.md` directly.
- **Gemini CLI** — Would use `@AGENTS.md` in `GEMINI.md` the same way.

Update `AGENTS.md` once, every tool picks up the change.

::: tip What is `@AGENTS.md`?
The `@` prefix is a Claude Code directive that inlines another file's content. It's similar to `#include` in C — the contents of `AGENTS.md` are inserted into `CLAUDE.md` at that position. Learn more at [agents.md](https://agents.md/).
:::

## What the AI Knows

When an AI coding tool opens the VMark repo, it automatically receives:

### Project Rules (`.claude/rules/`)

These files are auto-loaded into every Claude Code session. They cover:

| Rule | What it enforces |
|------|-----------------|
| TDD Workflow | Test-first is mandatory; coverage thresholds block the build |
| Design Tokens | Never hardcode colors — full CSS token reference included |
| Component Patterns | Popup, toolbar, context menu patterns with code examples |
| Focus Indicators | Accessibility: keyboard focus must always be visible |
| Dark Theme | `.dark-theme` selector rules, token parity requirements |
| Keyboard Shortcuts | Three-file sync procedure (Rust, TypeScript, docs) |
| Version Bumps | Five-file update procedure |
| Codebase Conventions | Store, hook, plugin, test, and import patterns |

### Custom Skills

Slash commands give the AI specialized capabilities:

| Command | What it does |
|---------|-------------|
| `/fix` | Fix issues properly — root cause analysis, TDD, no patches |
| `/fix-issue` | End-to-end GitHub issue resolver (fetch, branch, fix, audit, PR) |
| `/codex-audit` | Full 9-dimension code audit (security, correctness, compliance, ...) |
| `/codex-audit-mini` | Fast 5-dimension check for small changes |
| `/codex-verify` | Verify fixes from a previous audit |
| `/codex-commit` | Smart commit messages from change analysis |
| `/audit-fix` | Audit, fix all findings, verify — repeat until clean |
| `/feature-workflow` | End-to-end gated workflow with specialized agents |
| `/release-gate` | Run full quality gates and produce a report |
| `/merge-prs` | Review and merge open PRs sequentially |
| `/bump` | Version bump across all 5 files, commit, tag, push |

### Specialized Agents

For complex tasks, Claude Code can delegate to focused subagents:

| Agent | Role |
|-------|------|
| Planner | Researches best practices, brainstorms edge cases, produces modular plans |
| Implementer | TDD-driven implementation with preflight investigation |
| Auditor | Reviews diffs for correctness and rule violations |
| Test Runner | Runs gates, coordinates E2E testing via Tauri MCP |
| Verifier | Final checklist before release |

## Using Codex as a Second Opinion

VMark uses cross-model verification — Claude writes the code, then Codex (a different AI model from OpenAI) audits it independently. This catches blind spots that a single model might miss.

### How It Works

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

This registers Codex as an MCP tool inside Claude Code. Slash commands like `/codex-audit` call it automatically. Codex runs in a sandboxed read-only context — it can read the codebase but cannot modify files.

### Setup

Install Codex CLI globally and log in with your ChatGPT subscription:

```bash
npm install -g @openai/codex
codex login                   # Log in with your ChatGPT subscription (recommended)
```

Verify it's on your PATH:

```bash
codex --version
```

::: tip Subscription vs API Keys
**Always prefer subscription auth** over API keys for vibe-coding. Subscriptions are 10\u201330x cheaper for sustained coding sessions. See the full breakdown in [Subscription vs API Pricing](/guide/users-as-developers/subscription-vs-api).
:::

::: tip PATH for macOS GUI Apps
macOS GUI apps (like terminals launched from Spotlight) have a minimal PATH. If `codex --version` works in your terminal but Claude Code can't find it, ensure the Codex binary location is in your shell profile (`~/.zshrc` or `~/.bashrc`).
:::

### Structured Commands

```
/codex-audit              # Full 9-dimension audit of uncommitted changes
/codex-audit commit -3    # Audit last 3 commits
/codex-audit-mini         # Fast 5-dimension check for small changes
/codex-verify             # Verify fixes from a previous audit
/audit-fix                # Audit → fix → verify → repeat until clean
```

### Ad-hoc Help

If Claude is stuck on a problem, just say:

```
Summarize your trouble, and ask Codex for help.
```

Claude will formulate a question, send it to Codex via the MCP bridge, and incorporate the response.

## Private Overrides

Not everything belongs in the shared config. For personal preferences:

| File | Shared? | Purpose |
|------|---------|---------|
| `AGENTS.md` | Yes | Project rules for all AI tools |
| `CLAUDE.md` | Yes | Claude Code entry point |
| `.claude/settings.json` | Yes | Team-shared permissions |
| `CLAUDE.local.md` | **No** | Your personal instructions (gitignored) |
| `.claude/settings.local.json` | **No** | Your personal settings (gitignored) |

Create `CLAUDE.local.md` in the project root for instructions that only apply to you — preferred language, workflow habits, tool preferences.

## Getting Started

1. **Clone the repo** — AI config is already in place.
2. **Install your AI tool** — Claude Code, Codex CLI, or Gemini CLI.
3. **Open a session** — The tool reads `AGENTS.md` and the rules automatically.
4. **Start coding** — The AI knows the project conventions, testing requirements, and architecture patterns.

No extra setup needed. Just start asking your AI to help.

## Next Steps

- [Cross-Model Verification](/guide/users-as-developers/cross-model-verification) \u2014 How Claude + Codex audit each other for better code
- [Prompt Refinement](/guide/users-as-developers/prompt-refinement) \u2014 Why translating prompts to English improves AI coding
- [Subscription vs API Pricing](/guide/users-as-developers/subscription-vs-api) \u2014 Cost comparison for AI coding tools
- [MCP Setup](/guide/mcp-setup) \u2014 Connect AI assistants to VMark\u2019s editor
- [MCP Tools Reference](/guide/mcp-tools) \u2014 All 77 editor tools
