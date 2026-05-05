# GHA mature viewer — gap-closing plan

> Status: Phase A in progress (started 2026-05-05). Phase B + C pending.
> Builds on `20260504-github-actions-workflow-viewer.md` (10 phases shipped).
> Closes 10 of 19 mature-tooling gaps identified in the post-ship analysis.
> Six items deferred (ADR / scope decisions): #4 if-path eval (WI-5.2 deferred),
> #11 action version picker (GitHub API auth), #16 run-history overlay (ADR
> defer), #17 inline-fence WYSIWYG editing (codePreview contract change),
> #18 snippet library (curation), #19 `act` runner (new dep).

## 1. Executive summary

Three phases (A: source IDE polish; B: navigation; C: form coverage),
~10 work items, ~50 LOC of changed surface per WI on average. Each WI is
TDD-first per `.claude/rules/10-tdd.md`. The whole batch is a single
post-plan iteration on the original GHA viewer; it does not change any
ADR. Phases are independently shippable and can be reviewed/merged in
order without waiting for the full set.

## 2. ADR-level non-decisions

This plan deliberately changes **no** ADRs. It builds inside the existing
architecture:

- ADR-2 (WorkflowIR pivot) — all new features consume the IR; none mutate it.
- ADR-3 (single parser stack) — no new parsers.
- ADR-7 (lint via languageservice + actionlint) — no new linter.
- ADR-11 (CST round-trip) — new mutators slot into the existing patch
  pipeline (`save/mutators.ts` + CST surgery), not into a separate path.

Six gap-list items that *would* require ADR changes are explicitly out of
scope (listed in the plan header).

## 3. Phase A — Source-side IDE polish

### WI-A.1 — Expression-context autocomplete (in CodeMirror)

Files: `src/lib/ghaWorkflow/completion/expressionCompletion.ts` (new),
`src/lib/codemirror/extensions/workflowCompletion.ts` (new wire-up),
`src/components/Editor/SourceMode/*` (extension registration).

Behavior: when the cursor is inside `${{ }}` in a workflow YAML file,
suggest:
- `github.*` (event, ref, sha, actor, etc.) — static catalog
- `env.*` — keys defined at workflow / job / step env (scope-aware)
- `steps.<id>.outputs.*` — derived from prior steps in the same job
- `needs.<job>.outputs.*` — derived from job outputs of needs[] refs
- `inputs.*` — workflow_call inputs from the trigger IR
- `secrets.*` — workflow_call secrets + static catalog
- `matrix.*` — strategy.matrix dimensions

Acceptance: cursor positions inside `${{ }}` produce IR-derived completions;
positions outside produce nothing. Test fixtures cover all 7 contexts.

### WI-A.2 — Action input completion in StepForm

Files: `src/components/Editor/WorkflowEditor/StepForm.tsx` (modify),
`src/components/Editor/WorkflowEditor/useActionMetadata.ts` (modify).

Behavior: when a `with:` row's key field is focused for a uses-step,
surface the action's known inputs as a datalist of suggestions with
description + required + default visible. Free-form keys still allowed.

Acceptance: `actions/checkout@v4` step's `with:` row shows `repository`,
`ref`, `token`, `path`, `clean`, `fetch-depth`, etc. with inline help.

### WI-A.3 — Cron human-readable preview

Files: `src/components/Editor/WorkflowEditor/TriggerForm.tsx` (modify).
Dep: `cronstrue` (~3kb gzipped, well-maintained).

Behavior: each `schedule.cron` value renders an inline tooltip / caption
with the human-readable form. Schedules under 5-minute interval flag
with a warning (per actionlint, GHA throttles silently).

Acceptance: `0 2 * * 1-5` renders "At 02:00 AM, Monday through Friday".

## 4. Phase B — Navigation polish

### WI-B.1 — Local action discovery

Files: `src/lib/ghaWorkflow/actions/registry.ts` (modify),
`src-tauri/src/gha/actions.rs` (modify Rust handler).

Behavior: registry resolves `./path/to/action` against the workspace
root, reads the action.yml from disk, and returns the same
`ActionMetadata` shape as remote actions.

Acceptance: a workflow that uses `./.github/actions/setup` shows the
action's inputs in StepForm completions.

### WI-B.2 — Go-to-def for reusable workflows + local actions

Files: `src/components/Editor/SourceMode/extensions/workflowGoto.ts` (new),
`src/stores/tabStore.ts` consumer (modify).

Behavior: cursor on `uses: ./.github/workflows/build.yml@main` (reusable)
or `uses: ./.github/actions/setup` (local) — Cmd-Click jumps to that file
in a new tab; if file missing, show a soft warning.

Acceptance: integration test opens a workflow, simulates Cmd-Click on a
local-action `uses:`, asserts new tab opens with the action.yml content.

### WI-B.3 — Source-cursor → canvas-node highlight

Files: `src/components/Editor/SourceMode/extensions/workflowCursorSync.ts`
(new), `src/stores/workflowViewStore.ts` (selectJob path already exists).

Behavior: when cursor in source moves over a job's lines (using the
parser's `position` field on JobIR), select that job in the side panel.
Reverse direction (canvas click → source scroll) is already implemented.

Acceptance: cursor placed on line N inside job `build:` → JobNode for
`build` shows selected styling in the side panel.

## 4.5. Phase B-prime — Shared infrastructure (Codex finding)

### WI-B0 — Local-workflow path resolver + file-open helper

Files: `src/lib/ghaWorkflow/paths.ts` (new),
`src/hooks/useOpenWorkflowTarget.ts` (new).

Behavior: shared utility that resolves a workflow `uses:` ref against the
workspace root (handles `./`, sibling reusable workflows, missing files).
Used by both WI-B.1 (registry resolves local actions) and WI-B.2 (Cmd-Click
opens local target). Returns a normalized absolute path + a "missing"
verdict so callers can show appropriate UX.

Acceptance: unit tests for path resolution edge cases — `./foo`, `../foo`,
`./foo.yml`, missing file, file outside workspace root.

## 4.6. Phase C0 — Draft IR overlay (Codex finding)

### WI-C0 — Preview IR from parsed + pending patches

Files: `src/stores/workflowEditStore.ts` (modify),
`src/lib/ghaWorkflow/save/applyPatches.ts` (modify or new).

Problem: `WorkflowEditorPanel` reads from the parsed source IR, but
form edits live in `pendingPatches[]` until save. A freshly-added job
(WI-C.1) or reordered step (WI-C.2) is not yet in the parsed IR, so
follow-on edits target stale state.

Behavior: derive `previewIR` from `parsedIR + pendingPatches.applyAll()`
as a memoized selector. WorkflowEditorPanel and form children read
`previewIR`. Save flushes patches → reparse → previewIR === parsedIR.

Acceptance: integration test — add job, modify step in that newly-added
job before save, observe both patches preserved post-save and CST shape
correct.

## 5. Phase C — Form coverage

### WI-C.1 — Add/remove jobs

Files: `src/lib/ghaWorkflow/save/mutators.ts` (modify),
`src/components/Editor/WorkflowEditor/JobForm.tsx` (modify),
`src/components/Editor/WorkflowPanel/WorkflowCanvas.tsx` (right-click menu).

Patches: `job.create({ id, runs-on })`, `job.delete({ id })`.

Behavior: right-click on canvas empty area → "Add job"; right-click on
JobNode → "Delete job". Form for new job pre-fills sensible defaults
(`runs-on: ubuntu-latest`).

Acceptance: round-trip test — add job, save, reparse, verify job exists
in IR with correct shape; CST preserves comments.

### WI-C.2 — Add/remove/reorder steps

Files: `src/lib/ghaWorkflow/save/mutators.ts` (modify),
`src/components/Editor/WorkflowEditor/JobForm.tsx` (modify step list UI).

Patches: `step.insert({ jobId, index, step })`,
`step.delete({ jobId, stepIndex })`,
`step.move({ jobId, fromIndex, toIndex })`.

Behavior: step list in JobForm gets "+" button at the bottom + drag-handle
for reorder + trash icon per row. New step defaults to a `run:` step
with empty body.

Acceptance: TDD on each patch kind; integration test for a 3-step
job: insert at index 1, move 0→2, delete 0.

### WI-C.3 — Permissions + concurrency forms

Files: `src/components/Editor/WorkflowEditor/PermissionsForm.tsx` (new),
`src/components/Editor/WorkflowEditor/ConcurrencyForm.tsx` (new),
`src/components/Editor/WorkflowEditor/WorkflowEditorPanel.tsx` (mount above
TriggerForm).

Behavior: workflow-level forms for permissions (read-all/write-all/none/
per-scope mapping) and concurrency (group string, cancel-in-progress
toggle).

Acceptance: forms render current IR values; edits emit
`workflow.permissions.set` and `workflow.concurrency.set` patches; CST
preserves shape.

## 6. Definition of Done (per WI)

- TDD: failing test → minimal impl → green
- Test types: parser/mutator (vitest), component (@testing-library/react),
  integration (the DaG round-trip test for save-pipeline patches)
- `pnpm check:all` exit 0 on every WI commit
- Affected dev-docs / website docs updated per rule `21-website-docs.md`
- Commit message includes WI-A.X / WI-B.X / WI-C.X linkage per rule 60.2
- Codex cross-review on the full plan before Phase A commits (rule 60.6)
- Codex `audit-fix --mini` on the full diff after Phase C lands

## 7. Risks

- **Expression autocomplete scope creep** (WI-A.1): the `@actions/languageservice`
  ContextProviderConfig path is the "right" implementation but is what
  WI-5.2 deferred. We're shipping a simpler version: enumerate names from
  the IR + a static `github.*` table. Trade-off: no type checking on
  expressions, just name completion. Acceptable for v1. **Codex confirmed**
  this scope line is correct; hide behind an adapter so a provider-backed
  completion can drop in later.
- **Cron-preview bundle size** (WI-A.3): `cronstrue` is ~42 KB minified for
  the main module + ~130 KB if all locales bundle. **Codex correction** to
  the prior "3kb" estimate. Mitigation: lazy-load main module on first
  schedule render; English-only at first paint; load other locales on demand.
- **Drag-and-drop a11y** (WI-C.2): use ↑ / ↓ buttons as primary, drag as
  enhancement; **Codex addition**: announce moves via polite ARIA live
  region ("Moved step 2 to position 3"); keep focus on the moved row;
  disable buttons at boundaries.
- **Phase C IR staleness** (Codex finding): addressed by WI-C0 above.
  Without the draft overlay, WI-C.1 and WI-C.2 build broken UX where
  follow-on edits don't see freshly-added entities.

## 7.5. Codex review summary (2026-05-05)

`/codex-toolkit:review-plan` against this file (rule 60.6 mandatory for
plans >3 phases). Findings incorporated:
- Phase C0 (draft overlay) added before WI-C.1 to fix IR staleness
- Phase B-prime (shared path resolver) added between B.0 and B.1/B.2
- Test acceptance lines expanded with edge cases per Codex enumeration
- Cron bundle size estimate corrected from ~3 KB to ~42 KB minified
- Reorder a11y enhanced with live-region announcement
Thread ID: `019df57d-c363-7053-86fb-537076c99c22` for follow-up.

## 8. Out of scope (this plan)

- Items #4, #11, #16, #17, #18, #19 from the gap analysis. Each requires
  a separate plan + ADR review.
- Run-history overlay, action version picker, `act` integration, snippet
  library — see post-ship analysis report.

## 9. References

- Prior plan: `20260504-github-actions-workflow-viewer.md`
- Gap analysis: chat record 2026-05-05 ~07:55 UTC
- AI governance: `.claude/rules/60-ai-governance.md`
- TDD discipline: `.claude/rules/10-tdd.md`
