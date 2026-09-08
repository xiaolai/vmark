/**
 * WI-FL0.10 — DoD checker self-test for the feature-ledger fixes plan.
 *
 * Runs the REAL `scripts/check-feature-ledger-phase.sh` as a subprocess against
 * FIXTURE repo trees in tmpdir (house pattern from check-followups-phase.test.mjs:
 * real script, real fs, no in-process mocks). The script takes `--root=<dir>`
 * so both directions can be proven for EVERY phase — a checker only ever run
 * against the working tree has only ever been proven to say yes — and
 * `--no-exec` so a fixture that cannot run a gate still exercises the rest.
 *
 * Pinned semantics:
 *   - no phase / unknown phase -> exit 64 (bad invocation), never 0 or 1;
 *   - a phase whose deliverables are absent exits NON-ZERO and names them;
 *   - a phase whose deliverables are all present exits 0 (fixture-satisfiable
 *     phases; phase 0 and 1 carry `assert_exec` gates that report UNVERIFIED
 *     under --no-exec and therefore stay non-zero — that is the contract: a
 *     behavioural assertion that did not run is not a pass);
 *   - a NEAR-MISS (test file present but not discovered, decision line absent,
 *     evidence line absent) stays non-zero — presence is not the property;
 *   - `all` exits 0 only when every phase does.
 *
 * @coordinates-with dev-docs/plans/20260907-feature-ledger-fixes.md — the phases asserted
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-feature-ledger-phase.sh");
const PLAN = "dev-docs/plans/20260907-feature-ledger-fixes.md";
const RULE60 = ".claude/rules/60-ai-governance.md";

function run(root, ...args) {
  return spawnSync("bash", [SCRIPT, ...args, `--root=${root}`, "--no-exec"], { encoding: "utf8", cwd: REPO });
}
function write(root, rel, body = "placeholder\n") {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}
function rm(root, rel) { rmSync(path.join(root, rel), { force: true }); }
const TS_TEST = 'import { it } from "vitest";\nit("pins", () => {});\n';
/** A journey module shaped the way e2e/run-journeys.mjs discovers one. */
const JOURNEY = 'export default {\n  name: "fixture-journey",\n  async run(client, ctx) {},\n};\n';
/**
 * A Rust test file, the sibling module that includes it, AND the `mod` line
 * that puts that module in the crate — what cargo actually runs. An
 * undeclared `.rs` file is not compiled, so the include inside it reaches
 * nothing (audit R2 #46).
 */
function rustTest(root, testRel, { declare = true } = {}) {
  const modRel = testRel.replace(/\.test\.rs$/, ".rs");
  write(root, testRel, "#[test]\nfn pins() {}\n");
  write(root, modRel, `#[cfg(test)]\n#[path = "${path.basename(testRel)}"]\nmod tests;\n`);
  if (!declare) return;
  const dir = path.dirname(modRel);
  const stem = path.basename(modRel, ".rs");
  const parent = dir === "src-tauri/src" ? `${dir}/lib.rs` : `${dir}/mod.rs`;
  const existing = existsSync(path.join(root, parent)) ? readFileSync(path.join(root, parent), "utf8") : "";
  if (!new RegExp(`(^|[^A-Za-z0-9_])mod\\s+${stem}\\s*;`).test(existing)) {
    write(root, parent, `${existing}pub mod ${stem};\n`);
  }
}

/** Today's tree, in miniature: every stale phrase present, every deliverable absent. */
function emptyRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "fl-dod-"));
  write(root, "package.json", '{"scripts":{"check:static":"pnpm lint"}}\n');
  write(root, PLAN, "# plan\n");
  write(root, RULE60, "(`src/plugins/workflowPreview/WorkflowPreview.tsx` still has\nno test)\n");
  write(root, "scripts/baselineRatchetManifest.mjs", "export const MANIFEST = [];\n");
  write(root, "README.md", "Supported: Claude Desktop, Claude Code, Codex CLI, Gemini CLI.\n122 Shortcuts\n");
  write(root, "website/guide/lint.md", "| **E06** | Error | Unclosed fenced code block |\n| **E08** | Error | Empty link `href` |\n| **W05** | Warning | Empty link text |\n`Cmd + Shift + L`\n");
  write(root, "website/guide/settings.md", "| Mac Option as Meta (terminal) | desc | Off | macOS |\nThe Advanced section is hidden by default\nThe viewer switch adds the source-pane extras\n| Auto-hide status bar | desc | Off |\n");
  write(root, "website/guide/export.md", "### Folder Mode (Default)\n### Single File Mode\n");
  write(root, "website/guide/features.md", "- Resize via context menu\n");
  write(root, "website/guide/ai-genies.md", "menu **Tools > AI Genies**\n");
  write(root, "website/guide/ai-providers.md", "stored in memory only, never written to disk\nstored in the app data directory\n");
  write(root, "website/guide/privacy.md", "No other network calls exist in the codebase\n");
  write(root, "website/guide/mcp-setup.md", "Access via **Help → MCP Server Status**\n");
  write(root, "website/guide/workspace-management.md", "| Open content search panel | `Mod + Shift + F` |\nGo to **Help > Install 'vmark' Command**.\n");
  write(root, "website/guide/shortcuts.md", "It is greyed out until you enable the embedded browser\n");
  write(root, "website/guide/terminal.md", "## Keyboard Shortcuts\n");
  write(root, "website/guide/index.md", "- **Tools**: Text cleanup\n");
  write(root, "website/guide/workflow-viewer.md", "it runs automatically when the binary is on your PATH\n");
  write(root, "website/guide/workflows.md", "mirrors the `outline-and-polish.yml` sample\n");
  write(root, "website/guide/knowledge-base.md", "only\ntrusted workspaces are served.\n");
  write(root, "website/guide/coherence.md", "# Coherence\n");
  write(root, "website/guide/cjk-formatting.md", "| 0.05em | Normal |\n");
  write(root, "website/guide/link-check.md", "underlined with a red squiggle\n");
  write(root, "e2e/README.md", "35 user journeys\n");
  write(root, "src/stores/settingsStore/defaults.ts", "port: 9223,\nautoHideStatusBar: false,\nworkflowViewer: false,\n");
  write(root, "src/stores/settingsStore/migrations.ts", "export function migrateSplitWorkflowFlags() {}\n");
  write(root, "src/stores/settingsStore/shortcutDefinitions.ts", "insertTable\n");
  write(root, "src/hooks/useMcpAutoStart.ts", 'invoke("mcp_bridge_start", { port: mcpServer.port })\n');
  write(root, "src/services/assembly/workflowExtensionGates.ts", "viewer: yaml && isWorkflowViewerEnabled(),\n");
  write(root, "src/locales/en/settings.json", '{"advanced.mcpServer.autoApproveEdits.label":"Auto-approve edits"}\n');
  write(root, "src-tauri/src/command_registry.rs", "window_manager::request_quit,\nfile_tree::list_directory_entries,\ncoherence::coherence_operator_propose,\ncoherence::coherence_merge_audit,\n");
  write(root, "src-tauri/src/menu/localized/file_menu.rs", "// file menu\n");
  write(root, "src-tauri/src/menu/localized/insert_menu.rs", "// insert menu\n");
  write(root, "src-tauri/src/menu/localized/window_help_menu.rs", '"bring-all-to-front"\n');
  write(root, "src/services/commands/tabCommands.ts", "tab.close\n");
  write(root, "src/components/FindBar/FindBar.tsx", "export function FindBar() {}\n");
  write(root, "src/lib/formats/registry.ts", 'new Set(["yaml-gha-workflow"])\n');
  write(root, "src/export/htmlExport.ts", "includeReader\n");
  write(root, "src/export/fontEmbedder.ts", "export function getGoogleFontUrl() {}\n");
  write(root, "src/export/waitForAssets.ts", "export async function waitForAllImages() {}\n");
  write(root, "src/export/useExportOperations.ts", "includeStyles\n");
  write(root, "src/types/aiGenies.ts", 'type CliProviderType = "claude" | "codex" | "gemini" | "ollama";\n');
  write(root, "src/hooks/useGenieInvocation.ts", 'window.addEventListener("mcp:invoke-genie", h);\n');
  write(root, "src/components/GeniePicker/PromptHistoryDropdown.tsx", "export function PromptHistoryDropdown() {}\n");
  write(root, "src/plugins/syntaxReveal/marks.ts", "export function addMarkSyntaxDecorations() {}\n");
  for (const f of ["src/plugins/imageView/operations.ts", "src/plugins/mathPopup/operations.ts", "src/plugins/footnotePopup/operations.ts", "src/plugins/sourceContextDetection/sourceContextAdapter.ts", "src/lib/ghaWorkflow/lint/schema.ts", "src/lib/ghaWorkflow/eval/staticIf.ts", "src/components/Editor/WorkflowPanel/GhaWorkflowPanel.tsx", "src/components/Editor/WorkflowPanel/WorkflowPanelShell.tsx", "src/workspace/useWorkspace.ts", "src-tauri/resources/genies/outline-and-polish.yml", "src-tauri/src/content_server/slidev.rs", "src/plugins/toolbarContext/toolbarIntent.ts"]) write(root, f);
  write(root, "src-tauri/src/content_server/provision.rs", "#[allow(dead_code)]\n");
  write(root, "src/components/Editor/WorkflowEditor/DiagnosticsBanner.tsx", "export function DiagnosticsBanner() {}\n");
  write(root, "src/hooks/useCommandBootstrap.ts", "// bindings\n");
  write(root, "src/components/Editor/TiptapEditor.tsx", "// editor\n");
  write(root, "src/pages/settings/ShortcutsSettings.tsx", '(s) => getShortcut(s.id) !== ""\n');
  write(root, "src/plugins/taskToggle/tiptap.ts", "Mod+Enter toggles the checkbox\n");
  write(root, "src/plugins/markdownArtifacts/frontmatter.ts", "users edit frontmatter in Source mode instead\n");
  write(root, "src/pages/Settings.tsx", "// Handle Cmd+Shift+D to toggle dev section\n");
  write(root, "src/services/commands/CommandBus.ts", "// legacy hooks remain in place\n");
  write(root, "src-tauri/src/window_status/mod.rs", "//! @coordinates-with src/hooks/useWindowStatusReporter.ts\n");
  write(root, "server/mcp/src/index.ts", "multiplexing 34 actions behind their `action`\n");
  write(root, "src-tauri/src/single_instance.rs", "//! a session with no `DBUS_SESSION_BUS_ADDRESS` panics VMark at startup\n");
  write(root, "src-tauri/src/pdf_export/renderer/windows.rs", "fn render() {}\n");
  write(root, "src-tauri/src/pdf_export/renderer/linux.rs", "fn render() {}\n");
  write(root, "src/lib/formats/adapters/htmlTrust.ts", "// windows disabled\n");
  write(root, "src-tauri/src/secure_store.rs", "// errSecAuthFailed is not mapped\n");
  write(root, "src-tauri/Cargo.toml", "[features]\npdf-smoke = []\n");
  write(root, "src-tauri/src/lib.rs", "pub mod workflow;\n");
  write(root, "scripts/header-references-baseline.json", '{"entries":[{"file":"a.ts","kind":"coordinates-with","target":"b.ts"}]}\n');
  write(root, "scripts/test-only-modules-baseline.json", '{"entries":["src/dead.ts"]}\n');
  return root;
}

// Phase 2 (renamed copy) and phase 3 (the Unassigned state, WI-FL3.13) both add values to the
// same locale bundle; both fixtures write this identical content so write order cannot matter.
const LOCALE_SETTINGS = '{"a":"Let AI save to new locations without asking","b":"Stamp identity block on save","c":"Unassigned"}\n';

// The doc-join script is one file carrying four joins; the checker requires each join by the
// pages it reads, so the fixture names all of them.
const DOC_JOINS = [
  'const LINT = "website/guide/lint.md"; import { RULE_META } from "../src/lib/lintEngine/ruleMeta.ts";',
  'const SETTINGS = ["website/guide/settings.md", "website/guide/terminal.md"];',
  'const README = "README.md"; const PROVIDERS = "src-tauri/src/mcp_config/providers.rs";',
  'import { discoverJourneys } from "../e2e/run-journeys.mjs";',
  "",
].join("\n");

const satisfy = {
  0(root) {
    write(root, "scripts/check-test-only-modules.mjs");
    write(root, "scripts/check-test-only-modules.test.mjs", TS_TEST);
    write(root, "scripts/check-header-references.mjs");
    write(root, "scripts/check-header-references.test.mjs", TS_TEST);
    write(root, "scripts/check-doc-joins.mjs", DOC_JOINS);
    write(root, "scripts/check-doc-joins.test.mjs", TS_TEST);
    write(root, "package.json", JSON.stringify({ scripts: {
      "lint:test-only-modules": "node scripts/check-test-only-modules.mjs",
      "lint:header-refs": "node scripts/check-header-references.mjs",
      "lint:doc-joins": "node scripts/check-doc-joins.mjs",
      "check:static": "pnpm lint:test-only-modules && pnpm lint:header-refs && pnpm lint:doc-joins",
    } }) + "\n");
    write(root, "scripts/baselineRatchetManifest.mjs", 'export const MANIFEST = [{ path: "scripts/test-only-modules-baseline.json" }, { path: "scripts/header-references-baseline.json" }];\n');
    write(root, "scripts/check-feature-ledger-phase.test.mjs", TS_TEST);
    write(root, "src/stores/settingsStore/__tests__/unusedSettings.test.ts", TS_TEST);
    rustTest(root, "src-tauri/src/content_server/bundle_manifest.test.rs");
    write(root, ".github/workflows/release-smoke.yml", "      - id: kb-runtime-state\n");
    write(root, PLAN, "# plan\n\n## Codex review\n\nCodex thread `01a079c7-4770-7040-bec6-2bc055b41ee3`\n\n### Verdict per objection\n");
  },
  1(root) {
    write(root, "src-tauri/src/command_registry.rs", "content_server::content_server_runtime,\n");
    write(root, "src/components/KnowledgeBasePanel/KnowledgeBasePanel.runtime.test.tsx", TS_TEST);
    write(root, "website/guide/knowledge-base.md", "Requirements: the knowledge base requires Node.js on your PATH.\nTrusted workspaces may load remote images.\n");
    write(root, "README.md", "Supported: Claude Desktop, Claude Code, Codex CLI, Antigravity CLI, Grok CLI, opencode.\nEvery shortcut is customizable.\n");
    write(root, "website/guide/lint.md", "| **E06** | Error | Empty link text |\n| **E08** | Error | Unclosed fenced code block |\n| **W05** | Warning | Empty link href |\n`Alt + Mod + V`\n");
    write(root, "website/guide/settings.md", "| Mac Option as Meta (terminal) | desc | On | macOS |\n| Remote clipboard (OSC 52) | write-only | On |\n| Workspace rail mode | desc | Off |\nThe Advanced section is visible by default.\nThe command palette (`Mod + Shift + P`) lists every command.\n");
    write(root, "website/guide/export.md", "### Export HTML\nBoth `index.html` and `standalone.html` are written.\n");
    write(root, "website/guide/features.md", "Images open a popup showing dimensions read-only.\n## Smart Select All\n## Command palette\nOpen it with Mod + Shift + P.\n");
    write(root, "website/guide/ai-genies.md", "menu **Edit > Genies**\n");
    write(root, "website/guide/ai-providers.md", "API keys live in the OS keychain.\n");
    write(root, "website/guide/privacy.md", "Network calls: the update check, REST AI providers, the content server on loopback, the embedded browser.\n");
    write(root, "website/guide/mcp-setup.md", "Every AI write is recorded as a checkpoint you can restore.\n");
    write(root, "website/guide/workspace-management.md", "| Open content search panel | `Mod + Shift + H` |\nHelp > Shell Command: Install 'vmark' in PATH…\n## Quick Look\n");
    write(root, "website/guide/shortcuts.md", "The item is hidden while the embedded browser is off.\n");
    write(root, "website/guide/terminal.md", "| `Mod + 1` … `Mod + 5` | Switch session |\n");
    write(root, "website/guide/index.md", "- **Format**: text and block formatting\n");
    write(root, "website/guide/workflow-viewer.md", "actionlint runs when the binary is on your PATH and the setting is on.\n");
    write(root, "src-tauri/resources/workflows/examples/triage-and-translate.yml", "name: sample\n");
    write(root, "website/guide/workflows.md", "mirrors the `triage-and-translate.yml` sample\n");
    write(root, "website/guide/coherence.md", "## Section anchors\n");
    write(root, "website/guide/cjk-formatting.md", "| 0.12em | Extra |\n");
    write(root, "website/guide/link-check.md", "In WYSIWYG the block is marked; in Source mode the link is underlined.\n");
    write(root, "e2e/README.md", "The journey count is derived by e2e/journeyCount.test.mjs.\n");
    write(root, RULE60, "(`src/plugins/workflowPreview/WorkflowPreview.tsx` has a test since 2026-08)\nKnowledge base: D1 verdict recorded.\nRE-VERDICT 2026-10-01: engine stays dark.\n");
  },
  2(root) {
    write(root, "src/stores/settingsStore/defaults.ts", "autoStart: true,\n");
    write(root, "src/hooks/useMcpAutoStart.ts", 'invoke("mcp_bridge_start")\n');
    write(root, "src/stores/settingsStore/migrations.ts", "export function migrateRemoveMcpPort() {}\nexport function migrateRemoveAutoHideStatusBar() {}\nexport function migrateRemoveWorkflowViewer() {}\n");
    write(root, "website/guide/settings.md", "| Mac Option as Meta (terminal) | desc | On | macOS |\n| Remote clipboard (OSC 52) | write-only | On |\n| Workspace rail mode | desc | Off |\nThe command palette lists every command.\n");
    write(root, "src/locales/en/settings.json", LOCALE_SETTINGS);
    write(root, "src/services/assembly/workflowExtensionGates.ts", "viewer: yaml,\n");
  },
  3(root) {
    write(root, "src/locales/en/settings.json", LOCALE_SETTINGS);
    for (const f of ["src/plugins/imageView/operations.ts", "src/plugins/mathPopup/operations.ts", "src/plugins/footnotePopup/operations.ts", "src/plugins/sourceContextDetection/sourceContextAdapter.ts", "src/lib/ghaWorkflow/lint/schema.ts", "src/lib/ghaWorkflow/eval/staticIf.ts", "src/components/Editor/WorkflowPanel/GhaWorkflowPanel.tsx", "src/components/Editor/WorkflowPanel/WorkflowPanelShell.tsx", "src/workspace/useWorkspace.ts", "src-tauri/resources/genies/outline-and-polish.yml", "src-tauri/src/content_server/slidev.rs", "src-tauri/src/content_server/provision.rs", "src/plugins/toolbarContext/toolbarIntent.ts"]) rm(root, f);
    write(root, "src/plugins/syntaxReveal/marks.ts", "export function findMarkRange() {}\n");
    write(root, "src-tauri/src/command_registry.rs", "content_server::content_server_runtime,\n");
    write(root, "src/services/commands/tabCommands.ts", "tab.reopenClosed\n");
    write(root, "src-tauri/src/menu/localized/file_menu.rs", 'with_id(app, "reopen-closed-tab", …)\n');
    write(root, "src/stores/settingsStore/shortcutDefinitions.ts", "reopenClosedTab\n");
    write(root, "src/components/FindBar/FindBar.tsx", 'window.addEventListener("use-selection-for-find", onUseSelection);\n');
    write(root, "src/hooks/useGenieInvocation.ts", "// no bridge listener\n");
    write(root, "src/types/aiGenies.ts", 'type CliProviderType = "claude" | "codex" | "gemini";\n');
    write(root, "src/components/GeniePicker/PromptHistoryDropdown.tsx", "clearHistory()\n");
    write(root, "website/guide/knowledge-base.md", "requires Node.js\nTrusted workspaces may load remote images.\n");
    write(root, "src/components/Editor/WorkflowEditor/DiagnosticsBanner.tsx", "lintWithActionlint\n");
    write(root, "src/export/htmlExport.ts", "// reader always embedded\n");
    write(root, "src/export/fontEmbedder.ts", "export function embedFont() {}\n");
    write(root, "src/export/waitForAssets.ts", "export async function waitForAssets() {}\n");
    write(root, "src/export/useExportOperations.ts", "copyAsHtml\n");
    write(root, "src/lib/formats/registry.ts", "// no keep-alive list\n");
    write(root, "src-tauri/src/menu/localized/insert_menu.rs", 'with_id(app, "insert-toc", …)\n');
    write(root, "src/hooks/useCommandBootstrap.ts", '"bring-all-to-front"\n');
    write(root, "src/pages/settings/ShortcutsSettings.tsx", "const visibleShortcuts = DEFAULT_SHORTCUTS;\n");
    write(root, "scripts/test-only-modules-baseline.json", '{"entries":[]}\n');
    write(root, PLAN, "# plan\n\n## Codex review\n\nCodex thread `01a079c7-4770-7040-bec6-2bc055b41ee3`\n\n### Verdict per objection\n\n- WI-FL3.7 evidence: branch coherence/operators-and-merge-audit @ abc1234\n- D13 outcome: deferred — undo needs its own design\n- D2 outcome: wire behind a prepare/capture/commit protocol\n- D1 outcome: (c) developer-mode-only until a runtime story exists\n- D7 outcome: extract\n- D10 outcome: accepted residual, mechanism named in browser.md\n- WI-FL5.11 outcome: deferred — needs a real-shell CI job\n- WI-FL6.3 outcome: macOS reports cancel; Windows/Linux residual\n- WI-FL6.6 evidence: run https://github.com/xiaolai/vmark/actions/runs/1\n");
  },
  4(root) {
    write(root, "scripts/header-references-baseline.json", '{"entries":[]}\n');
    write(root, "src/plugins/taskToggle/tiptap.ts", "Mod-Shift-Enter toggles the checkbox\n");
    write(root, "src/plugins/markdownArtifacts/frontmatter.ts", "editable in the WYSIWYG panel\n");
    write(root, "src/pages/Settings.tsx", "// Ctrl+Option+Cmd+D toggles the dev section\n");
    write(root, "src/services/commands/CommandBus.ts", "// menu events arrive through useCommandBootstrap\n");
    write(root, "src-tauri/src/window_status/mod.rs", "//! @coordinates-with src/hooks/useWindowStatus.ts\n");
    write(root, "server/mcp/src/index.ts", "multiplexing its actions behind an `action` enum; every count derives from TOOL_REGISTRY\n");
  },
  5(root) {
    for (const f of ["src/hooks/useTiptapSettingsSync.test.ts", "src/hooks/useWysiwygFlusherRegistration.test.ts", "src/hooks/useTiptapUnmountFlush.test.ts", "src/hooks/useFocusedPaneTiptapRegistration.test.ts", "src/hooks/useIsFocusedPane.test.ts", "src/plugins/frontmatterPanel/nodeView.test.ts", "src/services/genieInvocation/streamRunner.test.ts", "src/services/genieInvocation/extraction.test.ts", "src/stores/claimStore.test.ts", "src/services/breakdown/breakdownContextService.test.ts", "src/hooks/useMcpServer.test.ts", "src/lib/yamlValidation/parseErrors.test.ts", "src/pages/settings/EditorSettings.test.tsx", "src/pages/settings/WhitespaceSettings.test.tsx", "src/services/assembly/autoPairConfig.test.ts", "src/pages/settings/FilesImagesSettings.test.tsx", "src/pages/Settings.devSection.test.tsx", "src/components/StatusBar/useQuitFeedback.test.ts", "src/components/ThemedToaster.test.tsx", "src/components/toastIcons.test.tsx", "src/hooks/useLiveDocsResponder.test.ts", "src/services/tabs/bulkCloseSelectors.test.ts", "src/services/tabs/moveTabToNewWindow.test.ts"]) write(root, f, TS_TEST);
    for (const f of ["src-tauri/src/genies/commands.test.rs", "src-tauri/src/genies/install.test.rs", "src-tauri/src/ai_provider/rest_providers.test.rs", "src-tauri/src/ai_provider/dispatch.test.rs", "src-tauri/src/workflow/actions.test.rs", "src-tauri/src/workflow/commands.test.rs", "src-tauri/src/dock_recent.test.rs", "src-tauri/src/macos_menu.test.rs"]) rustTest(root, f);
    write(root, "e2e/journeys/38-export-html-to-disk.mjs", JOURNEY);
    write(root, "e2e/journeys/39-knowledge-base-runtime-state.mjs", JOURNEY);
    satisfy[3](root); // decision lines live in the plan
  },
  6(root) {
    write(root, "src-tauri/src/single_instance.rs", 'if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none() { return; }\n');
    write(root, "src-tauri/src/pdf_export/renderer/windows.rs", "emit(PdfProgress::Rendering)\n");
    write(root, "src-tauri/src/pdf_export/renderer/linux.rs", "emit(PdfProgress::Rendering)\n");
    write(root, "src/lib/browser/agent/recorderShim.residuals.test.ts", TS_TEST);
    write(root, "src/lib/formats/adapters/htmlTrust.ts", 'const WINDOWS_ORIGIN = "http://vmark-trusted.localhost";\n');
    write(root, "src-tauri/src/secure_store.rs", "use security_framework::base::Error;\n");
    satisfy[3](root);
  },
  7(root) {
    write(root, "src/stores/settingsStore/defaults.ts", "autoStart: true,\n");
    write(root, "src-tauri/Cargo.toml", "[features]\npdf-smoke = []\nworkflow-engine = []\n");
    write(root, "src-tauri/src/lib.rs", '#[cfg(feature = "workflow-engine")]\npub mod workflow;\n');
    write(root, RULE60, "Knowledge base: D1 verdict recorded.\n");
    satisfy[3](root);
  },
};

describe("check-feature-ledger-phase.sh — invocation", () => {
  it("exits 64 with no phase argument", () => { expect(run(emptyRoot()).status).toBe(64); });
  it("exits 64 on an unknown phase, distinct from an assertion failure", () => { expect(run(emptyRoot(), "42").status).toBe(64); });
  // audit R2 #39 — `*) PHASE="$arg"` kept the LAST positional, so `… 2 3` ran
  // phase 3 for a caller who asked for 2, and swallowed a misspelled flag.
  it("refuses a second positional phase and an unknown option instead of guessing", () => {
    const root = emptyRoot();
    const two = run(root, "2", "3");
    expect(two.status).toBe(64);
    expect(`${two.stdout}${two.stderr}`).toMatch(/expected one phase/);
    const flag = run(root, "2", "--verbose");
    expect(flag.status).toBe(64);
    expect(`${flag.stdout}${flag.stderr}`).toMatch(/unknown option: --verbose/);
  });
});

describe("check-feature-ledger-phase.sh — every phase, both directions", () => {
  for (const p of [2, 3, 4, 5, 6, 7]) {
    it(`phase ${p}: unstarted tree is red and names a missing deliverable`, () => {
      const r = run(emptyRoot(), String(p));
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/✗/);
    });
    it(`phase ${p}: satisfied fixture is green`, () => {
      const root = emptyRoot();
      satisfy[p](root);
      const r = run(root, String(p));
      expect(r.stdout).not.toMatch(/✗/);
      expect(r.status).toBe(0);
    });
  }
  for (const p of [0, 1]) {
    it(`phase ${p}: unstarted tree is red`, () => { expect(run(emptyRoot(), String(p)).status).toBe(1); });
    it(`phase ${p}: satisfied fixture has no failed assertion but stays non-zero under --no-exec (behaviour unverified)`, () => {
      const root = emptyRoot();
      satisfy[0](root); satisfy[p](root);
      const r = run(root, String(p));
      expect(r.stdout).not.toMatch(/✗/);
      expect(r.stdout).toMatch(/UNVERIFIED/);
      expect(r.status).toBe(1);
    });
  }
});

describe("check-feature-ledger-phase.sh — assertions that used to pass vacuously", () => {
  // audit R2 #41 — the label claimed Mod+1…5 and only Mod+1 was checked.
  it("requires BOTH ends of the terminal session-switch range", () => {
    const root = emptyRoot(); satisfy[0](root); satisfy[1](root);
    write(root, "website/guide/terminal.md", "| `Mod + 1` | Switch session |\n");
    expect(run(root, "1").stdout).toMatch(/✗ WI-FL1.8 terminal.md documents the whole Mod\+1…Mod\+5 range/);
  });

  // audit R2 #42 — removing the OLD sample name satisfied a label claiming the
  // page names the CURRENT one; the name is derived from the shipped resource.
  it("requires the page to name the bundled sample that actually ships", () => {
    const root = emptyRoot(); satisfy[0](root); satisfy[1](root);
    write(root, "website/guide/workflows.md", "a workflow is a YAML file\n");
    expect(run(root, "1").stdout).toMatch(/✗ WI-FL1.9 workflows.md names the bundled sample \(triage-and-translate\.yml\)/);
    rmSync(path.join(root, "src-tauri/resources/workflows/examples/triage-and-translate.yml"));
    expect(run(root, "1").stdout).toMatch(/✗ WI-FL1.9 no bundled workflow sample/);
  });

  // audit R2 #43 — two document-wide greps prove a heading exists and a chord
  // exists, never that the chord is inside that heading's section.
  it("requires the command-palette chord INSIDE the palette section", () => {
    const root = emptyRoot(); satisfy[0](root); satisfy[1](root);
    write(root, "website/guide/features.md", "Images open a popup showing dimensions read-only.\nOpen it with Mod + Shift + P.\n## Smart Select All\n## Command palette\nIt lists every command.\n");
    expect(run(root, "1").stdout).toMatch(/✗ WI-FL1.11 command palette section names its shortcut/);
  });

  // audit R2 #45 — three historical phrases were rejected; any other wrong
  // count passed. Counts derive from TOOL_REGISTRY, so ANY literal is drift.
  it("rejects any hand-typed action count in the sidecar index, not three known phrases", () => {
    const root = emptyRoot(); satisfy[4](root);
    write(root, "server/mcp/src/index.ts", "the browser tool multiplexes 12 actions\n");
    expect(run(root, "4").stdout).toMatch(/✗ WI-FL4.4 no hand-typed action count/);
    write(root, "server/mcp/src/index.ts", "one action per entry\n");
    expect(run(root, "4").stdout).not.toMatch(/✗ WI-FL4.4/);
  });
});

describe("check-feature-ledger-phase.sh — near misses stay red", () => {
  it("a Rust test file that no module includes is not a discovered test", () => {
    const root = emptyRoot(); satisfy[5](root);
    write(root, "src-tauri/src/genies/commands.rs", "// include line removed\n");
    const r = run(root, "5");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/no \.rs beside it includes it/);
  });
  it("a TS test file with no it()/test() case is not a discovered test", () => {
    const root = emptyRoot(); satisfy[5](root);
    write(root, "src/stores/claimStore.test.ts", "// TODO\n");
    const r = run(root, "5");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/claimStore.*declares no it\(\)/);
  });
  it("a TS test whose only it()/test() sits in a comment or a string is not a discovered test", () => {
    const root = emptyRoot(); satisfy[5](root);
    write(root, "src/stores/claimStore.test.ts", '// it("planned", () => {});\n/* test("later") */\nconst note = \'see it("x")\';\n');
    const r = run(root, "5");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/claimStore.*declares no it\(\)/);
    write(root, "src/stores/claimStore.test.ts", 'describe("x", () => {\n  it.each([1])("case %s", () => {});\n});\n');
    expect(run(root, "5").stdout).toMatch(/✓ WI-FL5.4 claimStore/);
  });
  it("a commented-out #[path] include, or one with no `mod` under it, is not a discovered Rust test", () => {
    const root = emptyRoot(); satisfy[5](root);
    write(root, "src-tauri/src/genies/commands.rs", '// #[path = "commands.test.rs"]\n// mod tests;\n');
    expect(run(root, "5").stdout).toMatch(/✗ WI-FL5.3 commands.test.rs present but no \.rs beside it includes it/);
    write(root, "src-tauri/src/genies/commands.rs", '#[cfg(test)]\n#[path = "commands.test.rs"]\n');
    expect(run(root, "5").stdout).toMatch(/✗ WI-FL5.3 commands.test.rs present but no \.rs beside it includes it/);
    write(root, "src-tauri/src/genies/commands.rs", '#[cfg(test)] #[path = "commands.test.rs"] mod tests;\n');
    expect(run(root, "5").stdout).toMatch(/✓ WI-FL5.3 commands.test.rs/);
  });
  // audit R2 #46 — one level further out: a `.rs` file that no `mod x;`
  // declares is not compiled, so cargo never reaches the include inside it.
  it("a Rust test whose including module is not declared by the crate is not a discovered test", () => {
    const root = emptyRoot(); satisfy[5](root);
    write(root, "src-tauri/src/genies/mod.rs", "// pub mod commands;\npub mod install;\n");
    const r = run(root, "5");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/nothing beside it declares `mod commands`/);
    write(root, "src-tauri/src/genies/mod.rs", "pub mod commands;\npub mod install;\n");
    expect(run(root, "5").stdout).toMatch(/✓ WI-FL5.3 commands.test.rs/);
  });
  it("a #[path] include inside a block comment, or with an unrelated item before a nearby `mod`, is not a discovered Rust test (audit #26)", () => {
    const root = emptyRoot(); satisfy[5](root);
    write(root, "src-tauri/src/genies/commands.rs", '/*\n#[path = "commands.test.rs"]\nmod tests;\n*/\n');
    expect(run(root, "5").stdout).toMatch(/✗ WI-FL5.3 commands.test.rs present but no \.rs beside it includes it/);
    write(root, "src-tauri/src/genies/commands.rs", '#[path = "commands.test.rs"]\nfn helper() {}\nmod other;\n');
    expect(run(root, "5").stdout).toMatch(/✗ WI-FL5.3 commands.test.rs present but no \.rs beside it includes it/);
  });
  it("a TS test whose only it()/test() sits in a multi-line block comment or template literal, or is skipped, is not a discovered test (audit #27)", () => {
    const root = emptyRoot(); satisfy[5](root);
    write(root, "src/stores/claimStore.test.ts", '/*\nit("planned", () => {});\n*/\nconst s = `\ntest("later", () => {});\n`;\n');
    expect(run(root, "5").stdout).toMatch(/✗ WI-FL5.4 claimStore.*declares no it\(\)/);
    write(root, "src/stores/claimStore.test.ts", 'describe.skip("x", () => {\n  it("a", () => {});\n});\nit.todo("b");\n');
    expect(run(root, "5").stdout).toMatch(/✗ WI-FL5.4 claimStore.*declares no it\(\)/);
  });
  it("an e2e journey placeholder without `export default { name, run }` does not satisfy WI-FL5.10", () => {
    const root = emptyRoot(); satisfy[5](root);
    write(root, "e2e/journeys/38-export-html-to-disk.mjs");
    const r = run(root, "5");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/✗ WI-FL5.10 export e2e journey present but not a runner-discoverable journey/);
  });
  it("a journey whose name and run are not on its default export is not discoverable, and a const-held one is (audit #32)", () => {
    const root = emptyRoot(); satisfy[5](root);
    // Three separate line matches, one invalid export: the runner would throw on this file.
    write(root, "e2e/journeys/38-export-html-to-disk.mjs", 'export default {\n  name: "x",\n};\nconst helper = {\n  name: "y",\n  async run() {},\n};\n');
    expect(run(root, "5").stdout).toMatch(/✗ WI-FL5.10 export e2e journey present but not a runner-discoverable journey \(.*`run`/);
    write(root, "e2e/journeys/38-export-html-to-disk.mjs", 'const journey = { name: "export-html-to-disk", run: async (client, ctx) => {} };\nexport default journey;\n');
    expect(run(root, "5").stdout).toMatch(/✓ WI-FL5.10 export e2e journey/);
  });
  it("text assertions are fixed strings: a dotted filename is not a regex, and a near-miss stays red", () => {
    const root = emptyRoot(); satisfy[0](root);
    write(root, "scripts/baselineRatchetManifest.mjs", 'export const MANIFEST = [{ path: "scripts/test-only-modules-baselineXjson" }, { path: "scripts/header-references-baseline.json" }];\n');
    const r = run(root, "0");
    expect(r.stdout).toMatch(/✗ WI-FL0.1 baseline registered in the ratchet manifest/);
    expect(r.stdout).toMatch(/✓ WI-FL0.2 baseline registered in the ratchet manifest/);
  });
  it("check:static wiring is an exact step: a check:all-only reference or a longer script name does not count", () => {
    const root = emptyRoot(); satisfy[0](root);
    write(root, "package.json", JSON.stringify({ scripts: {
      "lint:test-only-modules": "node scripts/check-test-only-modules.mjs",
      "lint:header-refs": "node scripts/check-header-references.mjs",
      "lint:doc-joins": "node scripts/check-doc-joins.mjs",
      "check:static": "pnpm lint:test-only-modules-legacy && pnpm lint:doc-joins",
      "check:all": "pnpm check:static && pnpm lint:header-refs",
    } }) + "\n");
    const r = run(root, "0");
    expect(r.stdout).toMatch(/✗ WI-FL0.1 \(lint:test-only-modules is not a step of check:static\)/);
    expect(r.stdout).toMatch(/✗ WI-FL0.2 \(lint:header-refs is not a step of check:static\)/);
    expect(r.stdout).toMatch(/✓ WI-FL0.3–0.6 \(wired into check:static\)/);
  });
  it("WI-FL3.6 'wired' needs a production call site, not merely a dropped allow(dead_code)", () => {
    const root = emptyRoot(); satisfy[3](root);
    write(root, "src-tauri/src/content_server/provision.rs", "pub fn transition() {}\n");
    expect(run(root, "3").stdout).toMatch(/✗ WI-FL3.6 content-server provisioning neither wired/);
    // A `.rs` file in the directory is not part of the build until mod.rs
    // declares it, so an ORPHAN carrying the call reaches nothing (audit R2 #40).
    write(root, "src-tauri/src/content_server/runtime.rs", "let next = provision::transition(&state, event);\n");
    write(root, "src-tauri/src/content_server/mod.rs", "pub mod provision;\n");
    expect(run(root, "3").stdout).toMatch(/✗ WI-FL3.6 content-server provisioning neither wired/);
    write(root, "src-tauri/src/content_server/mod.rs", "pub mod provision;\n// mod runtime;\n");
    expect(run(root, "3").stdout).toMatch(/✗ WI-FL3.6 content-server provisioning neither wired/);
    write(root, "src-tauri/src/content_server/mod.rs", "pub mod provision;\npub mod runtime;\n");
    expect(run(root, "3").stdout).toMatch(/✓ WI-FL3.6 content-server provisioning wired \(D1 option b\)/);
    write(root, "src-tauri/src/content_server/runtime.rs", "// nothing\n");
    write(root, "src-tauri/src/content_server/swap.rs", "use super::provision::transition;\nprovision::transition(&s, e);\n");
    expect(run(root, "3").stdout).toMatch(/✗ WI-FL3.6 content-server provisioning neither wired/);
    // A call site named only in a comment or a string is not a call site (audit #31).
    write(root, "src-tauri/src/content_server/swap.rs", "// swap\n");
    write(root, "src-tauri/src/content_server/runtime.rs", "/// Later this will call provision::transition(&state, event).\nfn f() { log!(\"provision::verify_checksum pending\"); }\n");
    expect(run(root, "3").stdout).toMatch(/✗ WI-FL3.6 content-server provisioning neither wired/);
    // Nor is an IMPORT of the name, or any other bare path reference: the
    // module would compile with the state machine still unreached (audit #31).
    write(root, "src-tauri/src/content_server/runtime.rs", "use super::provision::transition;\nuse super::provision::verify_checksum as _vc;\n");
    expect(run(root, "3").stdout).toMatch(/✗ WI-FL3.6 content-server provisioning neither wired/);
  });
  it("WI-FL7.2 partial extraction (lib.rs cfg without the Cargo feature) with no re-verdict stays red", () => {
    // (A ∨ R) ∧ (B ∨ R) is (A ∧ B) ∨ R: the two outcome checks cannot pass on a
    // half-done extraction unless a re-verdict is recorded, in which case the
    // re-verdict IS the satisfied outcome.
    const root = emptyRoot(); satisfy[7](root);
    write(root, "src-tauri/Cargo.toml", "[features]\npdf-smoke = []\n");
    const r = run(root, "7");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/✗ WI-FL7.2 feature declared in Cargo.toml/);
  });
  it("a .test.tsx sibling satisfies a WI named by its .test.ts form (WI-FL5.1's hook tests render JSX)", () => {
    const root = emptyRoot(); satisfy[5](root);
    for (const f of ["src/hooks/useTiptapSettingsSync.test.ts", "src/hooks/useWysiwygFlusherRegistration.test.ts"]) {
      rm(root, f);
      write(root, f + "x", TS_TEST);
    }
    const r = run(root, "5");
    expect(r.stdout).not.toMatch(/✗ WI-FL5.1 useTiptapSettingsSync/);
    expect(r.stdout).not.toMatch(/✗ WI-FL5.1 useWysiwygFlusherRegistration/);
  });

  it("the derived Windows trusted-HTML origin satisfies WI-FL6.5, a bare localhost does not", () => {
    const root = emptyRoot(); satisfy[6](root);
    write(root, "src/lib/formats/adapters/htmlTrust.ts", 'const TRUSTED_WINDOWS_ORIGIN = `http://${TRUSTED_SCHEME}.localhost`;\n');
    expect(run(root, "6").stdout).toMatch(/✓ WI-FL6.5/);
    write(root, "src/lib/formats/adapters/htmlTrust.ts", 'const ORIGIN = "http://localhost";\n');
    expect(run(root, "6").stdout).toMatch(/✗ WI-FL6.5/);
  });

  it("near miss: a doc-join script that omits the README join does not satisfy WI-FL0.5", () => {
    const root = emptyRoot(); satisfy[0](root);
    write(root, "scripts/check-doc-joins.mjs", DOC_JOINS.replace(/README\.md|providers\.rs/g, "elsewhere"));
    const r = run(root, "0");
    expect(r.stdout).toMatch(/✗ WI-FL0.5 README join reads the MCP providers table/);
    expect(r.stdout).toMatch(/✗ WI-FL0.5 README join reads README.md/);
    expect(r.stdout).not.toMatch(/✗ WI-FL0.3/);
  });

  it("a decided item accepts only the approved outcome: removing the Mod+E producer does not satisfy WI-FL3.4", () => {
    const root = emptyRoot(); satisfy[3](root);
    write(root, "src/components/FindBar/FindBar.tsx", "export function FindBar() {}\n");
    const r = run(root, "3");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/WI-FL3\.4/);
  });
  it("a deletion without its preserved-branch evidence line is not done", () => {
    const root = emptyRoot(); satisfy[3](root);
    write(root, PLAN, "# plan\n\n- D13 outcome: deferred\n- D2 outcome: wire\n");
    const r = run(root, "3");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/WI-FL3\.7 evidence/);
  });
  it("`all` is the conjunction — red while any phase is red", () => {
    const root = emptyRoot(); for (const p of [0, 2, 3, 4, 5, 6, 7]) satisfy[p](root);
    expect(run(root, "all").status).toBe(1);
  });
});
