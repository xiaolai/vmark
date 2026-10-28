# .claude/ — AI Development Configuration

Configuration for AI coding tools — primarily [Claude Code](https://docs.anthropic.com/en/docs/claude-code). The instructions every tool shares are in `AGENTS.md` at the repository root; this directory holds what Claude Code loads on top of that, plus the project records other tools read too (decision records, tracked plans, the feature ledger).

Nothing here is needed to build or run VMark.

## Directory structure

```
.claude/
├── README.md              # This file
├── settings.json          # Shared settings: hooks and enabled plugins (checked in)
├── settings.local.json    # Personal settings (gitignored)
├── rules/                 # Project rules, loaded when a matching path is touched
├── hooks/                 # PreToolUse guards wired in settings.json, with their tests
├── adr/                   # Architecture decision records, cited by id across the repo
├── tdd-guardian/          # tdd-guardian config and state, and the tracked plans
├── docs-guardian/         # docs-guardian config (code-to-doc mappings)
├── plugins/               # Repo-local plugin marketplace (vmark-lsp)
├── commands/              # Project slash commands
├── skills/                # Skills loaded on demand
├── agents/                # Subagent definitions for /feature-workflow
├── feature-ledger.md      # Inventory of shipped features, joined to scripts/feature-map.json
└── loc-guardian.local.md  # File-size limit and extraction rules for the loc-guardian plugin
```

## Settings

| File | Shared? | Purpose |
|------|---------|---------|
| `settings.json` | Yes | The two `PreToolUse` hooks and `enabledPlugins`. Its `permissions.allow` list is empty on purpose |
| `settings.local.json` | **No** (gitignored) | Personal permissions and tool approvals; it grows as you approve tool calls |

## Hooks (`hooks/`)

`settings.json` runs two guards before every `Write`, `Edit`, `MultiEdit` or `NotebookEdit`. Each blocks an edit to a production file in its scope when that file has no test beside it, so the test is written first:

| Hook | Scope |
|------|-------|
| `gha-tdd-guard.mjs` | The GitHub Actions workflow viewer, the workflow engine's frontend, the embedded browser and site plugins, and the MCP browser handlers; the exact paths are in its header |
| `multi-format-tdd-guard.mjs` | The format registry, the split-pane editor, and the file open / save paths listed in its header |

Each has a self-test (`*.test.mjs`) that runs in the gates tier (`pnpm test:gates`). The scopes are described in `rules/60-ai-governance.md`.

## Rules (`rules/`)

A rule with `paths:` frontmatter loads only when Claude Code touches a matching file; one without `paths:` loads in every session. `AGENTS.md` is the only file Codex and Gemini read, so it repeats the load-bearing points on purpose. Several rules are enforced by a gate; `AGENTS.md` names which.

| File | Scope |
|------|-------|
| `00-engineering-principles.md` | Core working agreement |
| `10-tdd.md` | TDD workflow, where tests are required, test patterns |
| `21-website-docs.md` | Which code changes require a website docs change |
| `22-comment-maintenance.md` | Keep header and doc comments in sync with the code |
| `30-ui-consistency.md` | UI design principles |
| `31-design-tokens.md` | CSS token reference |
| `32-component-patterns.md` | Popup, toolbar, menu patterns |
| `33-focus-indicators.md` | Focus visibility rules |
| `34-dark-theme.md` | Dark theme rules |
| `35-copy-conventions.md` | UI copy: wording, punctuation, what never appears in user-facing text |
| `40-version-bump.md` | Five-file version bump procedure |
| `41-keyboard-shortcuts.md` | Three-file shortcut sync procedure |
| `50-codebase-conventions.md` | Store, hook, plugin, MCP bridge, Rust command conventions |
| `60-ai-governance.md` | Plans, work-item ids, cross-model review, the guarded paths, branch protection |

## Decision records (`adr/`)

The records behind every `ADR-…` id cited in rules, comments and docs. Start at [`adr/README.md`](adr/README.md): it explains the two id spaces (repository-wide `ADR-NNN`, and ids local to one plan) and indexes both. `pnpm lint:adr-refs` fails when a tracked file cites an id with no record.

## Plans and state (`tdd-guardian/`)

`config.json` and `state.json` belong to the `tdd-guardian` plugin. The Markdown files are plans, test designs and audit findings that are tracked because CI or the history has to see them; other plans are maintainer-local under `dev-docs/plans/`. `rules/60-ai-governance.md` says which home a plan belongs in.

## Plugins

`settings.json` → `enabledPlugins`:

| Plugin | Source | Purpose |
|--------|--------|---------|
| `tdd-guardian` | `@xiaolai` | TDD orchestration and coverage gates |
| `docs-guardian` | `@xiaolai` | Documentation staleness, accuracy and coverage audits (configured by `docs-guardian/config.json`) |
| `claude-english-buddy` | `@xiaolai` | English review and correction |
| `frontend-design` | `@claude-plugins-official` | Frontend UI design guidance |
| `rust-analyzer-lsp` | `@claude-plugins-official` | Rust language server |
| `typescript-lsp` | `@claude-plugins-official` | TypeScript language server |
| `vmark-lsp` | `@vmark-local` (`plugins/`) | Language servers for YAML, CSS and JSON, which no marketplace covers; see `plugins/vmark-lsp/README.md` |

Not enabled here, but used by the maintainer and referenced by the rules: **`cc-suite`**, which sends plans and audits to OpenAI's Codex as a second model (`rules/60-ai-governance.md` requires that review for large plans). It is installed at user level, not through this repository's settings, and it does not register an MCP server in `.mcp.json`. If you install it, `.cc-suite.md` at the repository root holds its project settings and `.cc-suite/audits/` its past findings.

## Slash commands (`commands/`)

| Command | Purpose |
|---------|---------|
| `/bump` | Version bump across all five files, landed through a PR, then tagged |
| `/feature-workflow` | Gated workflow driven by the subagents below |
| `/fix` | Root-cause bug fixing with TDD |
| `/fix-issue` | End-to-end GitHub issue resolver (fetch, branch, fix, audit, PR) |
| `/merge-prs` | Review and merge open PRs one at a time |
| `/repo-clean-up` | Remove failed GitHub Actions runs and stale remote branches |
| `/test-guide` | Generate a manual testing guide |

## Skills (`skills/`)

| Skill | When used |
|-------|-----------|
| `css-design-tdd` | CSS token changes and audits |
| `mcp-dev` | MCP tools, the bridge, and registering MCP servers |
| `planning` / `plan-audit` | Writing a plan; auditing or verifying an implementation against it |
| `react-app-dev` | React UI changes (components, hooks, stores) |
| `rust-tauri-backend` | Rust/Tauri backend: commands, IPC bridges, menus, plugins |
| `tauri-mcp-testing` | E2E testing through Tauri MCP, and when to use VMark MCP |
| `tiptap-dev` | Tiptap and ProseMirror editor work |
| `translate-docs` | Translating VMark docs and strings into the nine other locales |
| `workflow-audit` | Auditing GitHub Actions workflows |

## Agents (`agents/`)

Project subagents. `planner`, `implementer` and `verifier` are deliberately not defined here: a project agent overrides a user-level one of the same name, and the maintainer's user-level versions carry the model and effort routing.

| Agent | Role |
|-------|------|
| `auditor` | Reviews the diff for logic, duplication and rule compliance |
| `test-runner` | Runs unit tests and E2E flows |
| `spec-guardian` | Validates planned work against specs and rules |
| `impact-analyst` | Finds the smallest correct change set |
| `release-steward` | Commit messages and release notes |
| `manual-test-author` | Maintains manual testing guides |

## Related files (repository root)

| File | Purpose |
|------|---------|
| `AGENTS.md` | The shared instructions for every AI tool |
| `CLAUDE.md` | Claude Code entry point; it inlines `AGENTS.md` |
| `CLAUDE.local.md` | Personal instructions (gitignored) |
| `.mcp.json` | Project MCP servers. It registers one: `tauri` (`@hypothesi/tauri-mcp-server`), for driving a debug build. Never add Chrome DevTools here — VMark is a Tauri app; see `AGENTS.md` |
| `.codex/` | Codex CLI configuration for this repository |
| `.cc-suite.md` | Project settings for the optional `cc-suite` plugin |
