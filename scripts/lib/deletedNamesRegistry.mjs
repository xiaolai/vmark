/**
 * The tombstone registry behind `scripts/check-deleted-names.mjs` — every file
 * and symbol an ADR or plan declared deleted and relies on staying gone.
 *
 * Lives apart from the gate so the registry can grow (each entry carries its
 * decision and its reason, which is the point) without the gate script itself
 * crossing the 300-line file-size limit. Append here; the gate reads it.
 *
 * @coordinates-with scripts/check-deleted-names.mjs — the gate that evaluates it
 * @module scripts/lib/deletedNamesRegistry
 */

/**
 * Each entry is either:
 *   { kind: "path", path, deletedBy, reason }   — this file must not exist
 *   { kind: "symbol", name, glob, deletedBy, reason } — this exported symbol
 *     must not be defined anywhere matching `glob` (a production-source pattern)
 */
export const REGISTRY = [
  {
    kind: "path",
    path: "scripts/check-selection-styles.mjs",
    deletedBy: "WI-UI0.3 (dev-docs/plans/20260829-ui-consistency.md)",
    reason:
      "Enforced the selection vocabulary only on selectors containing " +
      "menu|popup|picker|dropdown, and only against hard colour literals — a " +
      "wrong TOKEN passed, the file tree and tab strip were never scanned, and " +
      "it had no self-test. check-ui-consistency.mjs C9 covers every selector " +
      "with the full state vocabulary and sanctioned-family allowlists. " +
      "Re-adding it would shadow that gate with a weaker one.",
  },
  {
    kind: "path",
    path: "src/services/keybinding/keybindingManifest.ts",
    deletedBy: "audit-fix #29 (settled with Codex, thread 019fdb16)",
    reason:
      "A hand-copied restatement of every menu-backed shortcut's keys, with zero " +
      "runtime importers. The drift gate compared it against the definitions it " +
      "was copied FROM, so it could only catch a forgotten copy, never drift. " +
      "scripts/check-keybinding-manifest.mjs now derives the synced set from " +
      "DEFAULT_SHORTCUTS; every cross-language check is unchanged. " +
      "Re-adding it would restore the duplication, not any coverage.",
  },
  {
    kind: "symbol",
    name: "KEYBINDING_MANIFEST",
    glob: "src",
    deletedBy: "audit-fix #29 (settled with Codex, thread 019fdb16)",
    reason: "The manifest array itself — see the path entry above.",
  },
  {
    kind: "path",
    path: "src/services/browser/committedNavigations.ts",
    deletedBy: "audit-fix round 4 (#87)",
    reason:
      "An eight-entry ring of COMMITTED navigation ids, used to decide whether a " +
      "late load failure was superseded. Provisional ids were unknown to it and " +
      "evicted ids looked unknown too, so a stale failure overlay still landed. " +
      "navigationOrder.ts decides by the driver's per-tab monotonic SEQUENCE " +
      "(nav-<tabId>-<n>) instead: no ring, no eviction, listener order irrelevant. " +
      "Re-adding a ring would reintroduce the eviction blind spot.",
  },
  {
    kind: "symbol",
    name: "CommittedNavigations",
    glob: "src",
    deletedBy: "audit-fix round 4 (#87)",
    reason: "The ring ledger class itself — see the path entry above.",
  },
  {
    kind: "path",
    path: "src/plugins/registry.ts",
    deletedBy: "ADR-015 / WI-3.3",
    reason:
      "The plugin manifest registry was non-load-bearing dead metadata. " +
      "Composition goes through lib/extensions/resolve.ts now.",
  },
  {
    kind: "path",
    path: "src/plugins/manifests.ts",
    deletedBy: "ADR-015 / WI-3.3",
    reason: "Central manifest registration; every manifest was a 3-field stub.",
  },
  {
    kind: "symbol",
    name: "pluginsFor",
    glob: "src/plugins",
    deletedBy: "ADR-015 / WI-3.3",
    reason: "Dead registry lookup with zero production callers.",
  },
  {
    kind: "path",
    path: "src/stores/browserStore.ts",
    deletedBy: "architecture review E4 / WI-6 (plan-20260803-161713, ledger D9)",
    reason:
      "Unwired hibernation-cap store; the webview leak its cap would bound was " +
      "REFUTED — the active-page-only surface lifecycle bounds live views at 1, " +
      "strictly tighter. Pinned by src/components/Browser/browserLifecycleBound.test.tsx. " +
      "Wiring the cap was explicitly rejected (plan Deferred section).",
  },
  {
    kind: "symbol",
    name: "useBrowserStore",
    glob: "src/stores",
    deletedBy: "architecture review E4 / WI-6 (plan-20260803-161713, ledger D9)",
    reason: "The hibernation store must not come back under another filename either.",
  },
  {
    kind: "path",
    path: "src/stores/_shimHelper.ts",
    deletedBy: "architecture review C1 / WI-9 (plan-20260803-161713)",
    reason:
      "T09 revert: the slice-shim engine (WeakMap merge cache, action-filtering " +
      "setState, getInitialState aliased to getState — a Zustand-semantics " +
      "deviation) is gone. Every popup store is a standalone create() store now.",
  },
  {
    kind: "path",
    path: "src/stores/popupStore.ts",
    deletedBy: "architecture review C1 / WI-9 (plan-20260803-161713)",
    reason:
      "T09 revert: the merged 15-slice popup mega-store facade was deleted; " +
      "each slice was re-inlined as its own standalone store.",
  },
  {
    kind: "symbol",
    name: "usePopupStore",
    glob: "src/stores",
    deletedBy: "architecture review C1 / WI-9 (plan-20260803-161713)",
    reason: "The merged popup store must not come back under another filename either.",
  },
  {
    kind: "symbol",
    name: "formatSelection",
    glob: "src",
    deletedBy: "WI-CJKF1.1 (dev-docs/plans/20260821-cjk-formatter-correctness.md)",
    reason:
      "An unprotected CJK format pass — applyRules with no findProtectedRegions " +
      "and no verifyIntegrity, documented as 'assumes no markdown structure to " +
      "preserve'. Nothing could establish that assumption: its only caller handed " +
      "it a SLICE OF THE DOCUMENT, so Cmd+A then Cmd+Shift+F in Source mode " +
      "rewrote every fenced code block (straight quotes became curly, breaking " +
      "string literals) and every YAML `title:` (into `title：`). formatMarkdown " +
      "takes exactly the same input safely. A 'plain text' variant must not come " +
      "back — the safety difference is invisible at the call site.",
  },
  // ── Feature-ledger plan, Phase 3 (dev-docs/plans/20260907-feature-ledger-fixes.md) ──
  // Modules only their own tests imported (finding F1). scripts/check-test-only-modules.mjs
  // measures the class; these pins keep each named deletion from returning under its name.
  { kind: "path", path: "src/plugins/imageView/operations.ts", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "ADR-010 helper trio with zero production importers; the image popup never called it." },
  { kind: "path", path: "src/plugins/mathPopup/operations.ts", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "ADR-010 helper trio with zero production importers; the math button serialises via wysiwygAdapterBlockInsert." },
  { kind: "path", path: "src/plugins/footnotePopup/operations.ts", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "Zero production importers; production uses the same-named findFootnoteDefinition from tiptapDomUtils.ts." },
  { kind: "path", path: "src/plugins/wikiLinkPopup/operations.ts", deletedBy: "feature-ledger plan Phase 3 (WI-FL0.1 baseline)", reason: "Same ADR-010 class: wiki-link parse/format helpers with no production importer; the popup uses wikiLinkPaths.ts." },
  { kind: "path", path: "src/plugins/sourceContextDetection/sourceContextAdapter.ts", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "Fed resolveToolbarIntent from Source mode; nothing called it — the source toolbar routes through sourceAdapter directly." },
  { kind: "path", path: "src/plugins/sourceContextDetection/mathActions.ts", deletedBy: "feature-ledger plan Phase 3 (WI-FL0.1 baseline)", reason: "Block-math range helpers whose header named sourceAdapter.ts as caller; it never was." },
  { kind: "path", path: "src/plugins/sourceContextDetection/shortcutUtils.ts", deletedBy: "feature-ledger plan Phase 3 (WI-FL0.1 baseline)", reason: "A key→FormatType map no keymap consulted; Source shortcuts bind through sourceShortcuts.ts and the registry." },
  { kind: "path", path: "src/lib/ghaWorkflow/lint/schema.ts", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "@actions/languageservice lint wrapper with no production importer; actionlint.ts is the shipped linter." },
  { kind: "path", path: "src/lib/ghaWorkflow/eval/staticIf.ts", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "Static `if:` evaluator no viewer surface ever called." },
  { kind: "path", path: "src/components/Editor/WorkflowPanel/GhaWorkflowPanel.tsx", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "No production mount since WI-2.4 moved YAML routing to the split pane; GhaWorkflowWorkbench is the shipped surface." },
  { kind: "path", path: "src/components/Editor/WorkflowPanel/WorkflowPanelShell.tsx", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "Only consumer was GhaWorkflowPanel (dead→dead pair); the workbench owns its own split shell." },
  { kind: "path", path: "src/workspace/useWorkspace.ts", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "ADR-008 read facade never adopted — zero production importers, not even re-exported by its barrel." },
  { kind: "symbol", name: "addMarkSyntaxDecorations", glob: "src/plugins", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "The syntaxReveal decoration half — never registered in tiptapExtensions.ts or WYSIWYG_COMPOSITION_ORDER; only the mark-range helpers were wired." },
  { kind: "path", path: "src/plugins/syntaxReveal/utils.ts", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "Widget factory for the deleted decoration half (createSyntaxWidget / addWidgetDecoration)." },
  { kind: "path", path: "src/plugins/syntaxReveal/syntax-reveal.css", deletedBy: "WI-FL3.1 (feature-ledger plan)", reason: "Styled the deleted syntax widgets; imported only by the decoration code." },
  { kind: "path", path: "src/plugins/toolbarContext/toolbarIntent.ts", deletedBy: "WI-FL3.12 (feature-ledger plan)", reason: "resolveToolbarIntent's one caller was the dead Source adapter; the WYSIWYG toolbar routes through enableRules.getToolbarItemState." },
  { kind: "symbol", name: "resolveToolbarIntent", glob: "src", deletedBy: "WI-FL3.12 (feature-ledger plan)", reason: "The resolver itself — see the path entry above." },
  { kind: "path", path: "src/plugins/editorPlugins/bookmarkLinkCommand.ts", deletedBy: "feature-ledger plan Phase 3 (WI-FL0.1 baseline)", reason: "Duplicate of wysiwygAdapterLinks.insertBookmarkLink; the keymap binds bookmarkLink via runEditorAction(\"bookmark\")." },
  { kind: "path", path: "src/plugins/editorPlugins/textTransformCommands.ts", deletedBy: "feature-ledger plan Phase 3 (WI-FL0.1 baseline)", reason: "Duplicate WYSIWYG case transforms; the shipped path is wysiwygAdapterFormatting via the command bus." },
  { kind: "path", path: "src/services/persistence/resilience/machine.ts", deletedBy: "feature-ledger plan Phase 3 (WI-FL0.1 baseline)", reason: "Advisory state machine nothing instantiated; the sequence lives in dev-docs/error-recovery.md and the coordinator's tests." },
  { kind: "symbol", name: "getGoogleFontUrl", glob: "src/export", deletedBy: "WI-FL3.9 (feature-ledger plan)", reason: "Exported GOOGLE_FONTS lookup with only test callers; getUserFontFile is the production path." },
  { kind: "symbol", name: "waitForAllImages", glob: "src/export", deletedBy: "WI-FL3.9 (feature-ledger plan)", reason: "Listener-based image waiter only its test called; waitForAssets polls isImageSettled for export and print." },
  { kind: "symbol", name: "SplitOrientation", glob: "src/stores", deletedBy: "WI-FL3.10 (feature-ledger plan)", reason: "The stacked document split had no writer; splits are side-by-side only and a persisted orientation is dropped on load." },
  {
    kind: "path",
    path: "src-tauri/src/content_server/slidev.rs",
    deletedBy: "WI-FL3.6 (dev-docs/plans/20260907-feature-ledger-fixes.md)",
    reason:
      "A #[allow(dead_code)] Rust builder for the `slidev export` argument vector, " +
      "with no caller: the export runs through the Node content server, which " +
      "shells out itself. The live half (SlidevExportFormat) moved into " +
      "slidev_commands.rs. Re-adding a second, unwired copy of the CLI shape " +
      "would be exactly the ledger finding this deletion closed.",
  },
  {
    kind: "symbol",
    name: "build_export_args",
    glob: "src-tauri/src",
    deletedBy: "WI-FL3.6 (dev-docs/plans/20260907-feature-ledger-fixes.md)",
    reason: "The unwired slidev argument builder itself — see the path entry above.",
  },
  {
    kind: "symbol",
    name: "list_directory_entries",
    glob: "src-tauri/src",
    deletedBy: "WI-FL3.2 (dev-docs/plans/20260907-feature-ledger-fixes.md)",
    reason:
      "A registered Tauri command with zero callers since #1357 replaced the " +
      "per-directory listing with the one-call list_directory_tree. Registered " +
      "IPC surface with no caller is attack surface that nothing tests; the " +
      "hidden-detection rule it carried lives on as file_tree::compute_is_hidden.",
  },
  {
    kind: "symbol",
    name: "request_quit",
    glob: "src-tauri/src/window_manager",
    deletedBy: "WI-FL3.2 (dev-docs/plans/20260907-feature-ledger-fixes.md)",
    reason:
      "window_manager::request_quit was a registered command with no frontend " +
      "caller that emitted app:quit-requested directly, bypassing the confirm-quit " +
      "gate. Quit is requested from the Rust menu dispatcher through " +
      "quit::request_quit(app) — which stays, outside this glob — so a second entry " +
      "point would reopen the bypass.",
  },
];
