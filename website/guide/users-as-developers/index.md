# Users as Developers

In the age of AI coding tools, the line between "user" and "developer" is disappearing. If you can describe a bug, you can fix it. If you can imagine a feature, you can build it — with an AI assistant that already understands the codebase.

VMark embraces this philosophy. The repo ships with project rules, architecture docs, and conventions pre-loaded for AI coding tools. Clone the repo, open your AI assistant, and start contributing — the AI already knows how VMark works.

## Getting Started

1. **Clone the repo** — AI config is already in place.
2. **Install your AI tool** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli).
3. **Open a session** — The tool reads `AGENTS.md` and the rules automatically.
4. **Start coding** — The AI knows the project conventions, testing requirements, and architecture patterns.

No extra setup needed. Just start asking your AI to help.

## Reading Guide

New to AI-assisted development? These pages build on each other:

1. **[Why I Built VMark](/guide/users-as-developers/why-i-built-vmark)** — A non-programmer's journey from scripts to desktop app
2. **[Five Basic Human Skills That Supercharge AI](/guide/users-as-developers/what-are-indispensable)** — Git, TDD, terminal literacy, English, and taste — the foundations everything else builds on
3. **[Why Expensive Models Are Cheaper](/guide/users-as-developers/why-expensive-models-are-cheaper)** — Per-token price is a vanity metric; per-task cost is what matters
4. **[Subscription vs API Pricing](/guide/users-as-developers/subscription-vs-api)** — Why flat-rate subscriptions beat pay-per-token for coding sessions
5. **[English Prompts Work Better](/guide/users-as-developers/prompt-refinement)** — Translation, refinement, and the `::` hook
6. **[Cross-Model Verification](/guide/users-as-developers/cross-model-verification)** — Using Claude + Codex to audit each other for better code

Already familiar with the basics? Jump to [Cross-Model Verification](/guide/users-as-developers/cross-model-verification) for the advanced workflow, or read on for how VMark's AI setup works under the hood.

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
- **Gemini CLI** — Uses `@AGENTS.md` in `GEMINI.md` to inline the same file.

Update `AGENTS.md` once, every tool picks up the change.

::: tip What is `@AGENTS.md`?
The `@` prefix is a Claude Code directive that inlines another file's content. It's similar to `#include` in C — the contents of `AGENTS.md` are inserted into `CLAUDE.md` at that position. Learn more at [agents.md](https://agents.md/).
:::

## Using Codex as a Second Opinion

VMark uses cross-model verification — Claude writes the code, then Codex (a different AI model from OpenAI) audits it independently. This catches blind spots that a single model might miss. For full details and setup instructions, see [Cross-Model Verification](/guide/users-as-developers/cross-model-verification).

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
