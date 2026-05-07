# 21 - Website Documentation Sync

When making changes that affect user-facing behavior, update the corresponding website documentation.

## Trigger Conditions

Update website docs when:

| Change Type | Website File to Update |
|-------------|------------------------|
| Add/modify keyboard shortcuts | `website/guide/shortcuts.md` |
| Add/modify features | `website/guide/features.md` |
| Change popup behavior | `website/guide/popups.md` |
| Change multi-cursor behavior | `website/guide/multi-cursor.md` |
| Add/modify MCP tools | `website/guide/mcp-tools.md` |
| Change MCP setup process | `website/guide/mcp-setup.md` |
| Add/modify Mermaid support | `website/guide/mermaid.md` |
| Change CJK formatting | `website/guide/cjk-formatting.md` |
| Change tab/window behavior | `website/guide/tab-navigation.md` |
| Change export/print behavior | `website/guide/export.md` |
| Change AI provider setup | `website/guide/ai-providers.md` |
| Change AI Genies feature | `website/guide/ai-genies.md` |
| Change terminal feature | `website/guide/terminal.md` |
| Change SVG handling | `website/guide/svg.md` |
| Change Markmap support | `website/guide/markmap.md` |
| Add/modify markdown lint rules | `website/guide/lint.md` |
| Change broken-link checking | `website/guide/link-check.md` |
| Change PTY / terminal pause | `website/guide/terminal.md` |
| Change workspace content search | `website/guide/workspace-management.md` |
| Add/modify AI suggestion UI | `website/guide/ai-genies.md` |
| Add/modify format adapter (registry / dispatch / new file type) | `website/guide/formats.md` |
| Change SplitPaneEditor behavior (source pane, validation gutter, split UX) | `website/guide/formats.md` |
| Change `formats.*` settings (toggles, externalEditor, upgrade nudge) | `website/guide/settings.md` (`Formats` section) + `website/guide/formats.md` |
| Change `open_in_external_editor` Tauri command | `website/guide/formats.md` (`Open in external editor`) |
| Add new release post / launch note | `website/blog/<YYYY-MM>-<slug>.md` + entry in `website/blog/index.md` |
| New major feature | Consider adding new guide page |

## File Mapping

| Source Code Area | Website Page |
|------------------|--------------|
| `src/stores/shortcutsStore.ts` | `website/guide/shortcuts.md` |
| `src-tauri/src/menu/` | `website/guide/shortcuts.md` |
| `src-tauri/src/mcp_bridge/`, `mcp_config/`, `mcp_server.rs` | `website/guide/mcp-tools.md` |
| Popup components | `website/guide/popups.md` |
| Multi-cursor hooks | `website/guide/multi-cursor.md` |
| `src/components/Tabs/` | `website/guide/tab-navigation.md` |
| `src/export/` | `website/guide/export.md` |
| `src-tauri/src/ai_provider/` | `website/guide/ai-providers.md` |
| `src/components/GeniePicker/` | `website/guide/ai-genies.md` |
| `src/components/Terminal/`, `src-tauri/src/pty.rs` | `website/guide/terminal.md` |
| `src/plugins/mermaid*/` | `website/guide/mermaid.md` |
| `src/lib/cjkFormatter/`, `src/plugins/toolbarActions/*Cjk*` | `website/guide/cjk-formatting.md` |
| `src/lib/lintEngine/`, `src/plugins/lint/` | `website/guide/lint.md` |
| `src/lib/markdownLinkCheck/` | `website/guide/link-check.md` |
| `src-tauri/src/content_search.rs` | `website/guide/workspace-management.md` (Workspace Content Search) |
| `src/plugins/aiSuggestion/`, `src/stores/aiSuggestionStore.ts` | `website/guide/ai-genies.md` (AI Suggestions section) |
| `src/lib/formats/` (registry + adapters) | `website/guide/formats.md` |
| `src/components/Editor/SplitPaneEditor/` | `website/guide/formats.md` |
| `src/pages/settings/FormatsSettings.tsx` | `website/guide/settings.md` (Formats section) |
| `src-tauri/src/external_editor.rs` | `website/guide/formats.md` (Open in external editor) |
| `src/hooks/useFormatsUpgradeNudge.ts` | `website/guide/settings.md` (Formats — One-time upgrade nudge) |
| `src/pages/settings/components.tsx` (SearchInput / FieldInput primitives) | No website doc — internal API. Keep `components.tsx` header comment as the source of truth for the decision rule. |

## Timestamp Handling

- Website uses **git-based lastUpdated** (configured in `.vitepress/config.ts`)
- Timestamps update automatically when files are committed
- No manual timestamp updates needed

## Update Process

1. Make the code change
2. Identify affected website page(s) from the mapping above
3. Update the relevant `.md` file in `website/guide/`
4. Commit code and docs together (or in the same PR)

## Verification

After updating website docs:
```bash
cd website && pnpm build
```

Check the built page shows correct content and updated timestamp.
