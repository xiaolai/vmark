# Tier Boundary Restoration (H4 burn-down)

**Status:** Phase 1 complete (+ WI-3.1, and 8 of 14 exemptions retired).
Phase 2 next. `pnpm check:all` green as of 2026-07-22.
**Branch:** `refactor/vmark-core`
**Supersedes:** the frozen `services-no-upward` exemption list in `.dependency-cruiser.cjs`
**Closes:** H4 from `dev-docs/audit/20260612-full-improvement-audit.md`

## Problem

The 2026-06-12 audit resolved 27 of 28 high findings. H4 — "inverted layering:
`services/` imports business logic from `hooks/`" — was deferred and frozen as a
14-entry `pathNot` exemption list on the `services-no-upward` dep-cruiser rule,
annotated *"do NOT add new entries; extract the logic into services/ instead."*

That list is the contract's outstanding debt. It is machine-checkable: delete an
entry, run `pnpm lint:deps`, and the gate says whether the debt is gone.

## Correction to the audit's framing

The audit recommended splitting ~10 hook files, estimating effort "large". That
is wrong, and the audit's own verifier said so. Re-confirmed independently on
2026-07-22 — every file `services/` reaches up into contains **zero** React
imports and exports **zero** React hooks:

| File | LOC | React imports | Exported hooks |
|---|---|---|---|
| `src/hooks/useHistoryOperations.ts` | 369 | 0 | 0 |
| `src/hooks/useFileOpen.ts` | 309 | 0 | 0 |
| `src/hooks/useUnifiedHistory.ts` | 307 | 0 | 0 |
| `src/hooks/useHistoryRecovery.ts` | 156 | 0 | 0 |
| `src/hooks/openWorkspaceWithConfig.ts` | 94 | 0 | 0 |
| `src/hooks/lintNavigation.ts` | 79 | 0 | 0 |
| `src/hooks/workspaceSession.ts` | 75 | 0 | 0 |
| `src/hooks/useReplaceableTab.ts` | 51 | 0 | 0 |
| `src/hooks/markdownSplitToggle.ts` | 32 | 0 | 0 |
| `src/hooks/useWindowFocus.ts` | 16 | 0 | 0 |

So the ADR-013 invariant that actually matters — *no React in the services tier* —
was never violated. This is **directory-placement drift**: service modules parked
under `hooks/`, several wearing a `use*` prefix that falsely advertises them as
React hooks. `lintNavigation.ts` still carries `@module utils/lintNavigation` in
its header, evidence it has now been misfiled twice.

The fix is whole-file moves plus renames, not splits.

## ADR-1: `use*` is reserved for React hooks

A module exporting no hook must not carry the `use` prefix. React's own lint
rules treat the prefix as a semantic marker, and the misleading names are the
most plausible cause of this drift — a reader importing `useFileOpen` reasonably
assumes it belongs in the React tier.

Every import path changes with the move regardless, so renaming costs
approximately nothing extra at the call sites.

## ADR-2: re-key the size baseline rather than split

`useHistoryOperations.ts` (369), `useFileOpen.ts` (309), and
`useUnifiedHistory.ts` (307) exceed the 300-line limit and are frozen in
`scripts/file-size-baseline.json` under their `src/hooks/` paths. Moving them
creates paths the gate reads as *new* violations, failing `pnpm check:all`.

`.claude/rules/00-engineering-principles.md` says the baseline ratchets down
only. Re-keying preserves that: the same line counts move to the same files at
new paths, and no number rises. Splitting these three is genuine design work and
belongs in its own pass, not smuggled into a move commit where it would
dominate the diff.

**Constraint:** re-keying is path-rename only. If any re-keyed number would
increase, the move is wrong and must stop.

## Phases

### Phase 1 — `hooks/` → `services/` (10 files, ~122 import sites)

| WI | File | Destination |
|---|---|---|
| WI-1.1 | `useUnifiedHistory.ts` | `services/history/unifiedHistory.ts` |
| WI-1.2 | `useHistoryOperations.ts` | `services/history/historyOperations.ts` |
| WI-1.3 | `useHistoryRecovery.ts` | `services/history/historyRecovery.ts` |
| WI-1.4 | `useFileOpen.ts` | `services/navigation/fileOpen.ts` |
| WI-1.5 | `useReplaceableTab.ts` | `services/tabs/replaceableTab.ts` |
| WI-1.6 | `useWindowFocus.ts` | `services/navigation/windowFocus.ts` |
| WI-1.7 | `openWorkspaceWithConfig.ts` | `services/workspaces/openWorkspaceWithConfig.ts` |
| WI-1.8 | `workspaceSession.ts` | `services/workspaces/workspaceSession.ts` |
| WI-1.9 | `lintNavigation.ts` | `services/lint/lintNavigation.ts` |
| WI-1.10 | `markdownSplitToggle.ts` | `services/editor/markdownSplitToggle.ts` |

`history/` is a new domain; the other six already exist. Co-located `*.test.ts`
files move with their subject.

Three subjects carry two test suites each — a sibling `*.test.ts` and a second
file under `src/hooks/__tests__/` — and the pairs genuinely overlap
(`useHistoryRecovery`: both cover `deleteDocumentHistory` and
`clearWorkspaceHistory`; `useFileOpen`: both cover `openFileInNewTabCore`;
`useHistoryOperations`: both cover `getHistoryIndex`, `getSnapshots`,
`createSnapshot`). Both suites move, preserving the sibling/`__tests__` split at
the destination. Merging them is not a move — it risks dropping coverage
silently and needs its own RED-first pass. Logged under "Out of scope".

**DoD:**
- `git mv` used throughout, so history follows the files
- No `src/services/**` file imports `@/hooks/*` except the entries Phase 2 owns
- Stale `@module` headers corrected to the new paths
- `scripts/file-size-baseline.json` re-keyed for WI-1.1/1.2/1.4, values unchanged
- `pnpm lint:deps` reports 0 errors
- `pnpm test:coverage` green

### Phase 2 — `services/` → `hooks/` (4 files, ~18 import sites)

These genuinely call React APIs; they sit one tier too low. The direction of
travel is the opposite of Phase 1. Inspection showed they are **not** uniform —
only two are clean whole-file moves.

| WI | File | Action |
|---|---|---|
| WI-2.1 | `services/commands/useCommandBootstrap.ts` | Move → `hooks/useCommandBootstrap.ts` (sole export is the hook) |
| WI-2.2 | `services/formats/formatSettingsBridge.ts` | **Split.** `installFormatSettingsSubscription()` is React-free and stays; the 3-line `useFormatSettingsBridge()` wrapper moves to `hooks/` |
| WI-2.3 | `services/ime/imeToastPinAction.tsx` | **Reclassify, do not move** — see below |
| WI-2.4 | `services/persistence/hotExit/useHotExitCaptureWarning.ts` | Move → `hooks/useHotExitCaptureWarning.ts` |
| WI-2.5 | `services/persistence/resilience/_crashRecovery*.ts` (3) | Use `useEffect`/`useRef` — assess for move |
| WI-2.6 | `services/persistence/resilience/_hotExit{Capture,Restore,Startup}.ts` (3) | Use `useEffect`/`useRef` — assess for move |

**WI-2.3 is not debt.** `imeToastPinAction.tsx` builds a `React.ReactNode` label
for a toast, and its only importer is `services/ime/imeToast.ts`. Moving it to
`components/` would make a service import the UI tier — strictly worse than the
status quo. Its own header records the `.tsx` split as deliberate. It belongs in
the same category as `assembly/tiptapExtensions.ts`: a sanctioned seam. The fix
is to relabel its exemption from "Frozen H4 backlog" to "sanctioned", so the
list stops implying work that should not be done.

**Method note.** WI-2.5/2.6 were found only because `pnpm lint:deps` flagged them
after their exemption was lifted — a `grep 'from "react"'` missed them, since
they use single quotes. Tier assessment goes through the gate, not through grep.

**DoD:**
- Every remaining `services-no-upward` exemption is labelled sanctioned, with a
  reason — no entry described as pending/frozen debt
- `pnpm lint:deps` reports 0 errors
- `pnpm test:coverage` green

### Phase 3 — retire the exemptions and correct the docs

| WI | Change |
|---|---|
| WI-3.1 | `components/Terminal/terminalGate.ts` → `services/` (no React; `viewCommands.ts` reaches up for it) |
| WI-3.2 | Delete all 12 debt entries from `services-no-upward` `pathNot`, keeping only the `*.test.*` exemption and the sanctioned `assembly/tiptapExtensions.ts` wiring seam |
| WI-3.3 | Correct `dev-docs/architecture.md` — it claims the services tier rule is "enforced via dep-cruiser", which was false when written and should now be made true |
| WI-3.4 | Mark H4 resolved in `dev-docs/audit/20260612-full-improvement-audit.md` |

**DoD:**
- `services-no-upward` `pathNot` contains at most 2 entries
- Re-adding any deleted path to a `services/` file fails `pnpm lint:deps`
- `pnpm check:all` green
- `bash scripts/check-wi-linkage.sh dev-docs/plans/20260722-tier-boundary-restoration.md`

## Out of scope

- Splitting the three oversized movers (ADR-2) — separate pass
- Merging the three overlapping test-suite pairs (Phase 1) — needs a RED-first
  pass to prove no assertion is lost; `pnpm dup` should confirm the overlap first
- The 7 `plugin-isolation` warnings — that rule is `warn`, and promoting it to
  `error` is its own burn-down with 22 exemptions
- The other 109 file-size baseline entries
