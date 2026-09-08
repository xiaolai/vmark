#!/usr/bin/env bash
#
# DoD checker for the feature-ledger fixes plan (WI-FL).
# Plan: dev-docs/plans/20260907-feature-ledger-fixes.md
#
# Usage: bash scripts/check-feature-ledger-phase.sh <0-7|all> [--root=<dir>] [--no-exec]
#
# Exit 0 when every assertion passes, 1 when any fails, 64 on bad invocation.
# `--root` lets scripts/check-feature-ledger-phase.test.mjs prove both directions
# against fixture trees; `--no-exec` skips the assertions that RUN a gate (used
# by the self-test, whose fixtures cannot execute them) and reports them as
# UNVERIFIED — a phase with an unverified behavioural assertion is not green.
#
# Assertion kinds, strongest first (helpers: scripts/lib/dod-assertions.sh;
# text assertions are FIXED-STRING matches):
#   - negative text: the exact stale phrase the 2026-09-07 inspection found must
#     be GONE, so an unstarted phase is red today and cannot round up to done;
#   - test deliverables must be DISCOVERED, not merely present, and the probes
#     read CODE, not text (scripts/dod-syntax.mjs): a Rust `x.test.rs` needs an
#     ACTIVE `#[path = "x.test.rs"]` + `mod …;` include in `x.rs` — in code, not
#     quoted in a raw string, and under no `cfg` gate but `cfg(test)` — a TS/mjs test
#     an `it(`/`test(` call outside comments/strings and skip/todo, an e2e
#     journey a default export `{ name, run }` — a placeholder, a commented-out
#     include, or a case inside a template literal satisfies none of them;
#   - a decided work item accepts ONE outcome; an item still owned by a
#     maintainer decision accepts each named outcome explicitly (`assert_any`),
#     never "the file changed";
#   - review-or-run evidence (a CI run, a preserved branch, a decision) is a
#     `- WI-FL<n>.<m> evidence: <ref>` or `- D<n> outcome: <text>` line in the
#     plan, so it is recorded where the next reader looks and greppable here.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PHASE=""
EXEC=1
# Exactly ONE positional phase, and no unknown flag. `*) PHASE="$arg"` accepted
# any number of positionals and silently kept the LAST — `… 2 3` ran phase 3
# while the caller asked for 2 — and swallowed a misspelled option as a phase
# (audit R2 #39).
for arg in "$@"; do
  case "$arg" in
    --root=*) ROOT="${arg#--root=}" ;;
    --no-exec) EXEC=0 ;;
    -*) echo "unknown option: $arg" >&2; exit 64 ;;
    *)
      if [[ -n "$PHASE" ]]; then echo "expected one phase, got '$PHASE' and '$arg'" >&2; exit 64; fi
      PHASE="$arg" ;;
  esac
done
cd "$ROOT" || exit 64

usage() {
  echo "Usage: $0 <phase> [--root=<dir>] [--no-exec]"
  echo "  0    Gates first — reachability, header refs, doc joins, unused settings, bundle join (all GREEN on landing)"
  echo "  1    User-visible truth — KB runtime made loud, docs corrected, missing sections written"
  echo "  2    Settings honesty — dead settings removed, misnamed ones described, viewer flag removed"
  echo "  3    Unwired code — wired where a surface promises it, deleted otherwise"
  echo "  4    Stale comments and headers"
  echo "  5    Named test gaps closed (discovered tests, not files)"
  echo "  6    Platform gaps — actionable subset, spikes recorded"
  echo "  7    Governance-dated items — engine boundary, verdict record"
  echo "  all  Every phase"
  exit 64
}
[[ -z "$PHASE" ]] && usage

source "$SCRIPT_DIR/lib/dod-assertions.sh"
PLAN="dev-docs/plans/20260907-feature-ledger-fixes.md"   # read by assert_evidence / assert_decision
RULE60=".claude/rules/60-ai-governance.md"

# WI-FL3.6 (D1 option b): "wired" means the provisioning state machine is
# REACHED from production — a `provision::transition` / `verify_checksum`
# CALL in the CODE (not a comment or string) of the content_server module
# outside provision.rs, its swap helper and the tests — and no
# `allow(dead_code)` is left on it. A file that merely dropped the attribute is
# neither wired nor deleted.
# The `(` is load-bearing: without it `use super::provision::transition;` — an
# import that reaches nothing — satisfied the probe (audit 20260907 #31). The
# name must be APPLIED; that is what reachability means.
PROVISION_RS="src-tauri/src/content_server/provision.rs"
CONTENT_SERVER_MOD="src-tauri/src/content_server/mod.rs"
# And the file holding that call site must be a module the crate COMPILES: a
# `.rs` file sitting in the directory is not part of the build until `mod.rs`
# declares it, so an orphan file carrying the call satisfied "wired" while
# reaching nothing (audit R2 #40). The declaration is read from CODE, so a
# commented-out `mod` declares nothing.
provisioning_wired() {
  [[ -f "$PROVISION_RS" ]] || return 1
  grep -qF -- 'allow(dead_code)' "$PROVISION_RS" && return 1
  local hits stem
  hits="$(rust_code_grep 'provision::(transition|verify_checksum)\s*\(' src-tauri/src/content_server '/(provision|swap)\.rs$')" || return 1
  [[ -n "$hits" ]] || return 1
  [[ -f "$CONTENT_SERVER_MOD" ]] || return 1
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    stem="$(basename "$f" .rs)"
    node "$DOD_SYNTAX" rust-code-grep "(^|[^A-Za-z0-9_])mod\\s+${stem}\\s*;" "$CONTENT_SERVER_MOD" >/dev/null 2>&1 || return 1
  done <<< "$hits"
  return 0
}

phase0() {
  echo "Phase 0 — gates first (each gate lands GREEN: instances fixed in the same PR, or an identity baseline)"
  assert_file scripts/check-test-only-modules.mjs "WI-FL0.1 production-reachability detector"
  assert_test_file scripts/check-test-only-modules.test.mjs "WI-FL0.1 detector self-test"
  assert_pkg_script lint:test-only-modules "WI-FL0.1"
  assert_in_static lint:test-only-modules "WI-FL0.1"
  assert_file scripts/test-only-modules-baseline.json "WI-FL0.1 measured identity baseline"
  assert_grep 'test-only-modules-baseline.json' scripts/baselineRatchetManifest.mjs "WI-FL0.1 baseline registered in the ratchet manifest"
  assert_file scripts/check-header-references.mjs "WI-FL0.2 header-reference check"
  assert_test_file scripts/check-header-references.test.mjs "WI-FL0.2 checker self-test"
  assert_pkg_script lint:header-refs "WI-FL0.2"
  assert_in_static lint:header-refs "WI-FL0.2"
  assert_file scripts/header-references-baseline.json "WI-FL0.2 measured identity baseline"
  assert_grep 'header-references-baseline.json' scripts/baselineRatchetManifest.mjs "WI-FL0.2 baseline registered in the ratchet manifest"
  assert_file scripts/check-doc-joins.mjs "WI-FL0.3–0.6 doc-join gate (gates tier, runs on docs-only PRs)"
  assert_test_file scripts/check-doc-joins.test.mjs "WI-FL0.3–0.6 doc-join self-test"
  assert_pkg_script lint:doc-joins "WI-FL0.3–0.6"
  assert_in_static lint:doc-joins "WI-FL0.3–0.6"
  # One script, four joins: each join must be present by the pages it reads, so a script that
  # ships three of the four cannot claim all four work items.
  assert_grep 'website/guide/lint.md' scripts/check-doc-joins.mjs "WI-FL0.3 lint-table join reads lint.md"
  assert_grep 'ruleMeta' scripts/check-doc-joins.mjs "WI-FL0.3 lint-table join reads the code-side rule metadata"
  assert_grep 'website/guide/settings.md' scripts/check-doc-joins.mjs "WI-FL0.4 settings-default join reads settings.md"
  assert_grep 'website/guide/terminal.md' scripts/check-doc-joins.mjs "WI-FL0.4 settings-default join reads terminal.md"
  assert_grep 'providers.rs' scripts/check-doc-joins.mjs "WI-FL0.5 README join reads the MCP providers table"
  assert_grep 'README.md' scripts/check-doc-joins.mjs "WI-FL0.5 README join reads README.md"
  assert_grep 'run-journeys' scripts/check-doc-joins.mjs "WI-FL0.6 journey join shares the runner's discovery"
  assert_test_file src/stores/settingsStore/__tests__/unusedSettings.test.ts "WI-FL0.7 unused-setting detector"
  assert_test_file src-tauri/src/content_server/bundle_manifest.test.rs "WI-FL0.8 bundle-manifest join"
  assert_grep 'kb-runtime-state' .github/workflows/release-smoke.yml "WI-FL0.8 release-smoke launches the staged app and records the KB runtime state"
  assert_grep_E 'Codex thread `?[0-9a-f]{6,}' "$PLAN" "WI-FL0.9 Codex review recorded with a thread id"
  assert_grep 'Verdict per objection' "$PLAN" "WI-FL0.9 Codex review recorded per objection"
  assert_test_file scripts/check-feature-ledger-phase.test.mjs "WI-FL0.10 DoD checker self-test is a discovered test"
  assert_exec "WI-FL0.1 detector runs green on the live tree" node scripts/check-test-only-modules.mjs
  assert_exec "WI-FL0.2 header-reference check runs green on the live tree" node scripts/check-header-references.mjs
  assert_exec "WI-FL0.3–0.6 doc joins run green on the live tree" node scripts/check-doc-joins.mjs
}

phase1() {
  echo "Phase 1 — user-visible truth"
  assert_grep 'content_server_runtime' src-tauri/src/command_registry.rs "WI-FL1.1 runtime-availability command registered"
  assert_test_file src/components/KnowledgeBasePanel/KnowledgeBasePanel.runtime.test.tsx "WI-FL1.1 KB panel runtime state pinned"
  assert_grep_E 'Node\.js|requires Node' website/guide/knowledge-base.md "WI-FL1.1 knowledge-base.md states the runtime requirement"
  assert_not_grep 'Gemini CLI' README.md "WI-FL1.2 README no longer lists Gemini CLI as an MCP target"
  assert_grep 'Antigravity' README.md "WI-FL1.2 README lists the shipped MCP targets"
  assert_not_grep '122 Shortcuts' README.md "WI-FL1.2 README shortcut count no longer hardcoded to 122"
  assert_grep_E '^\| \*\*E08\*\* \| [A-Za-z]+ \| Unclosed' website/guide/lint.md "WI-FL1.3 lint.md E08 is the unclosed fence"
  assert_grep_E '^\| \*\*E06\*\* \| [A-Za-z]+ \| Empty link text' website/guide/lint.md "WI-FL1.3 lint.md E06 is empty link text"
  assert_not_grep 'Cmd + Shift + L' website/guide/lint.md "WI-FL1.3 lint.md trigger no longer Cmd+Shift+L"
  assert_not_grep_E 'Mac Option as Meta \(terminal\) \|.*\| Off \|' website/guide/settings.md "WI-FL1.4 settings.md Option-as-Meta default corrected"
  assert_not_grep 'hidden by default' website/guide/settings.md "WI-FL1.4 settings.md Advanced-section claim corrected"
  assert_not_grep 'adds the source-pane extras' website/guide/settings.md "WI-FL1.4 settings.md viewer-switch sentence removed"
  assert_grep 'OSC 52' website/guide/settings.md "WI-FL1.4 settings.md documents the OSC 52 row"
  assert_grep_Ei 'workspace rail' website/guide/settings.md "WI-FL1.4 settings.md documents the workspace-rail toggle"
  assert_not_grep 'Single File Mode' website/guide/export.md "WI-FL1.5 export.md mode selector claim removed"
  assert_not_grep 'Resize via context menu' website/guide/features.md "WI-FL1.6 features.md image resize claim removed"
  assert_not_grep 'Tools > AI Genies' website/guide/ai-genies.md "WI-FL1.7 ai-genies.md menu path corrected"
  assert_not_grep 'stored in memory only' website/guide/ai-providers.md "WI-FL1.7 ai-providers.md stale key-storage claim removed"
  assert_not_grep 'stored in the app data directory' website/guide/ai-providers.md "WI-FL1.7 ai-providers.md second stale key-storage claim removed"
  assert_not_grep 'No other network calls exist' website/guide/privacy.md "WI-FL1.7 privacy.md network inventory corrected"
  assert_not_grep 'MCP Server Status' website/guide/mcp-setup.md "WI-FL1.7 mcp-setup.md status-dialog claim removed"
  assert_not_grep 'Mod + Shift + F' website/guide/workspace-management.md "WI-FL1.8 content-search shortcut corrected"
  assert_not_grep_E "Install .vmark. Command" website/guide/workspace-management.md "WI-FL1.8 CLI install label corrected"
  assert_not_grep 'greyed out until you enable' website/guide/shortcuts.md "WI-FL1.8 New Browser Tab sentence corrected"
  # BOTH ends of the range, on one row: asserting only `Mod + 1` let the page
  # document a shorter range under a label claiming 1–5 (audit R2 #41).
  assert_grep_E 'Mod \+ 1.*Mod \+ 5' website/guide/terminal.md "WI-FL1.8 terminal.md documents the whole Mod+1…Mod+5 range"
  assert_not_grep_E '\*\*Tools\*\*:' website/guide/index.md "WI-FL1.8 index.md menu list no longer names a Tools menu"
  assert_not_grep 'runs automatically when the binary' website/guide/workflow-viewer.md "WI-FL1.9 actionlint claim corrected"
  assert_not_grep 'outline-and-polish' website/guide/workflows.md "WI-FL1.9 workflows.md no longer names the removed sample"
  # POSITIVE, and DERIVED from the shipped resource: removing the old name
  # satisfied a label claiming the page names the sample (audit R2 #42). A
  # rename of the bundled file now fails here rather than leaving the page stale.
  workflow_sample="$(ls src-tauri/resources/workflows/examples/*.yml 2>/dev/null | head -1)"
  if [[ -z "$workflow_sample" ]]; then
    fail "WI-FL1.9 no bundled workflow sample under src-tauri/resources/workflows/examples — the page cannot name one"
  else
    assert_grep "$(basename "$workflow_sample")" website/guide/workflows.md "WI-FL1.9 workflows.md names the bundled sample ($(basename "$workflow_sample"))"
  fi
  assert_not_grep 'trusted workspaces are served' website/guide/knowledge-base.md "WI-FL1.9 knowledge-base.md trust claim corrected"
  assert_grep_Ei 'section anchor' website/guide/coherence.md "WI-FL1.9 coherence.md documents section anchors"
  assert_grep '0.12em' website/guide/cjk-formatting.md "WI-FL1.9 cjk-formatting.md lists every letter-spacing level"
  assert_not_grep 'red squiggle' website/guide/link-check.md "WI-FL1.9 link-check.md describes the WYSIWYG decoration honestly"
  assert_not_grep '35 user journeys' e2e/README.md "WI-FL1.10 e2e README journey count derived"
  assert_not_grep 'WorkflowPreview.tsx` still has' "$RULE60" "WI-FL1.10 rule 60 §12 WorkflowPreview note corrected"
  assert_grep 'Quick Look' website/guide/workspace-management.md "WI-FL1.11 Quick Look documented"
  assert_grep_Ei 'smart select all' website/guide/features.md "WI-FL1.11 Smart Select All documented"
  assert_grep_Ei 'checkpoint' website/guide/mcp-setup.md "WI-FL1.11 MCP checkpoints documented"
  assert_grep_E '^#+ .*[Cc]ommand [Pp]alette' website/guide/features.md "WI-FL1.11 command palette has its own section in features.md (a passing mention is not documentation)"
  # INSIDE the section, not merely somewhere on the page: two document-wide
  # greps proved a heading exists and the chord exists, never that the chord is
  # in that section (audit R2 #43).
  assert_grep_in_section '^#+ .*[Cc]ommand [Pp]alette' 'Mod \+ Shift \+ P' website/guide/features.md "WI-FL1.11 command palette section names its shortcut"
  assert_exec "WI-FL1.12 doc joins green after the corrections" node scripts/check-doc-joins.mjs
}

phase2() {
  echo "Phase 2 — settings honesty"
  assert_not_grep 'port: 9223' src/stores/settingsStore/defaults.ts "WI-FL2.1 mcpServer.port removed from defaults"
  assert_not_grep 'mcpServer.port' src/hooks/useMcpAutoStart.ts "WI-FL2.1 auto-start no longer forwards a port"
  assert_grep 'migrateRemoveMcpPort' src/stores/settingsStore/migrations.ts "WI-FL2.1 migration drops the persisted port"
  assert_not_grep 'autoHideStatusBar' src/stores/settingsStore/defaults.ts "WI-FL2.2 autoHideStatusBar removed from defaults"
  assert_grep 'migrateRemoveAutoHideStatusBar' src/stores/settingsStore/migrations.ts "WI-FL2.2 migration drops the persisted flag"
  assert_not_grep 'Auto-hide status bar' website/guide/settings.md "WI-FL2.2 settings.md row removed"
  assert_grep_Ei 'new location' src/locales/en/settings.json "WI-FL2.3 autoApproveEdits copy names what it gates"
  assert_grep_Ei 'identity block' src/locales/en/settings.json "WI-FL2.4 coherence capture copy names the on-disk stamp"
  assert_grep_Ei 'write-only' website/guide/settings.md "WI-FL2.5 OSC 52 row says write-only"
  assert_not_grep 'workflowViewer' src/stores/settingsStore/defaults.ts "WI-FL2.6 workflowViewer flag removed (D6)"
  assert_grep 'migrateRemoveWorkflowViewer' src/stores/settingsStore/migrations.ts "WI-FL2.6 migration drops the persisted viewer flag"
  assert_not_grep 'isWorkflowViewerEnabled' src/services/assembly/workflowExtensionGates.ts "WI-FL2.6 viewer extensions no longer gated by the removed flag"
}

phase3() {
  echo "Phase 3 — unwired code"
  assert_no_file src/plugins/imageView/operations.ts "WI-FL3.1 imageView/operations.ts"
  assert_no_file src/plugins/mathPopup/operations.ts "WI-FL3.1 mathPopup/operations.ts"
  assert_no_file src/plugins/footnotePopup/operations.ts "WI-FL3.1 footnotePopup/operations.ts"
  assert_no_file src/plugins/sourceContextDetection/sourceContextAdapter.ts "WI-FL3.1 sourceContextAdapter.ts"
  assert_no_file src/lib/ghaWorkflow/lint/schema.ts "WI-FL3.1 ghaWorkflow/lint/schema.ts"
  assert_no_file src/lib/ghaWorkflow/eval/staticIf.ts "WI-FL3.1 ghaWorkflow/eval/staticIf.ts"
  assert_no_file src/components/Editor/WorkflowPanel/GhaWorkflowPanel.tsx "WI-FL3.1 GhaWorkflowPanel.tsx"
  assert_no_file src/components/Editor/WorkflowPanel/WorkflowPanelShell.tsx "WI-FL3.1 WorkflowPanelShell.tsx"
  assert_no_file src/workspace/useWorkspace.ts "WI-FL3.1 useWorkspace.ts"
  assert_not_grep 'addMarkSyntaxDecorations' src/plugins/syntaxReveal/marks.ts "WI-FL3.1 syntaxReveal decoration half removed"
  assert_not_grep 'file_tree::list_directory_entries' src-tauri/src/command_registry.rs "WI-FL3.2 list_directory_entries unregistered"
  assert_not_grep 'window_manager::request_quit' src-tauri/src/command_registry.rs "WI-FL3.2 request_quit command unregistered"
  assert_ts_code_grep 'reopenClosed' src/services/commands/tabCommands.ts "WI-FL3.3 reopen-closed-tab command"
  assert_rust_code_grep '"reopen-closed-tab"' src-tauri/src/menu/localized/file_menu.rs "WI-FL3.3 reopen-closed-tab menu item" --keep-strings
  assert_ts_code_grep 'reopenClosedTab' src/stores/settingsStore/shortcutDefinitions.ts "WI-FL3.3 reopen-closed-tab shortcut id" --keep-strings
  assert_ts_code_grep 'use-selection-for-find' src/components/FindBar/FindBar.tsx "WI-FL3.4 FindBar listens for use-selection-for-find" --keep-strings
  assert_not_grep 'mcp:invoke-genie' src/hooks/useGenieInvocation.ts "WI-FL3.5 producer-less mcp:invoke-genie listener removed"
  assert_not_grep '"ollama"' src/types/aiGenies.ts "WI-FL3.5 CliProviderType no longer carries ollama"
  assert_ts_code_grep 'clearHistory' src/components/GeniePicker/PromptHistoryDropdown.tsx "WI-FL3.5 prompt history has a clear surface"
  if [[ ! -e "$PROVISION_RS" ]]; then ok "WI-FL3.6 content-server provisioning deleted (D1 option a/c)"
  elif provisioning_wired; then ok "WI-FL3.6 content-server provisioning wired (D1 option b): production call site, no allow(dead_code)"
  else fail "WI-FL3.6 content-server provisioning neither wired (a production provision::transition/verify_checksum call site outside provision.rs/swap.rs, and no allow(dead_code)) nor deleted"; fi
  assert_no_file src-tauri/src/content_server/slidev.rs "WI-FL3.6 unused slidev export-argument builder removed"
  assert_grep_Ei 'remote images' website/guide/knowledge-base.md "WI-FL3.6 knowledge-base.md says what trust actually changes"
  assert_not_grep 'coherence_operator_propose' src-tauri/src/command_registry.rs "WI-FL3.7 coherence operators unregistered (D3)"
  assert_not_grep 'coherence_merge_audit' src-tauri/src/command_registry.rs "WI-FL3.7 coherence merge audit unregistered (D3)"
  assert_evidence WI-FL3.7 "WI-FL3.7 deleted code preserved on a named branch"
  assert_grep_dir 'lintWithActionlint' src/components/Editor/WorkflowEditor "WI-FL3.8 actionlint diagnostics reach the workbench"
  assert_decision D13 "WI-FL3.8 workflow undo is a recorded product decision, not a wire fix"
  assert_not_grep 'includeReader' src/export/htmlExport.ts "WI-FL3.9 includeReader dead switch removed"
  assert_not_grep 'getGoogleFontUrl' src/export/fontEmbedder.ts "WI-FL3.9 getGoogleFontUrl removed"
  assert_not_grep 'waitForAllImages' src/export/waitForAssets.ts "WI-FL3.9 waitForAllImages removed"
  assert_not_grep 'includeStyles' src/export/useExportOperations.ts "WI-FL3.9 includeStyles dead branch removed"
  assert_not_grep 'yaml-gha-workflow' src/lib/formats/registry.ts "WI-FL3.10 phantom keep-alive id removed"
  assert_rust_code_grep '"insert-toc"' src-tauri/src/menu/localized/insert_menu.rs "WI-FL3.10 Insert menu offers a table of contents" --keep-strings
  assert_no_file src-tauri/resources/genies/outline-and-polish.yml "WI-FL3.10 unreachable sample genie removed (D11)"
  assert_any "WI-FL3.10 bring-all-to-front handled or removed" \
    "grep|bring-all-to-front|src/hooks/useCommandBootstrap.ts" \
    "nogrep|bring-all-to-front|src-tauri/src/menu/localized/window_help_menu.rs"
  assert_decision D2 "WI-FL3.11a spike recorded as the D2 outcome; WI-FL3.11 implements only what it says"
  assert_any "WI-FL3.12 toolbar intent resolver fed by WYSIWYG or deleted" \
    "grep|resolveToolbarIntent|src/components/Editor/TiptapEditor.tsx" \
    "nofile|src/plugins/toolbarContext/toolbarIntent.ts"
  assert_not_grep 'getShortcut(s.id) !== ""' src/pages/settings/ShortcutsSettings.tsx "WI-FL3.13 unbound shortcuts stay visible in the pane"
  assert_grep_Ei 'unassigned' src/locales/en/settings.json "WI-FL3.13 Unassigned state has copy"
  assert_baseline_empty scripts/test-only-modules-baseline.json "Phase 3 test-only-module baseline paid to zero"
}

phase4() {
  echo "Phase 4 — stale comments and headers"
  assert_baseline_empty scripts/header-references-baseline.json "WI-FL4.1 header-reference baseline paid to zero"
  assert_not_grep 'Mod+Enter toggles' src/plugins/taskToggle/tiptap.ts "WI-FL4.2 taskToggle header matches the binding"
  assert_not_grep 'in Source mode instead' src/plugins/markdownArtifacts/frontmatter.ts "WI-FL4.2 frontmatter header no longer says Source-only"
  assert_not_grep 'Cmd+Shift+D' src/pages/Settings.tsx "WI-FL4.2 Settings.tsx names the real chord"
  assert_not_grep 'remain in place' src/services/commands/CommandBus.ts "WI-FL4.2 CommandBus header no longer cites removed hooks"
  assert_not_grep 'useWindowStatusReporter' src-tauri/src/window_status/mod.rs "WI-FL4.3 window_status header points at a real file"
  # The CLASS, not three historical phrases: every count in index.ts derives
  # from TOOL_REGISTRY (`describeActionCount`), so ANY hand-typed "<n> action(s)"
  # is drift waiting to happen. Rejecting only `34 actions`, `browser (8
  # actions` and `browser_read (6 actions` let a fresh wrong count pass
  # (audit R2 #45). Measured at zero on the live file.
  assert_not_grep_E '[0-9]+ actions?' server/mcp/src/index.ts "WI-FL4.4 no hand-typed action count in the sidecar index (counts derive from TOOL_REGISTRY)"
}

phase5() {
  echo "Phase 5 — named test gaps (verified missing on 2026-09-07; discovered, not merely present)"
  for f in src/hooks/useTiptapSettingsSync.test.ts src/hooks/useWysiwygFlusherRegistration.test.ts src/hooks/useTiptapUnmountFlush.test.ts src/hooks/useFocusedPaneTiptapRegistration.test.ts src/hooks/useIsFocusedPane.test.ts; do assert_test_file "$f" "WI-FL5.1 $(basename "$f")"; done
  assert_test_file src/plugins/frontmatterPanel/nodeView.test.ts "WI-FL5.2 frontmatter panel node view"
  for f in src-tauri/src/genies/commands.test.rs src-tauri/src/genies/install.test.rs src-tauri/src/ai_provider/rest_providers.test.rs src-tauri/src/ai_provider/dispatch.test.rs; do assert_test_file "$f" "WI-FL5.3 $(basename "$f")"; done
  assert_test_file src/services/genieInvocation/streamRunner.test.ts "WI-FL5.3 streamRunner"
  assert_test_file src/services/genieInvocation/extraction.test.ts "WI-FL5.3 extraction"
  assert_test_file src/stores/claimStore.test.ts "WI-FL5.4 claimStore"
  assert_test_file src/services/breakdown/breakdownContextService.test.ts "WI-FL5.4 breakdownContextService"
  assert_test_file src/hooks/useMcpServer.test.ts "WI-FL5.5 useMcpServer"
  assert_test_file src-tauri/src/workflow/actions.test.rs "WI-FL5.6 workflow actions"
  assert_test_file src-tauri/src/workflow/commands.test.rs "WI-FL5.6 workflow commands"
  for f in src/lib/yamlValidation/parseErrors.test.ts src/pages/settings/EditorSettings.test.tsx src/pages/settings/WhitespaceSettings.test.tsx src/services/assembly/autoPairConfig.test.ts src/pages/settings/FilesImagesSettings.test.tsx src/pages/Settings.devSection.test.tsx; do assert_test_file "$f" "WI-FL5.7 $(basename "$f")"; done
  for f in src/components/StatusBar/useQuitFeedback.test.ts src/components/ThemedToaster.test.tsx src/components/toastIcons.test.tsx src/hooks/useLiveDocsResponder.test.ts src/services/tabs/bulkCloseSelectors.test.ts src/services/tabs/moveTabToNewWindow.test.ts; do assert_test_file "$f" "WI-FL5.8 $(basename "$f")"; done
  assert_test_file src-tauri/src/dock_recent.test.rs "WI-FL5.9 dock_recent"
  assert_test_file src-tauri/src/macos_menu.test.rs "WI-FL5.9 macos_menu"
  assert_journey e2e/journeys/38-export-html-to-disk.mjs "WI-FL5.10 export e2e journey"
  assert_journey e2e/journeys/39-knowledge-base-runtime-state.mjs "WI-FL5.10 knowledge-base runtime e2e journey"
  assert_decision WI-FL5.11 "WI-FL5.11 real-shell rc execution test: done or deferred with a written reason"
}

phase6() {
  echo "Phase 6 — platform gaps"
  assert_rust_code_grep 'var(_os)?\("DBUS_SESSION_BUS_ADDRESS"\)' src-tauri/src/single_instance.rs "WI-FL6.1 single-instance checks for a session bus before registering" --keep-strings
  assert_rust_code_grep 'PdfProgress' src-tauri/src/pdf_export/renderer/windows.rs "WI-FL6.2 PDF progress emitted on Windows"
  assert_rust_code_grep 'PdfProgress' src-tauri/src/pdf_export/renderer/linux.rs "WI-FL6.2 PDF progress emitted on Linux"
  assert_decision WI-FL6.3 "WI-FL6.3 print-dialog outcome spike recorded per platform"
  assert_test_file src/lib/browser/agent/recorderShim.residuals.test.ts "WI-FL6.4 recorder residuals pinned"
  # The Windows origin is derived from the scheme constant (`${TRUSTED_SCHEME}.localhost`), so
  # either the literal or the derived spelling counts; a bare "localhost" does not.
  assert_grep_E 'vmark-trusted\.localhost|\$\{TRUSTED_SCHEME\}\.localhost' src/lib/formats/adapters/htmlTrust.ts "WI-FL6.5 trusted HTML URL form for Windows"
  assert_evidence WI-FL6.6 "WI-FL6.6 NSIS hook verified on a real Windows install/uninstall run"
  assert_rust_code_grep 'security_framework' src-tauri/src/secure_store.rs "WI-FL6.7 keychain denial classified through security-framework"
  assert_decision D10 "WI-FL6.8 SSRF residual decided (accepted residual or mitigation)"
}

phase7() {
  echo "Phase 7 — governance-dated items"
  assert_not_grep 'workflowViewer' src/stores/settingsStore/defaults.ts "WI-FL7.1 viewer flag removed (D6, by 2026-09-15)"
  # Two `assert_any` calls, and the phase is green only when BOTH pass:
  # (A ∨ R) ∧ (B ∨ R), which distributes to (A ∧ B) ∨ R. A half-done
  # extraction with no re-verdict therefore cannot pass — reviewed against
  # audit R2 #50, which read these as independently satisfiable; they are not,
  # and check-feature-ledger-phase.test.mjs pins the partial-extraction case.
  assert_any "WI-FL7.2 engine extracted behind a cargo feature, or a dated re-verdict recorded" \
    "grep|cfg(feature = \"workflow-engine\")|src-tauri/src/lib.rs" \
    "grep|RE-VERDICT 2026-|$RULE60"
  assert_any "WI-FL7.2 feature declared in Cargo.toml, or a dated re-verdict recorded" \
    "grep|workflow-engine =|src-tauri/Cargo.toml" \
    "grep|RE-VERDICT 2026-|$RULE60"
  assert_grep_Ei 'knowledge base' "$RULE60" "WI-FL7.3 rule 60 §12 records the KB runtime verdict (D1)"
  assert_decision D1 "WI-FL7.3 D1 outcome recorded"
  assert_decision D7 "WI-FL7.3 D7 outcome recorded"
}

run_phase() {
  case "$1" in
    0) phase0 ;; 1) phase1 ;; 2) phase2 ;; 3) phase3 ;; 4) phase4 ;; 5) phase5 ;; 6) phase6 ;; 7) phase7 ;;
    *) usage ;;
  esac
}
if [[ "$PHASE" == "all" ]]; then for p in 0 1 2 3 4 5 6 7; do run_phase "$p"; done; else run_phase "$PHASE"; fi

echo
echo "Phase $PHASE: $PASS passed, $FAIL failed, $UNVERIFIED unverified."
if (( FAIL > 0 || UNVERIFIED > 0 )); then
  echo "Not done:"; for d in "${FAIL_DETAIL[@]}"; do echo "  - $d"; done
  exit 1
fi
exit 0
