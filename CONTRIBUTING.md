# Contributing to VMark

Thanks for helping improve VMark.

## Core Rules (Read First)

1. Detailed bug description before direct code improvement.
2. Every PR must have 100% test coverage for changed behavior and changed code paths.
3. Every PR must be single-focus.

## Why These Rules Are Crucial

### 1) Detailed bug reports prevent fake fixes

VMark is a vibe-coded codebase. In this environment, a direct code patch from another vibe-coding pass can fix symptoms while introducing hidden regressions.

Detailed bug reports force evidence first:

1. Environment details.
2. Reproduction steps.
3. Expected behavior vs actual behavior.
4. Logs, screenshots, or minimal repro.

This lets maintainers fix root cause, not just surface behavior.

### 2) 100% test coverage is the safety contract

When implementation speed is high, tests become the only reliable specification. Requiring complete coverage for every changed behavior and changed code path is how we prevent silent breakage and preserve long-term velocity.

If a PR cannot prove behavior with tests, review can pause until coverage is complete.

### 3) Single-focus PRs keep review and rollback safe

Single-focus PRs are easier to understand, verify, and merge. They reduce review load, reduce merge conflicts, and allow safe rollback when needed.

Multi-purpose PRs are hard to review and often hide risk. Keep each PR to one objective.

## Before You Open an Issue

1. Search existing issues first and avoid duplicates.
2. Use one issue per bug or feature request.
3. Include enough context so maintainers can triage quickly.

## Reporting Bugs

Use the Bug Report template and include:

1. Environment details: OS, VMark version/commit, install method.
2. Exact steps to reproduce.
3. Expected behavior vs. actual behavior.
4. Logs, screenshots, or a minimal repro when possible.

## Requesting Features

Use the Feature Request template and include:

1. The user problem you want to solve.
2. Proposed behavior.
3. Alternatives considered and tradeoffs.
4. Any mockups or examples that clarify the request.

## Development Setup

```bash
git clone https://github.com/xiaolai/vmark.git
cd vmark
pnpm install
pnpm tauri:dev
```

## Pull Request Guidelines

1. Link the related issue (`Fixes #123`) whenever possible.
2. Keep PRs focused and small. One PR should solve one problem.
3. Add or update tests so changed behavior and changed code paths are fully covered.
4. Run all local checks before opening/updating the PR:

```bash
pnpm check:all
```

5. For UI changes, attach screenshots or a short video.
6. Update docs/changelog when behavior or usage changes.
7. Avoid unrelated refactors or formatting-only churn in functional PRs.
8. For bug-fix PRs, ensure the linked issue has full reproduction context.

## AI Tooling

VMark's repo is pre-configured for AI coding tools. If you use Claude Code, Codex CLI, or Gemini CLI, the AI already knows the project conventions, testing requirements, and architecture patterns.

- **`AGENTS.md`** — Shared instructions for all AI tools (single source of truth)
- **`.claude/`** — Rules, slash commands, skills, and subagent definitions
- **`.mcp.json`** — Registers Codex MCP for cross-model code auditing

For setup details (Codex CLI installation, API keys, available slash commands), see:
- [`.claude/README.md`](.claude/README.md) — Developer guide for the AI config
- [Users as Developers](https://vmark.app/guide/users-as-developers) — Website guide

## Review Expectations

1. Draft PRs are welcome for early feedback.
2. Be responsive to review comments.
3. Large PRs may be requested to split for easier review.
