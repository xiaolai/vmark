# Gate G1 — Capture Coverage (WI-0.3)

> Status: **PASS** — all 5 write-path classes produce complete spec-conformant transformations; protocol checks (torn-line recovery, idempotent replay, identity masking) green.

- **Plan:** `dev-docs/plans/20260718-coherence-layer.md` WI-0.3 (traces R26,
  R2, R9, G1)
- **Spec:** `dev-docs/specs/coherence-format-v0.md`
- **Probe:** `probes/g1-capture.mjs` → `probes/g1-results.json`
- **Date:** 2026-07-18

## Method

G1 asks: can every path that mutates workspace state produce a complete
transformation record (R26), with exact input sets on AI paths (R2) and
honest gap-marking everywhere else (R9)?

Two parts:

1. **Write-path inventory** (below) — every mutation path traced through
   the codebase to its disk primitive, with the capture insertion point and
   the fields verifiably in scope there (file:line references).
2. **Capture prototype** — for one representative path per class, the probe
   constructs the transformation from exactly those in-scope fields,
   appends it to a real `.vmark/ledger/` (O_APPEND single-line writes +
   fsync, per spec §5), validates it against the entry schema, then
   exercises crash recovery (torn final line → quarantine), idempotent
   replay (dedupe by `idem`), and the §3.3 identity-masking property.

Live in-app capture (running desktop app) is deliberately WI-1.6's job;
this gate establishes that the data needed for capture *exists in scope* at
each insertion point and that the ledger protocol survives the failure
modes. The inventory's file:line claims were verified by direct code
reading.

## Write-path inventory (R26)

Disk primitives: **A** = `atomic_write_file` (temp + fsync + rename,
`src-tauri/src/file_write.rs:87` → `atomic_replace.rs:81`); **W** =
`writeTextFile` (plugin-fs, plain truncate-write, non-atomic); **T** =
`tokio::fs::write` (non-atomic).

| # | Path class | Entry point → disk | Prim. | Capture insertion point | In scope at insertion | Agent | Confidence | Crash recovery |
|---|---|---|---|---|---|---|---|---|
| 1 | Editor autosave/manual save | `useAutoSave.ts:87` / menu → `saveToPath.ts:234` | A | `saveToPath.ts` (single funnel) | tabId, path, content, saveType, prior buffer | human | exact (prior-revision link) | Atomic write; snapshot-before-append per spec §5.2 |
| 2 | AI-suggestion apply / genie output | `aiStore/suggestion.ts:147` → editor transaction → path 1 | A | `genieInvocation/streamRunner.ts:126-178` | genie name, `genie.metadata.model`, `ExtractionResult` (scope, context radius), referenced docs in prompt | model | exact | Suggestion is in-buffer until save; capture at apply, content at save |
| 3 | MCP document tools | `mcpBridge/v2/document.ts:252-365` (write at `:343`), `workspace.ts:193`, `workspaceSaveAs.ts:100` | W | `document.ts:341-347` (beside `recordCheckpoint`) | filePath, content, contentBefore, revisions, **session-observed read set** | model (external client) | **inferred** — see finding 2 | Non-atomic write; pending-save markers; checkpoint JSONL exists |
| 4 | Workflow genie `action/save-file` | `workflow/runner.rs:869` (sandboxed `validate_path`) | T | `runner.rs` step executor | step id, `read-file`/`read-folder` targets, genie params, outputs map | model | exact | Snapshot dir exists (`workflow/snapshots.rs`); write non-atomic |
| 5 | Terminal (PTY) / external editors | `pty.rs` children, `external_editor.rs`, any other tool | — | Watcher `fs:changed` → scan reconciliation | path, new disk content, last known revision from index | external | unknown | Observed-external synthesis (R9); no interception possible |
| 6 | File-explorer "new file" | `useExplorerOperations.ts:67` | W | same handler | path (content is empty) | human | exact | Trivial (empty file) |
| 7 | History "revert to snapshot" | `Sidebar/HistoryView.tsx:122` | W | same handler | path, snapshot content, snapshot id | human | exact | Non-atomic write |
| 8 | Non-workspace writes (hot-exit session, crash recovery, exports, config, checkpoint JSONL) | various | A/W | **not captured** — outside workspace state | — | — | — | Out of scope by definition (R26 covers workspace state) |

Classification per R26: paths 1–4, 6, 7 are **instrumented** in Phase 1
(WI-1.6 for the AI paths; 1, 6, 7 are human paths captured at the same
funnels); path 5 is **observed-external** — explicitly classified, no
silently uncaptured path. Rows 6/7 ride the same frontend funnel
conventions as rows 1/3 and add no new capture design.

## Prototype results

`probes/g1-results.json` (run 2026-07-18, exit 0):

| Check | Result |
|---|---|
| editor-save (human) transformation | complete, schema-valid |
| genie/ai-suggestion apply (model) | complete, exact input set (scene + character sheet) |
| mcp document.write (external agent) | complete, session-read input set, confidence `inferred` |
| workflow save-file (model) | complete, direct + contextual roles |
| terminal/external (observed) | complete, empty inputs, confidence `unknown` |
| Torn final line → quarantine | 1 line quarantined, 5 entries survive |
| Append after torn tail | writer terminates tail first; 6th entry clean |
| Idempotent replay | duplicate `idem` collapses to one logical entry |
| Identity masking (§3.3) | adding `vmark.id` leaves `content_hash` unchanged (existing and synthesized frontmatter) |

## Findings (fed back into the spec)

1. **Torn-tail termination rule.** O_APPEND after a crash-torn line
   corrupts the next entry unless the writer first terminates the torn
   fragment with `\n`. Added to spec §5.2 as a writer obligation
   (termination is the only permitted repair; readers still never rewrite).
2. **MCP writes are `inferred`, not `exact`.** VMark can capture the
   session-observed read set of an external MCP client precisely, but the
   client's *true* prompt context (files read via its own tools, web
   sources, its conversation) is unobservable. Recording these as `exact`
   would be false precision (R28). Spec §8 producers table updated: MCP
   bridge writes ⇒ `inferred`; in-app AI paths (genies, suggestion apply,
   workflow steps) ⇒ `exact`.
3. **Atomicity asymmetry.** Only the interactive editor save path is
   atomic today; all AI/MCP paths use plain `writeTextFile` /
   `tokio::fs::write`. Capture (WI-1.6) must not assume atomic content
   writes: the ledger append happens after the content write succeeds, and
   a crash between content write and append is healed by scan
   reconciliation (R9) — same mechanism as external edits, no special
   case.
4. **Attribution today is memory-only.** The MCP checkpoint records tool
   name but not model identity; genie flows know `genie.metadata.model`
   in scope but persist nothing. All attribution needed for `agent` fields
   is available at the insertion points; none of it currently reaches
   disk — the ledger is the first persistent home.

## Go/no-go

**GO.** Every workspace-mutating path is either instrumentable with the
fields the spec needs (verified in scope at the named insertion points) or
explicitly classified observed-external. The capture protocol survives
torn writes and replays. No path requires design changes beyond the two
spec amendments above, both already applied.
