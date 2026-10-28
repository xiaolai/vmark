# Contributing to VMark

## How to contribute: open an issue

**VMark takes issues, not pull requests.** The code is written by AI under the
maintainer's supervision, with the whole rule set, test suite and gate stack in
context. A change that arrives without that context cannot be merged safely,
so external pull requests are not merged.

What helps most:

- **A bug report** — [open one](https://github.com/xiaolai/vmark/issues/new?template=bug_report.yml)
  with steps to reproduce, what you expected, what happened, your VMark version
  and your operating system. A precise report is the contribution.
- **A feature request** — [open one](https://github.com/xiaolai/vmark/issues/new?template=feature_request.yml)
  describing the problem you are trying to solve.
- **A security problem** — report it privately; see [SECURITY.md](SECURITY.md).

The reasoning is on the website:
[Why Issues, Not PRs](https://vmark.app/guide/users-as-developers/why-issues-not-prs).

You are welcome to build VMark from source, read the code and run the tests;
the rest of this document is for that. It describes how the maintainer and the
AI agents work in this repository — the workflow a change goes through here,
not a path for submitting one.

For coding conventions, style rules and architectural patterns, see
[AGENTS.md](AGENTS.md) — this document covers setup and workflow.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Rust | stable, 1.89 or newer | Install via [rustup](https://rustup.rs/). The floor is `rust-version` in `src-tauri/Cargo.toml`; CI and releases build on current stable |
| Node.js | 22+ | LTS recommended |
| pnpm | 10.x (`>=10 <11`) | `corepack enable` picks the pinned version. `engines` is enforced (`engine-strict`), so pnpm 9 or 11 fails at install |
| Tauri v2 system deps | — | [Platform-specific prerequisites](https://v2.tauri.app/start/prerequisites/) |

That is enough to build and run VMark and to use `pnpm check:fast`. The full
gate and the release path need a few more programs. None of them is installed
by `pnpm install`, and the tests that use them **fail rather than skip** when
one is missing, so `pnpm check:all` cannot go green without them:

| Tool | Needed by | Why |
|------|-----------|-----|
| `zsh`, `bash`, `python3` | `pnpm test:gates` (inside `check:static`, so inside `check:all`) | `scripts/shell-integration-smoke.test.mjs` starts a real interactive zsh and bash under a pseudo-terminal (Python's `pty`) to prove the terminal's shell integration actually runs. macOS has all three; on Linux install `zsh` |
| [`tokei`](https://github.com/XAMPPRocky/tokei) | `pnpm test:gates`; `pnpm gen:feature-ledger` | `scripts/gen-feature-ledger.test.mjs` reproduces a line-count measurement against the real tool. `brew install tokei` or `cargo install tokei` |
| [`gh`](https://cli.github.com/), authenticated | pushing a `v*` tag | `.githooks/pre-push` runs `scripts/check-tag-green.sh`, which asks GitHub whether the required checks passed on the tagged commit. Without `gh` it refuses the push; `VMARK_OFFLINE_GATE=1` runs the full local gate instead |

`scripts/check-gates-tier-binaries.test.mjs` keeps the first two rows honest: a
program the gates tier executes must be installed by CI's `fe-static` job.

## Setup

```bash
git clone https://github.com/xiaolai/vmark.git
cd vmark
pnpm install

# Build the MCP sidecar once. Tauri bundles it as an external binary and it is
# a gitignored build artifact, so a fresh clone does not have it.
pnpm --dir server/mcp build:sidecar

pnpm tauri dev
```

The first build compiles the Rust backend — this takes a few minutes. Subsequent
builds are incremental and much faster. `pnpm tauri dev` checks for the sidecar
before it starts and tells you to build it if it is missing.

## Project Structure

```
vmark/
├── src/                  # React frontend (Vite + React 19)
│   ├── components/       # UI components
│   ├── plugins/          # Tiptap / ProseMirror plugins
│   ├── stores/           # Zustand state management
│   ├── styles/           # Global CSS and design tokens
│   ├── utils/            # Tier 1 — leaf-pure helpers (stdlib + other utils)
│   ├── services/         # Tier 2 — may use utils, stores, Tauri APIs
│   └── hooks/            # Tier 3 — React adapters over services
├── src-tauri/            # Rust backend (Tauri v2)
│   ├── src/              # Commands, menu, MCP bridge, AI providers
│   └── capabilities/     # Tauri security permissions
├── server/               # Node.js server packages
│   ├── mcp/              # MCP sidecar server
│   └── content/          # Content server (Slidev knowledge base)
├── website/              # Documentation site (VitePress)
├── e2e/                  # End-to-end harnesses that drive a live debug build
├── scripts/              # Gates (lint:*), their self-tests, build helpers
├── .claude/              # AI tool configuration, rules, decision records
└── dev-docs/             # Maintainer-local notes (gitignored; not in a clone)
```

`utils/` → `services/` → `hooks/` is the three-tier layout from
[ADR-013](.claude/adr/ADR-013-service-tier-as-cross-cutting-seam.md), and the
direction of the arrow is the rule: `utils/` must stay leaf-pure, so a file there
that needs `useXStore` or `@tauri-apps/*` belongs in `services/` instead. Only the
tiers are listed above — `src/` has other directories (`lib/`, `pages/`, `theme/`,
`locales/`, …) whose names say what they hold. See
[.claude/rules/00-engineering-principles.md](.claude/rules/00-engineering-principles.md).

## Development workflow (maintainer and AI agents)

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

# Inner loop: typecheck, lint, and the tests related to your diff
pnpm check:fast

# Before pushing: every static gate in parallel, all failures at once
pnpm check:predelta

# The final gate (about 15 minutes)
pnpm check:all
```

`pnpm check:all` runs the static gates, the full test suite with coverage, the
two server packages' tests, and a production build with its size limits. CI
runs the same groups as separate jobs, and `main` only accepts a commit whose
`frontend` and `rust` checks are green. Use `check:fast` while working and
`check:all` to confirm; the table in [AGENTS.md](AGENTS.md) says which narrower
command covers which kind of change.

### Environment variables

Read by the gates, hooks and harnesses. None is needed for a normal build.

| Variable | Read by | Effect |
|----------|---------|--------|
| `VMARK_CHANGED_BASE` | `scripts/test-changed.mjs` (`pnpm test:changed`, `pnpm check:fast`) | The ref the diff is taken against. Default `origin/main` — `git fetch` first, or the selection is stale |
| `VMARK_OFFLINE_GATE=1` | `.githooks/pre-push` | Run the full local gate (cross-target check, `cargo fmt`, `cargo clippy`, `pnpm check:all`) instead of asking GitHub for CI's verdict. For when `gh` or the network is unavailable |
| `VMARK_GH_TIMEOUT` | `scripts/check-tag-green.sh` | Seconds to wait for the `gh api` call before failing closed. Default `30` |
| `VMARK_UI_PHASE_NO_DEVDOCS=1` | `scripts/check-ui-phase.sh` | Skip the assertions that read fixtures under the maintainer-local `dev-docs/`. They are skipped anyway where `dev-docs/README.md` is absent; the variable forces it |
| `VMARK_APP_IDENTIFIER` | the MCP sidecar, `e2e/lib/vmarkMcp.mjs` | Which app's `mcp-port` file to read. `app.vmark.dev` reaches a `tauri dev` build |
| `VMARK_REAL_IME=1` | `e2e/run-ime.mjs` (`pnpm e2e:ime`) | Opt-in for the real-IME run, which injects keystrokes system-wide; it refuses without it. Dedicated, unattended macOS machine only |
| `VMARK_IME_PROFILE` | `e2e/run-ime.mjs` | Path to the machine profile that run requires. Default `.vmark/ime-machine-profile.json` |
| `VMARK_DEBUG_JOURNAL_REGISTER_PAUSE_MS` | `src-tauri/src/agent_journal/debug_pause.rs` (debug builds only) | Milliseconds to hold each successful page-registration reply after Rust has registered the page, so a native check can reload during the hold. Absent, zero or unparsable is no pause; capped at 30 s. A release build never calls the hook: its call site compiles only under `debug_assertions` |

The E2E harnesses and the dev-app identity are described in
[e2e/README.md](e2e/README.md).

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

## Before a change lands

`main` is protected: every change, the maintainer's included, goes through a
pull request whose required checks pass. Before opening one, the maintainer or
the agent verifies:

- [ ] `pnpm check:all` passes (static gates + tests + build)
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes (if Rust changed)
- [ ] New behavior has tests (RED first)
- [ ] No hardcoded English strings in UI — i18n keys used
- [ ] Diff is focused — no drive-by refactors
- [ ] No new lint warnings
- [ ] Documentation updated if user-facing behavior changed
  (see [.claude/rules/21-website-docs.md](.claude/rules/21-website-docs.md))

## Architecture

For a deeper understanding of the codebase:

- **Feature inventory:** [.claude/feature-ledger.md](.claude/feature-ledger.md)
  — every shipped feature, the files that implement it and the gate that holds it
- **Design decisions:** [.claude/adr/](.claude/adr/README.md) — the decision
  records that rules and comments cite by id (Markdown as source of truth, MCP
  sidecar architecture, the three-tier layout, etc.), each with what enforces it
- **Design system:** `.claude/rules/31-design-tokens.md` — complete token
  reference

## AI-Assisted Development

VMark's AI tool configuration is checked into the repo so every session, on
any machine, starts from the same context. You do **not** need any AI tool to
build VMark or to read the code.

### `AGENTS.md` is the single source of truth

Different tools read different entry points, and maintaining the same
instructions in each is how they drift apart. So the rules are written once:

| Tool | Reads | How it reaches `AGENTS.md` |
|------|-------|----------------------------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `CLAUDE.md` + `.claude/rules/*.md` | `CLAUDE.md` contains `@AGENTS.md`, which inlines it |
| [Codex CLI](https://github.com/openai/codex) | `AGENTS.md` | directly |

Update `AGENTS.md` and every tool picks up the change.

### Private vs shared

| File | In git? | Purpose |
|------|---------|---------|
| `AGENTS.md`, `CLAUDE.md` | Yes | Shared instructions and entry point |
| `.claude/rules/`, `.claude/adr/`, `.claude/agents/`, `.claude/skills/` | Yes | Rules, decision records, agents, skills — see [.claude/README.md](.claude/README.md) |
| `.claude/settings.json` | Yes | Shared settings: hooks and enabled plugins |
| `CLAUDE.local.md` | **No** | Personal overrides (gitignored) |
| `.claude/settings.local.json` | **No** | Personal settings (gitignored) |
| `dev-docs/`, `.vmark/` | **No** | Maintainer-local, not in the public repo |

Personal instructions that should not be shared go in `CLAUDE.local.md`.

### If you don't use AI tools

`.claude/rules/` doubles as living documentation of project conventions — it is
the most precise description of how this codebase works. Worth reading before
you dig into the code:

1. [AGENTS.md](AGENTS.md) — project overview and conventions
2. [.claude/rules/10-tdd.md](.claude/rules/10-tdd.md) — testing requirements
3. [.claude/rules/50-codebase-conventions.md](.claude/rules/50-codebase-conventions.md) — store, hook, plugin, and import patterns

## Getting help

Open an issue if you have a question or want to discuss a feature. For bug
reports, include steps to reproduce, expected behavior, your VMark version and
your OS version.
