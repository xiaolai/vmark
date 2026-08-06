# Contributing to VMark

Thank you for your interest in contributing to VMark. This guide covers the
essentials for getting started, making changes, and submitting pull requests.

For coding conventions, style rules, and architectural patterns, see
[AGENTS.md](AGENTS.md) — this document focuses on workflow and setup.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Rust | stable | Install via [rustup](https://rustup.rs/) |
| Node.js | 22+ | LTS recommended |
| pnpm | 10+ | `corepack enable` or `npm install -g pnpm` |
| Tauri v2 system deps | — | [Platform-specific prerequisites](https://v2.tauri.app/start/prerequisites/) |

## Setup

```bash
git clone https://github.com/xiaolai/vmark.git
cd vmark
pnpm install
pnpm tauri dev
```

The first build compiles the Rust backend — this takes a few minutes. Subsequent
builds are incremental and much faster.

## Project Structure

```
vmark/
├── src/                  # React frontend (Vite + React 19)
│   ├── components/       # UI components
│   ├── hooks/            # Custom React hooks
│   ├── plugins/          # Tiptap / ProseMirror plugins
│   ├── stores/           # Zustand state management
│   ├── styles/           # Global CSS and design tokens
│   └── utils/            # Pure helper functions
├── src-tauri/            # Rust backend (Tauri v2)
│   ├── src/              # Commands, menu, MCP bridge, AI providers
│   └── capabilities/     # Tauri security permissions
├── server/               # Node.js server packages
│   ├── mcp/              # MCP sidecar server
│   └── content/          # Content server (Slidev knowledge base)
├── website/              # Documentation site (VitePress)
└── dev-docs/             # Internal architecture docs (local only)
```

## Development Workflow

### Test-Driven Development (Mandatory)

All new behavior must follow the RED-GREEN-REFACTOR cycle:

1. **RED** — Write a failing test that describes expected behavior.
2. **GREEN** — Write the minimum code to make it pass.
3. **REFACTOR** — Clean up without changing behavior.

See [.claude/rules/10-tdd.md](.claude/rules/10-tdd.md) for the full TDD policy,
pattern catalog, and anti-patterns.

**Exceptions:** CSS-only changes, documentation, and config files do not require
tests.

### Running Tests

```bash
# Frontend tests
pnpm test              # Run once
pnpm test:watch        # Watch mode (use during development)
pnpm test:coverage     # With coverage report

# Rust tests
cargo test --manifest-path src-tauri/Cargo.toml

# Full gate — run before pushing
pnpm check:all
```

`pnpm check:all` runs linting, coverage checks, and a production build. Your PR
will not pass review if this command fails.

### Internationalization (i18n)

All user-facing strings must use translation functions — never hardcode English
in UI code.

- **React:** `t("key.name")` via react-i18next
- **Rust:** `t!("key.name")` via rust-i18n
- **Keys:** Flat dot-separated camelCase (e.g., `sidebar.newFile`)
- **New strings:** Add to `src/locales/en/*.json` (React) or
  `src-tauri/locales/en.yml` (Rust)

### Keyboard Shortcuts

Shortcut changes require updating three files in sync. See
[.claude/rules/41-keyboard-shortcuts.md](.claude/rules/41-keyboard-shortcuts.md)
for the procedure and format differences.

## Code Style

Follow the conventions in [AGENTS.md](AGENTS.md). Key points:

- Keep files under ~300 lines — split proactively.
- Use Zustand selectors in components; prefer `getState()` in callbacks.
- Keep features local — avoid cross-feature imports unless truly shared.
- Use CSS design tokens — never hardcode colors. Source of truth:
  `src/styles/index.css`.
- macOS is the primary platform. Never break macOS to fix Windows/Linux.

## Pull Request Checklist

Before submitting a PR, verify:

- [ ] `pnpm check:all` passes (lint + tests + build)
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes (if Rust changed)
- [ ] New behavior has tests (RED first)
- [ ] No hardcoded English strings in UI — i18n keys used
- [ ] Diff is focused — no drive-by refactors
- [ ] No new lint warnings
- [ ] Documentation updated if user-facing behavior changed
  (see [.claude/rules/21-website-docs.md](.claude/rules/21-website-docs.md))

## Architecture

For a deeper understanding of the codebase:

- **Architecture overview:** `dev-docs/architecture.md` — C4 diagrams, entry
  points, data flows, and module map
- **Design decisions:** `dev-docs/decisions/` — ADRs explaining key choices
  (Markdown as source of truth, MCP sidecar architecture, Tiptap over
  Milkdown, etc.)
- **Design system:** `.claude/rules/31-design-tokens.md` — complete token
  reference

## Getting Help

Open an issue if you have questions or want to discuss a feature before
implementing it. For bug reports, include steps to reproduce, expected behavior,
and your OS version.
