# Work-Item Inventory (all plans) — 2026-06-07

> Purpose: a single consolidated list of every work item (WI) across
> `dev-docs/plans/*`, with the status **each plan claims about itself**, so we
> can audit whether the work is actually implemented and nothing is left behind.
>
> **Important:** the "Plan-stated status" column is what the plan *says*, not
> verified ground truth. The whole point of the next step is to confirm
> `Done` items are really shipped (commit/test linkage + code presence) and to
> resolve every `Unknown`. Verification has **not** been done yet.

## How statuses were derived

Each plan was read in full by a dedicated extractor. Status was taken from the
plan's `Status:` header, phase-level Definition-of-Done notes, and inline
per-WI markers.

| Status | Meaning |
|---|---|
| **Done** | Plan claims it shipped / phase complete. **Audit target: verify it's true.** |
| **Deferred** | Consciously pushed to a later version/phase. |
| **Aborted** | Consciously dropped / descoped / N/A. |
| **Pending** | Not started (plan is Draft / spike / forward-looking). |
| **Unknown** | Plan records *no* status — this is the riskiest bucket; needs investigation. |

## Summary

| Plan | Total | Done | Deferred | Aborted | Pending | Unknown |
|---|--:|--:|--:|--:|--:|--:|
| 20260530-audit-remediation | 42 | 40 | 1 | 1 | 0 | 0 |
| 20260504-github-actions-workflow-viewer | 36 | 35 | 1 | 0 | 0 | 0 |
| 20260418-genie-in-workflow | 18 | 17 | 0 | 0 | 0 | 1 |
| 20260531-terminal-industrial-best | 22 | 19 | 1 | 2 | 0 | 0 |
| 20260601-terminal-gap-remediation | 15 | 7 | 0 | 1 | 7 | 0 |
| 20260418-housecleaning (+ metrics) | 8 | 8 | 0 | 0 | 0 | 0 |
| 20260506-multi-format-rebrand | 59 | 17 | 1 | 1 | 3 | 37 |
| 20260504-mcp-pruning | 9 | 1 | 0 | 0 | 0 | 8 |
| 20260504-workflow-fence-snapshot | 6 | 1 | 0 | 0 | 0 | 5 |
| 20260505-gha-mature-viewer | 12 | 0 | 1 | 0 | 8 | 3 |
| 20260321-1600-industry-best-hardening | 20 | 0 | 0 | 0 | 0 | 20 |
| 20260321-1700-industry-best-hardening-v2 | 19 | 0 | 0 | 0 | 0 | 19 |
| 20260331-workflow-engine | 20 | 0 | 0 | 0 | 20 | 0 |
| 20260525-theme-unification | 22 | 0 | 0 | 0 | 22 | 0 |
| 20260523-grill-followup | 16 | 0 | 0 | 0 | 16 | 0 |
| 20260330-source-wysiwyg-parity | 14 | 0 | 0 | 0 | 14 | 0 |
| 20260321-1400-quality-hardening | 14 | 0 | 0 | 0 | 14 | 0 |
| 20260422-large-file-open-ux | 4 | 0 | 1 | 0 | 3 | 0 |
| 20260419-i18n-polish-and-announce | 4 | 0 | 0 | 0 | 4 | 0 |
| 20260419-i18n-release-notes | 5 | 0 | 0 | 0 | 5 | 0 |
| **Total** | **365** | **162** | **7** | **6** | **136** | **93** |

## Recommended audit priorities

1. **Verify the "Done" claims (162 items).** Highest value: a plan saying
   "Implemented" is exactly where rot hides. Start with the big ones —
   audit-remediation (40), gha-workflow-viewer (35), genie-in-workflow (17),
   terminal-industrial (19). Cross-check via `scripts/check-wi-linkage.sh` plus
   actual code/test presence.
2. **Resolve the 93 "Unknown" items.** Almost all live in **multi-format-rebrand
   (37)**, the two **industry-best-hardening** plans (39 combined), and the MCP
   plans. These plans never recorded WI status — each item is either silently
   done, partially done, or never started. This is where things get "left
   behind."
3. **Confirm "Pending"/"Draft" plans are genuinely not-started vs. superseded.**
   `workflow-engine` (20, Draft) and `source-wysiwyg-parity` (14) predate
   shipped work — some WIs may have been delivered under *other* plans and the
   draft never updated. `theme-unification` (22) is a clean spike-stage plan.
4. **Deferred/Aborted (13 items):** confirm each was a deliberate decision
   recorded in the plan, then leave alone.

---

## 20260530-audit-remediation.md — Status: Implemented (2026-05-30)

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-(-1).1 | Stabilize the flaky perf test | Done | Phase -1 done |
| WI-0.1 | Fix CJK char-boundary panic in PDF bookmark export | Done | Phase 0 done |
| WI-0.2 | Fix orphan-document resurrection on close-during-open | Done | met via remediation |
| WI-0.3 | Fix genie workflow execution-id race | Done | Phase 0 done |
| WI-0.4 | Fix multibyte timeout panic in workflow step config | Done | Phase 0 done |
| WI-0.5 | Make approval-registry locks poison-tolerant | Done | Phase 0 done |
| WI-0.6 | Unify divergent media-extension lists | Done | Phase 0 done |
| WI-0.7 | Resolve mcpBridge v1 utils: dead-or-buggy | Done | helpers DEAD, no fix |
| WI-0.8 | Finder hot-open TOCTOU | Done | Phase 0 done |
| WI-0.9 | Genie streaming applies to stale target | Done | Phase 0 done |
| WI-0.10 | MCP document.write per-tab revision | Done | Phase 0 done |
| WI-1.1 | Dead CSS sweep | Done | 539 lines removed; visual-QA half pending (live app) |
| WI-1.2 | Dead Tauri commands | Done | Phase 1 done |
| WI-1.3 | Dead TS exports + unused dep | Done | only confirmed-dead removed |
| WI-1.4 | Trim mcpBridge v1 utils.ts | Done | dead helpers deleted, respond kept |
| WI-1.5 | Decide restore_snapshot / list_snapshots | Done | decision: KEEP |
| WI-2.1 | codePreview: skip full-doc scan in prose-only docs | Done | Phase 2 |
| WI-2.2 | detect_ai_providers async + memoized | Done | Phase 2 |
| WI-2.3 | list_directory_entries async | Done | Phase 2 |
| WI-2.4 | OutlineView memoization | Done | Phase 2 |
| WI-2.5 | Lint engine: split source once | Done | Phase 2 |
| WI-2.6 | Make mermaid + cytoscape truly lazy | Aborted | size:why unavailable in vite/esbuild |
| WI-2.7 | Drop js-yaml + @types/katex | Done | Phase 2 |
| WI-2.8 | Lazy-load turndown on HTML paste | Deferred | needs async-claim paste refactor |
| WI-2.9 | Verify @actions parser isn't eager | Done | measured: NO LEAK |
| WI-3.1 | errorMessage() helper | Done | Phase 3 |
| WI-3.2 | MCP v2 wrapHandler | Done | Phase 3 |
| WI-3.3 | Shared buildPopupIconButton | Done | Phase 3 |
| WI-3.4 | Adopt useDismissOnOutsideOrEscape | Done | Phase 3 |
| WI-3.5 | Generic debounce util | Done | Phase 3 |
| WI-3.6 | Rust app_data_dir() + atomic_write() | Done | Phase 3 |
| WI-4.1 | Validate high-blast-radius IPC/event payloads | Done | 2 of 4 boundaries validated |
| WI-4.2 | Validate cross-tab settings StorageEvent | Done | Phase 4 |
| WI-4.3 | Null-safe DOM casts | Done | Phase 4 |
| WI-4.4 | Bound previewCache | Done | Phase 4 |
| WI-4.5 | Minor lifecycle fixes | Done | sessionCache bounded |
| WI-4.6 | ImageContextMenu keyboard support | Done | Phase 4 |
| WI-4.7 | ARIA state on toggles & dialogs | Done | Phase 4 |
| WI-5.1 | Test useWorkspaceBootstrap | Done | Phase 5 |
| WI-5.2 | Test genies/parsing.rs + unifiedHistory.ts | Done | Phase 5 |
| WI-5.4 | Test pure logic in genies/scanning.rs etc. | Done | Phase 5 (5.3 → Phase -1) |

## 20260504-github-actions-workflow-viewer.md — Status: phases 0–9 complete

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-0.1 | Spike A: parser shape | Done | PASS 100% position coverage |
| WI-0.2 | Spike B: image export | Done | PASS 44–75ms/export |
| WI-0.3 | Spike C: ProseMirror + static React Flow | Done | PASS 9/10 |
| WI-0.4 | Spike D: round-trip semantics | Done | PASS |
| WI-1.1 | IR types | Done | 141 tests |
| WI-1.2 | Parser orchestrator | Done | linkage 6/6 |
| WI-1.3 | Subparsers | Done | 22 fixtures parse |
| WI-1.4 | Detection heuristic | Done | Phase 1 |
| WI-1.5 | Workflow router | Done | Phase 1 |
| WI-1.6 | Fixture corpus | Done | 22 fixtures |
| WI-2.1 | Render adapter (toGraph) | Done | 47 tests |
| WI-2.2 | Layout (dagre/elk) | Done | Phase 2 |
| WI-2.3 | JobNode component | Done | Phase 2 |
| WI-2.4a | WorkflowPanelShell | Done | Phase 2 |
| WI-2.4b | GhaWorkflowPanel | Done | live-verified |
| WI-2.5 | Click-to-jump | Done | in JobNode click handler |
| WI-2.6 | File integration | Done | live verified |
| WI-3.1 | Tiptap NodeView | Done | via codePreview (ADR-9 revised) |
| WI-3.2 | Static-mode canvas | Done | inline preview renders |
| WI-3.3 | Cleanup discipline | Done | zero regressions |
| WI-4.1 | Mermaid export | Done | 16 tests |
| WI-4.2 | SVG/PNG export | Done | html-to-image dep |
| WI-4.3 | Export menu integration | Done | Phase 4 |
| WI-5.1 | Schema lint | Done | @actions/languageservice |
| WI-5.2 | Expression awareness | Deferred | to v2 |
| WI-5.3 | Optional actionlint (frontend) | Done | Phase 5 |
| WI-5.4 | Rust gha_lint command | Done | 28 tests |
| WI-6.1 | Frontend registry | Done | 25 tests |
| WI-6.2 | Tooltip preview | Done | moved to Phase 7, complete |
| WI-6.3 | Rust gha_fetch_action_yml command | Done | 24h cache |
| WI-7.1 | JobForm, StepForm, TriggerForm | Done | 47 form tests |
| WI-7.2 | Edit pipeline | Done | Phase 7 |
| WI-8.1 | yaml Document parser (cstParser) | Done | 32 tests |
| WI-8.2 | Mutators | Done | 15 tests; ADR-11 gate |
| WI-8.3 | Hot-swap save path | Done | applyAndSerialize |
| WI-9.x | Phase 9 polish (i18n, dark, a11y, perf, docs) | Done | 18/18 pass; human-only a11y → checklist |

## 20260418-genie-in-workflow.md — Status: Complete

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-0.1 | Nested YAML frontmatter parse for v1 genies | Done | inherits doc status |
| WI-0.2 | RawWorkflow.defaults and workflow-level overrides | Done | inherits doc status |
| WI-1.1 | AiSink trait and WindowSink impl | Done | inherits doc status |
| WI-1.2 | ChannelSink impl + run_ai_prompt_collect | Done | inherits doc status |
| WI-1.3 | Cancellation tokens + bounded collection | Done | closes C1/M3 |
| WI-2.1 | Rust template renderer | Done | inherits doc status |
| WI-2.2 | execute_genie in the runner | Done | inherits doc status |
| WI-2.3 | Structured outputs + expression parser | Done | inherits doc status |
| WI-2.4 | Remove genie/webhook pre-validation reject | Done | inherits doc status |
| WI-2.5 | Per-step timeout enforcement | Done | inherits doc status |
| WI-3.1 | Rust approval channel | Done | inherits doc status |
| WI-3.2 | Frontend approval dialog | Done | inherits doc status |
| WI-4.1 | useWorkflowExecution hook | Done | inherits doc status |
| WI-4.2 | Run / Cancel buttons in WorkflowSidePanel | Done | inherits doc status |
| WI-4.3 | Live status on React Flow nodes | Done | inherits doc status |
| WI-5.1 | Optional chunk streaming into step nodes | Unknown | "optional polish"; excluded from LOC total |
| WI-6.1 | Sample workflow using bundled v0 genies | Done | inherits doc status |
| WI-6.2 | Documentation (workflows.md guide) | Done | inherits doc status |

## 20260531-terminal-industrial-best.md — Status: phases 0–5 done (per header)

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-0.0 | Create check-terminal-phase.sh | Done | phases 0..6 exit 0 |
| WI-0.1 | Throughput baseline harness | Done | baseline doc |
| WI-0.2 | Spike: Tauri Channel binary delivery | Done | PASS (live) |
| WI-0.3 | Spike: zsh shell-integration (OSC 133/7) | Done | PASS live |
| WI-0.4 | Verify L1 orphan-process survival | Done | decided Phase 6 |
| WI-1.1 | PTY output → per-session binary Channel | Done | live-verified |
| WI-1.2 | Enlarge reader buffer to 64 KB | Done | live-verified |
| WI-1.3 | pty_write accepts Vec<u8> bytes | Aborted | N/A (input always valid UTF-8) |
| WI-1.4 | Re-baseline / simplify flow-control | Done | types narrowed, flow control kept |
| WI-2.1 | OSC 7 handler → store live cwd | Done | cd /tmp verified |
| WI-2.2 | Consumers read live cwd | Done | live-verified |
| WI-2.3 | Relative file links resolve against live cwd | Done | live-verified |
| WI-3.1 | Ship/inject shell-integration scripts + setting | Done | zsh-only; embedded-not-bundled |
| WI-3.2 | OSC 133 parser → command-boundary state | Done | A/C/D + exit codes |
| WI-3.3 | Prompt navigation + shortcuts | Done | terminal-scoped, not 3-file sync |
| WI-3.4 | Exit-status gutter decorations + duration | Done | OSC 133;D |
| WI-4.1 | File-link :line:col jump | Done | Phase 4 |
| WI-4.2 | OSC 8 hyperlinks | Done | Phase 4 |
| WI-4.3 | Title (OSC 0/2) + bell activity badge | Done | bell done; OSC 0/2 title deferred to Phase 7 |
| WI-5.1 | Persist terminal slice via Zustand persist | Deferred | to Phase 7 |
| WI-5.2 | Scrollback serialize or remove SerializeAddon | Done | dead addon removed |
| WI-6.1 | Process-group SIGHUP→SIGKILL killpg | Aborted | Phase 6 aborted per WI-0.4 |

## 20260601-terminal-gap-remediation.md — Status: phases 1–2 done, 3–4 not started

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-1.0 | Phase-DoD checker script | Done | Phase 1 |
| WI-1.1 | Resolve user's login-shell ZDOTDIR (Rust) | Done | login_shell_zdotdir wired |
| WI-1.2 | Pass USER_ZDOTDIR from prepare_shell_integration | Done | vmark.zsh sources user rc |
| WI-1.3 | Docs | Done | Phase 1 |
| WI-2.1 | Route ALL paste through term.paste() | Done | both paste paths |
| WI-2.2 | setupWebLinks.test.ts (security) | Done | Phase 2 |
| WI-2.3 | setupFileLinks.test.ts | Done | Phase 2 |
| WI-3.1 | screenReaderMode setting | Pending | Phase 3 not started |
| WI-3.2 | Program title → per-session tab title | Pending | Phase 3 not started |
| WI-4.1 | Live-sync fontFamily | Pending | Phase 4 not started |
| WI-4.2 | Configurable scrollback | Pending | Phase 4 not started |
| WI-4.3 | Reader I/O error logging (Rust) | Pending | Phase 4 not started |
| WI-4.4 | wait() killed children (Rust) | Pending | Phase 4 not started |
| WI-4.5 | Settings coverage — bell mode / contrast | Aborted | DESCOPED (2026-06-01) |
| WI-4.6 | Coverage backfill (§3) | Pending | Phase 4 not started |

## 20260418-housecleaning.md (+ -metrics.md) — Status: all phases done (per metrics doc)

| Item | Title | Status | Notes |
|---|---|---|---|
| Phase 0 | Baseline metrics capture | Done | before-numbers captured |
| Phase A | Dead code + dependency sweep | Done | 8 orphan files deleted, 2 deps removed |
| Phase B | File-size audit & split | Done | 7 TS targets split behind barrels |
| Phase C | Test suite audit | Done | no pruning; ≥20% target not met by design |

> The two files mirror each other (plan + metrics record). Counted once (4 units)
> in the summary, with the metrics doc as the evidence source.

---

## 20260506-multi-format-rebrand.md — Status: partial; many WIs unrecorded

> **Biggest audit target.** 37 of 59 WIs have no recorded status. "Background"
> table in the plan implies several shipped, but per-WI completion is unstated.

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-0.1 | SplitPaneEditor shape spike | Done | PASS for Phase 1A |
| WI-0.2 | Format registry shape spike | Done | registry shipped |
| WI-0.3 | Validator-to-gutter spike | Done | PASS |
| WI-0.4 | HTML iframe sandbox spike in Tauri webview | Pending | BLOCKED on user-run XSS test (Part B) |
| WI-0.5 | Tree preview library audit | Done | react-json-view-lite v2.5.0 |
| WI-0.6 | Community pack maintenance audit | Done | decisions recorded |
| WI-0.7 | Editor.tsx surface refactor risk audit | Done | rev-6 rebaseline basis |
| WI-1A.1 | types.ts format contract interfaces | Done | ships per Background |
| WI-1A.2 | registry.ts singleton + dispatchEditor | Done | shipped |
| WI-1A.3 | Markdown adapter (wysiwyg) | Done | shipped |
| WI-1A.4 | SplitPaneEditor skeleton | Unknown | no status |
| WI-1A.5 | Editor.tsx refactor to dispatchEditor | Unknown | no status |
| WI-1A.6 | Migrate sourceMode into markdown adapter | Unknown | no status |
| WI-1A.7 | Migrate useUnifiedMenuCommands to menuPolicy | Unknown | build-order long pole |
| WI-1A.8 | ValidationDiagnostic type + ValidationGutter | Unknown | no status |
| WI-1A.9 | Plain .txt adapter | Done | shipped |
| WI-1A.10 | SplitPaneEditor resize/theme/ARIA/focus | Unknown | no status |
| WI-1A.11 | Stub registrations for Phase 2-4 formats | Done | adapters shipped |
| WI-1A.12 | Tab kind-change contract (ADR-10) | Done | TabState carries format_id |
| WI-1A.13 | Hot-exit persistence migration (tab format fields) | Done | schema v3 migration |
| WI-1A.14 | Cross-format menu regression matrix | Unknown | added rev 6; no evidence |
| WI-1B.1 | Open dialog filter generalization | Done | registry-built filters |
| WI-1B.2 | Drag-drop filter generalization | Unknown | no status |
| WI-1B.3 | dropPaths SUPPORTED_EXTENSIONS | Done | consumed by dropPaths.ts |
| WI-1B.4 | Rust SUPPORTED_EXTENSIONS + check-ext-sync | Done | check-ext-sync.sh |
| WI-1B.5 | Rust validate_openable_path allow-list expansion | Unknown | no status |
| WI-1B.6 | useFinderFileOpen registry dispatch migration | Unknown | no status |
| WI-1B.7 | useRecentFilesMenuEvents registry dispatch migration | Unknown | no status |
| WI-1B.8 | closeSave per-tab filters generalization | Done | per-tab via dispatchEditor |
| WI-1B.9 | useFileSave default filename per untitledExtension | Unknown | no status |
| WI-1B.10 | createUntitledTab optional formatId | Unknown | no status |
| WI-1B.11 | macOS Open With document-type expansion | Unknown | no status |
| WI-1B.12 | CLI argv handling for non-markdown paths | Unknown | no status |
| WI-1B.13 | Content-search scope expansion | Unknown | no status |
| WI-1B.14 | useExternalFileChanges reloadPolicy | Unknown | no status |
| WI-1B.15 | Tab kind-change contract (placeholder) | Aborted | moved to WI-1A.12 |
| WI-1B.16 | macOS quarantine flow generalization | Unknown | no status |
| WI-2.1 | JSON / JSONL adapter | Unknown | stubs shipped; impl unstated |
| WI-2.2 | TOML adapter | Unknown | no status |
| WI-2.3 | YAML adapter | Unknown | no status |
| WI-2.4 | GHA workflow detector wire-up (POC #1) | Unknown | no status |
| WI-2.5 | Cargo.toml detector + dep-tree (POC #2) | Unknown | adapter listed; impl unstated |
| WI-2.6 | Delete yamlOpenRouting.ts | Pending | still live until WI-2.6 |
| WI-3.1 | Standalone .mmd adapter | Unknown | Mermaid renderer still impure |
| WI-3.2 | Standalone .svg adapter | Unknown | no status |
| WI-3.3 | .html / .htm adapter | Unknown | no status |
| WI-3.4 | Security review checkpoint (HTML XSS) | Pending | BLOCKED on user XSS sign-off |
| WI-4.1 | Language pack registration | Unknown | no status |
| WI-4.2 | Read-only banner above source pane | Unknown | no status |
| WI-4.3 | Per-tab editing toggle | Unknown | no status |
| WI-4.4 | open_in_external_editor Tauri command | Unknown | open question still to verify |
| WI-5.1 | package.json detector + dep-tree view | Unknown | adapter listed; impl unstated |
| WI-5.2 | pyproject.toml detector + dep-tree view | Unknown | open question to decide |
| WI-5.3 | OpenAPI / Swagger browser | Deferred | Phase 5b |
| WI-6.1 | Tagline propagation across files | Unknown | gated on Phase 2 |
| WI-6.2 | Website restructure | Unknown | no status |
| WI-6.3 | website/guide/formats.md | Unknown | no status |
| WI-6.4 | Launch artifact (blog + screenshots) | Unknown | no status |
| WI-6.5 | Translation pass across 9 locales | Unknown | no status |

## 20260504-mcp-pruning.md — Status: Phase 1 in progress (+ Phase 2 added)

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-1.1 | Plan doc | Done | file present |
| WI-1.2 | New dispatchers (session/workspace/document/workflow) | Unknown | no per-WI marker |
| WI-1.3 | New server tool registrations (4 files) | Unknown | no marker |
| WI-1.4 | Tests for the new surface (TDD) | Unknown | no marker |
| WI-1.5 | Delete dropped handlers/dispatchers/tools/locales/tests | Unknown | no marker |
| WI-1.6 | Website docs rewrite (mcp-tools.md) | Unknown | no marker |
| WI-1.7 | Version bump (5 files, breaking) | Unknown | no marker |
| WI-1.8 | Final gate: check:all + Tauri MCP smoke | Unknown | live-smoke note suggests partial |
| WI-2.1 | selection.{get,set} bridge handlers + registration | Unknown | added 2026-05-08 |

## 20260504-workflow-fence-snapshot.md — Status: Phase 1 in progress

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-1.1 | Plan doc | Done | file present |
| WI-1.2 | renderXyflowSnapshot: hidden root, FIFO queue, cache | Unknown | no marker |
| WI-1.3 | Wire createWorkflowPreviewWidget to renderXyflowSnapshot | Unknown | no marker |
| WI-1.4 | Drop dead workflowYamlToMermaid codepath | Unknown | no marker |
| WI-1.5 | Live smoke (F6 round-trip, parity) | Unknown | no marker |
| WI-1.6 | Final gate: check:all + size-limit | Unknown | Phase 2 note implies v1 work occurred |

## 20260505-gha-mature-viewer.md — Status: Phase A in progress, B+C pending

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-A.1 | Expression-context autocomplete in CodeMirror | Unknown | Phase A in progress |
| WI-A.2 | Action input completion in StepForm | Unknown | no marker |
| WI-A.3 | Cron human-readable preview | Unknown | no marker |
| WI-B.1 | Local action discovery | Pending | Phase B pending |
| WI-B.2 | Go-to-def for reusable workflows + local actions | Pending | Phase B pending |
| WI-B.3 | Source-cursor → canvas-node highlight | Pending | Phase B pending |
| WI-B0 | Local-workflow path resolver + file-open helper | Pending | Phase B-prime |
| WI-C0 | Preview IR from parsed + pending patches | Pending | Phase C0 |
| WI-C.1 | Add/remove jobs | Pending | Phase C pending |
| WI-C.2 | Add/remove/reorder steps | Pending | Phase C pending |
| WI-C.3 | Permissions + concurrency forms | Pending | Phase C pending |
| WI-5.2 | if-path eval | Deferred | deferred |

---

## 20260321-1600-industry-best-hardening.md — Status: none recorded

> No status field anywhere. v2 (below) supersedes much of this; cross-reference.

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-001 | Cross-platform CI matrix | Unknown | no status |
| WI-002 | Security scanning in CI | Unknown | no status |
| WI-003 | HTML lang attribute | Unknown | v2 marks already-done |
| WI-004 | Install vitest-axe + a11y test helpers | Unknown | no status |
| WI-005 | Add ARIA landmarks to App layout | Unknown | no status |
| WI-006 | Expand reduced-motion support | Unknown | no status |
| WI-007 | Add a11y tests to key components | Unknown | no status |
| WI-008 | Performance benchmark suite | Unknown | no status |
| WI-009 | Memory leak detection tests | Unknown | v2 removes it |
| WI-010 | Disk-full error handling tests | Unknown | no status |
| WI-011 | Corrupted config recovery tests | Unknown | no status |
| WI-012 | Concurrent modification protection | Unknown | no status |
| WI-013 | Error recovery documentation | Unknown | v2 removes it |
| WI-014 | Add per-tool version to capabilities | Unknown | no status |
| WI-015 | Action deprecation infrastructure | Unknown | no status |
| WI-016 | MCP API changelog | Unknown | v2 removes it |
| WI-017 | Rust mutation testing | Unknown | no status |
| WI-018 | E2E test scenarios (documented) | Unknown | v2 removes it |
| WI-019 | CONTRIBUTING.md | Unknown | no status |
| WI-020 | Architecture Decision Records | Unknown | v2 removes it |

## 20260321-1700-industry-best-hardening-v2.md — Status: none recorded

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-001 | Migrate API keys from localStorage to secure storage | Unknown | no status |
| WI-002 | MCP bridge authentication | Unknown | no status |
| WI-003 | Per-window capability segmentation | Unknown | no status |
| WI-004 | Remove CSP unsafe-inline for scripts | Unknown | no status |
| WI-005 | Executable E2E smoke harness | Unknown | no status |
| WI-006 | Fault injection test suite | Unknown | no status |
| WI-007 | Concurrent modification protection | Unknown | no status |
| WI-008 | Updater hardening | Unknown | no status |
| WI-009 | Hardcoded English string audit + fix | Unknown | no status |
| WI-010 | ARIA landmarks | Unknown | no status |
| WI-011 | vitest-axe + component a11y tests | Unknown | no status |
| WI-012 | Reduced-motion support (targeted) | Unknown | no status |
| WI-013 | Security scanning in CI | Unknown | no status |
| WI-014 | Cross-platform CI (macOS + Ubuntu + Windows) | Unknown | no status |
| WI-015 | Performance benchmarks (real, not synthetic) | Unknown | no status |
| WI-016 | Rust mutation testing | Unknown | no status |
| WI-017 | Fuzz testing for parsers | Unknown | no status |
| WI-018 | Error recovery documentation | Unknown | no status |
| WI-019 | CONTRIBUTING.md | Unknown | no status |

## 20260331-workflow-engine.md — Status: Draft (not started)

> Predates `genie-in-workflow` and the GHA viewer. Several WIs here may have
> shipped under *those* plans — confirm before treating as outstanding.

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-1.1 | WorkflowGraph Data Model | Pending | Draft |
| WI-1.2 | YAML-to-WorkflowGraph Parser | Pending | Draft |
| WI-1.3 | Static Image Export from React Flow | Pending | Draft |
| WI-2.1 | Install Dependencies | Pending | Draft |
| WI-2.2 | YAML File Type in File Explorer | Pending | Draft |
| WI-2.3 | Auto-Layout Engine | Pending | Draft |
| WI-2.4 | Custom Workflow Node Component | Pending | Draft |
| WI-2.5 | Workflow Side Panel | Pending | Draft |
| WI-3.1 | Genie Spec v1 Type Definitions | Pending | Draft |
| WI-3.2 | Genie v1 Parser (Rust) | Pending | Draft |
| WI-3.3 | Workflow Type Checking | Pending | Draft |
| WI-4.1 | YAML CodeMirror Language Support | Pending | Draft |
| WI-4.2 | Genie Auto-Complete in YAML | Pending | Draft |
| WI-5.1 | Workflow Execution Store | Pending | Draft |
| WI-5.2 | Step Executor (Rust Backend) | Pending | Draft |
| WI-5.3 | Live Execution Overlay on React Flow | Pending | Draft |
| WI-5.4 | File Snapshots for Undo | Pending | Draft |
| WI-5.5 | Approval Dialog | Pending | Draft |
| WI-6.1 | Webhook Connector Spec | Pending | Draft |
| WI-6.2 | Webhook Executor (Rust) | Pending | Draft |

## 20260525-theme-unification.md — Status: Phase 0 (spike)

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-0.1 | Author paper ThemeTokens with terminal block | Pending | spike |
| WI-0.2 | Side-by-side byte-identical ITheme proof script | Pending | spike |
| WI-1.1 | Add terminal block to ThemeTokens contract | Pending | not reached |
| WI-1.2 | Create five theme files from legacy const | Pending | not reached |
| WI-1.3 | applyTheme.ts writes terminal CSS vars | Pending | not reached |
| WI-1.4 | Add applyTheme tests for theme switch | Pending | not reached |
| WI-2.1 | Create buildXtermTheme.ts from typed tokens | Pending | not reached |
| WI-2.2 | Update terminal instance imports to @/theme | Pending | not reached |
| WI-2.3 | Delete terminalTheme.ts and ansiPalettes | Pending | not reached |
| WI-2.4 | Update test mocks for appearance.theme | Pending | not reached |
| WI-2.5 | Regression snapshot ITheme per theme | Pending | not reached |
| WI-3.1 | Re-export themes from @/theme in store | Pending | not reached |
| WI-3.2 | Migrate dark-mode override into night theme | Pending | not reached |
| WI-3.3 | Reduce useTheme.ts to lookup + applyTheme | Pending | not reached |
| WI-3.4 | Theme picker reads Object.keys(themes) | Pending | not reached |
| WI-3.5 | Merge terminal font/lineHeight into editor | Pending | not reached |
| WI-4.1 | Audit index.css, move overrides to ThemeTokens | Pending | not reached |
| WI-4.2 | Remove alias chains via codemod | Pending | not reached |
| WI-4.3 | Optional split of index.css | Pending | optional |
| WI-4.4 | Screenshot harness, gitignored baselines | Pending | not reached |
| WI-5.1 | Add 6th theme to prove single-file edit | Pending | not reached |
| WI-5.2 | CI guard for theme-name strings | Pending | optional |

## 20260523-grill-followup.md — Status: Draft (Phase 1 not started)

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-1.1 | Rev-6 rebaseline of multi-format plan | Pending | Draft |
| WI-1.2 | Hot-exit persistence migration | Pending | Draft |
| WI-1.3 | Menu regression matrix across formats | Pending | Draft |
| WI-1.4 | CI workflow verification | Pending | Draft |
| WI-1.5 | Cross-model review re-run | Pending | Draft |
| WI-2.1 | File-tree chevron as keyboard-operable button | Pending | Draft |
| WI-2.2 | Keyboard-resizable sidebar | Pending | Draft |
| WI-2.3 | Sidebar toggle aria-expanded binding | Pending | Draft |
| WI-2.4 | Search input accessible labels | Pending | Draft |
| WI-3.1 | Workflow runner if: evaluation tests | Pending | Draft |
| WI-3.2 | Hot-exit storage / coordinator tests | Pending | Draft |
| WI-3.3 | MCP bridge Rust protocol tests | Pending | Draft |
| WI-4.1 | MCP cross-side type-contract test | Pending | Draft |
| WI-4.2 | Terminal IME state consolidation | Pending | Draft |
| WI-4.3 | Multi-cursor it.todo drainage | Pending | Draft |
| WI-4.4 | Verified dead-code cleanup | Pending | Draft |

## 20260330-source-wysiwyg-parity.md — Status: forward-looking (not started)

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-0 | Audit existing multi-cursor behavior | Pending | spike |
| WI-1 | Enhanced Select Next Occurrence (Cmd+D) in Source | Pending | conditional on WI-0 |
| WI-2 | Enhanced Select All Occurrences (Cmd+Shift+L) in Source | Pending | depends on WI-0,1 |
| WI-3 | Math inline editing popup for Source Mode | Pending | files to create |
| WI-4 | Media popup parity (video/audio/iframe) in Source | Pending | not done |
| WI-5 | Footnote popup — formatting preservation audit | Pending | audit only |
| WI-6 | Smart paste — HTML to Markdown in Source | Pending | design checkpoint |
| WI-7 | Image paste to upload in Source Mode | Pending | files to modify |
| WI-8 | Drag-and-drop file insertion in Source Mode | Pending | audit first |
| WI-9 | Image width/resize in Source Mode | Pending | files to modify |
| WI-10 | Smart select-all (block expansion) in WYSIWYG | Pending | file to create |
| WI-11 | Frontmatter panel in WYSIWYG mode | Pending | prototype first |
| WI-12 | Regex search on markdown syntax in WYSIWYG | Pending | files to modify |
| WI-13 | Unblock read-only MCP operations in Source Mode | Pending | not started |

## 20260321-1400-quality-hardening.md — Status: forward-looking (not started)

| WI-ID | Title | Status | Notes |
|---|---|---|---|
| WI-001 | Add cargo test to CI | Pending | no marker |
| WI-002 | Security — validate Pandoc source_dir | Pending | no marker |
| WI-003 | Security — replace expect() with graceful errors in lib.rs | Pending | no marker |
| WI-004 | Security — MCP server type validation | Pending | no marker |
| WI-005 | Accessibility — HeadingPicker ARIA + focus trap | Pending | no marker |
| WI-006 | Accessibility — missing focus-visible in popup CSS | Pending | no marker |
| WI-007 | Accessibility — settings components focus styling | Pending | no marker |
| WI-008 | Add 20 error loggers to debug.ts | Pending | no marker |
| WI-009 | Migrate console.error calls to debug loggers | Pending | depends on WI-008 |
| WI-010 | Migrate console.warn calls to debug loggers | Pending | depends on WI-008 |
| WI-011 | Rust tests — mcp_bridge/state.rs expansion | Pending | depends on WI-001 |
| WI-012 | Rust tests — pandoc module | Pending | depends on WI-002 |
| WI-013 | Rust tests — quit module expansion | Pending | depends on WI-001 |
| WI-014 | Console lint CI gate | Pending | depends on WI-009,010 |

## 20260422-large-file-open-ux.md — Status: none recorded (Phase A ships first)

| Item | Title | Status | Notes |
|---|---|---|---|
| Phase A | Source-mode auto-open + warning + hard refuse | Pending | ships first |
| Phase B | Minimal indeterminate open indicator | Pending | optional |
| Phase C | Deferred heavy-work during WYSIWYG mount | Deferred | NOT COMMITTED |
| Cross | Perf harness (corpus + measure-open-latency) | Pending | manual gate |

## 20260419-i18n-polish-and-announce.md — Status: none recorded (checkboxes unticked)

| Item | Title | Status | Notes |
|---|---|---|---|
| Phase 1 | OS language auto-detection on first launch | Pending | all ACs unchecked |
| Phase 2 | Rust error strings i18n (errors namespace + macro) | Pending | all ACs unchecked |
| Phase 3 | Extend translate-docs skill to cover app strings | Pending | all ACs unchecked |
| Phase 4 | Announce ready (landing/README/release notes) | Pending | all ACs unchecked |

## 20260419-i18n-release-notes.md — Status: none recorded (release checklist)

| Item | Title | Status | Notes |
|---|---|---|---|
| `[ ]` | Bump all 5 version files per rule 40 | Pending | unchecked |
| `[ ]` | Tag release | Pending | unchecked |
| `[ ]` | Include release paragraph in GitHub Release | Pending | unchecked |
| `[ ]` | Verify website shows "Speaks Your Language" card | Pending | unchecked |
| `[ ]` | Announce on README / home / Discussions | Pending | unchecked |
