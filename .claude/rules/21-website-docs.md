---
paths:
  - "src/**"
  - "src-tauri/src/**"
  - "website/**"
---

# 21 - Website Documentation Sync

When making changes that affect user-facing behavior, update the corresponding website documentation.

## What to update

One row per area: a change to the source, or of the kind described, updates
the page (and section) beside it. A new major feature may deserve a new guide
page; a release post goes to `website/blog/<YYYY-MM>-<slug>.md` with an entry in
`website/blog/index.md`.

| Source, or kind of change | Website page (section) |
|---------------------------|------------------------|
| `src/stores/settingsStore/shortcuts.ts`, `src-tauri/src/menu/` — any shortcut | `website/guide/shortcuts.md` |
| An action's mode support (e.g. Source-only line sorting) | `website/guide/shortcuts.md` (F-Key Quick Reference + the action's section) |
| A user-visible feature without its own page | `website/guide/features.md` |
| `src/components/StatusBar/` | `website/guide/features.md` (Status Bar) |
| `src/plugins/compositionGuard/`, `src/utils/imeGuard.ts`, `src/services/ime/`, `src/utils/motion.ts`, `src/plugins/inactiveSelection/`, `src/plugins/inlineCodeBoundary/` | `website/guide/features.md` (Editing Details) |
| `src/services/fonts/verifiedMonoStack.ts` | `website/guide/features.md` (Fonts) |
| Popup plugins (`src/plugins/*Popup/`) | `website/guide/popups.md` |
| `src/plugins/codemirror/sourceImagePreview.ts` — Source-mode media preview | `website/guide/popups.md` (Media Popup → Source Mode) |
| `src/plugins/multiCursor/` | `website/guide/multi-cursor.md` |
| `src/components/Comments/`, `src/components/McpHistory/` — edit checkpoints, review, concurrent pairs, comments | `website/guide/mcp-setup.md` (Edit Checkpoints) |
| `src-tauri/src/mcp_bridge/`, `src-tauri/src/mcp_config/`, `src/services/mcpBridge/v2/`, `server/mcp/src/tools/` — tools, arguments, results, refusal reasons | `website/guide/mcp-tools.md` + `server/mcp/README.md` |
| MCP setup process; `src-tauri/src/mcp_config/client_tokens.rs`, `client_token_field.rs`, `src-tauri/src/mcp_bridge/principal.rs` (`VMARK_MCP_TOKEN`) | `website/guide/mcp-setup.md` (Install Configuration, Security Notes) |
| `src/plugins/mermaid/`, `src/plugins/mermaidPreview/` | `website/guide/mermaid.md` |
| `src/plugins/markmap/` | `website/guide/markmap.md` |
| `src/plugins/svg/` | `website/guide/svg.md` |
| `src/utils/svgSanitize.ts`, `src/utils/svgStylesheetScope.ts` | `website/guide/svg.md` (Security) |
| `src/lib/cjkFormatter/`, `src/plugins/toolbarActions/*Cjk*` | `website/guide/cjk-formatting.md` |
| `src/components/Tabs/`, `src/services/tabs/` | `website/guide/tab-navigation.md` |
| Tab context menu, pinning; `src/components/TitleBar/useTitleBarRename.ts` | `website/guide/tab-navigation.md` (The tab context menu, Pinned tabs, Renaming a file) |
| `src/services/windowClose/`, `src-tauri/src/quit.rs` — save-on-close, quit confirmation, pinned-tabs close guard | `website/guide/tab-navigation.md` (Closing tabs and windows) |
| `src/export/` — export and print | `website/guide/export.md` |
| `src-tauri/src/ai_provider/` | `website/guide/ai-providers.md` |
| `src/components/GeniePicker/` | `website/guide/ai-genies.md` |
| `src/plugins/aiSuggestion/`, `src/stores/aiStore/suggestion.ts` | `website/guide/ai-genies.md` (AI Suggestions) |
| `src/stores/aiStore/promptHistory.ts`, `src/components/GeniePicker/PromptHistoryDropdown.tsx` | `website/guide/ai-genies.md` (The Genie Picker) |
| `src/components/Terminal/`, `src-tauri/src/pty.rs` — including PTY pause | `website/guide/terminal.md` |
| `src-tauri/src/pty/child.rs`, `src-tauri/src/pty/spawn_policy.rs`, `src-tauri/src/shell_env.rs` | `website/guide/terminal.md` (Sessions, Shell Environment) + `website/guide/settings.md` (Terminal → Shell) |
| `src/components/Browser/`, `src-tauri/src/browser/`, `src/services/commands/browserCommands.ts` | `website/guide/browser.md` |
| `src/lib/browser/omnibox.ts` — start page, search engine, omnibox | `website/guide/browser.md` (Using it) |
| `src/lib/lintEngine/`, `src/plugins/lint/` | `website/guide/lint.md` |
| `src/lib/markdownLinkCheck/` | `website/guide/link-check.md` |
| `src-tauri/src/content_search.rs` | `website/guide/workspace-management.md` (Workspace Content Search) |
| `src/components/WorkspaceRail/`, `src/services/workspaces/` (instances, switch, close/move, per-workspace terminal scoping) | `website/guide/workspace-rail.md` |
| `src/lib/formats/` (registry, dispatch, adapters), `src/components/Editor/SplitPaneEditor/` | `website/guide/formats.md` |
| `src/pages/settings/FormatsSettings.tsx` — `formats.*` settings | `website/guide/settings.md` (Formats) + `website/guide/formats.md` |
| `src/hooks/useFormatsUpgradeNudge.ts` | `website/guide/settings.md` (Formats — One-time upgrade nudge) |
| `src-tauri/src/external_editor.rs` — `open_in_external_editor` | `website/guide/formats.md` (Open in external editor) |
| `src-tauri/src/external_editor/` — override validation | `website/guide/formats.md` (Security gate) + `website/guide/settings.md` (External editor) |
| `src/utils/markdownPipeline/` — dialect, remark plugins, `nestingDepth.ts` | `website/guide/formats.md` (Markdown dialect) + `website/guide/large-files.md` |
| `src-tauri/tauri.conf.json` (`fileAssociations`), `src-tauri/windows/installer-hooks.nsh` | `website/guide/formats.md` (Opening files from your system) |
| `src-tauri/src/workflow/` (`condition*.rs`, `step_preflight.rs`, `state.rs`), `src/components/Editor/WorkflowPanel/` | `website/guide/workflows.md` (Conditions, Running a workflow, Execution flow diagram) |
| `src/services/commands/claimCommands.ts` — how the Claims panel opens | `website/guide/coherence.md` |
| `.github/workflows/tier0-e2e.yml`, `e2e/run-journeys.mjs` | `e2e/README.md` (Prerequisites, CI) |
| `src/pages/settings/components.tsx` (SearchInput / FieldInput primitives) | None — internal API; its header comment is the source of truth |

## Timestamp Handling

- Website uses **git-based lastUpdated** (configured in `.vitepress/config.ts`)
- Timestamps update automatically when files are committed
- No manual timestamp updates needed

## Update Process

1. Make the code change
2. Identify affected website page(s) from the table above
3. Update the relevant `.md` file in `website/guide/`
4. Carry the change into every `website/<locale>/guide/` page (the `translate-docs` skill). `pnpm lint:doc-joins` fails when a locale page's headings, tables, code blocks, Mermaid diagrams or `:::` containers stop matching English (`locale-structure`), and when a guide sentence that states a constant, a name or a list stops matching the code (`guide-claims`, table in `scripts/lib/docJoins/guideClaimsTable.mjs` — add a claim there when you write a new checkable one)
5. Commit code and docs together (or in the same PR)

## Verification

After updating website docs:
```bash
cd website && pnpm build
```

Check the built page shows correct content and updated timestamp.
