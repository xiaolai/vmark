# ADR-013: Service tier as the cross-cutting seam

> Status: **Accepted** | Date: 2026-05-24 | First moves landed: 2026-05-24

## Context

Cross-cutting logic (persistence, MCP coordination, AI provider routing,
hot-exit, telemetry, feature flags) lives in `src/utils/`. Several
`utils/` modules import stores, violating the dep-cruiser
`leaf-modules-stay-pure` rule:
`workflowFeatureFlag.ts → settingsStore`,
`formatSettingsBridge.ts → settingsStore`,
`imeToast.ts → activeEditorStore`. Nine of the ten current dep-cruiser
baseline entries are this kind of mis-classification — they are not bugs,
they are service-tier code in a leaf-tier directory.

Existing T08 moves three files into `src/services/` but keeps the rule
ambiguous and the directory structure flat.

## Considered Options

1. **Status quo** — keep the dep-cruiser baseline, document the
   violations as acceptable.
2. **Move violating files, narrow the rule** — existing T08; fixes the
   immediate baseline but leaves the boundary fuzzy.
3. **Three explicit tiers** — `utils/` (pure), `services/` (pure +
   store-aware), `hooks/` (React-aware); each has enforced rules and a
   semantic boundary.

## Decision

Chosen: **Option 3 — three tiers** with rule-enforced import policy.

| Tier | May import | Examples |
|---|---|---|
| `utils/` | Standard library, other `utils/` | Pure parsers, formatters, string helpers |
| `services/` | `utils/`, `stores/`, Tauri APIs | Persistence, MCP coordination, AI routing, hot-exit |
| `hooks/` | `services/`, `stores/`, React APIs | React adapters over services |

`services/` is organized by domain, not by file type:
`services/persistence/`, `services/mcp/`, `services/ai/`,
`services/hotExit/`, `services/commands/`, `services/workspace/`.

## Verification gate

- `pnpm lint:deps` green with **zero** baseline entries (the cycle from
  ADR-related work also closes).
- `find src/utils -name '*.ts' ! -name '*.test.ts' | xargs grep -l 'from.*stores\|from.*tauri\|import.*react'`
  returns empty.
- `services/` directory contains only sub-domain directories — no flat
  files at the top level.
- AGENTS.md and `dev-docs/architecture.md` updated with the three-tier
  rule and the domain layout.

## Consequences

- **Good**: `utils/` stays genuinely leaf-pure. Services testable in
  isolation (no React, no Tauri shims). Replacing an implementation
  (swapping an AI provider, swapping a persistence strategy) becomes
  local to one service folder. Service-tier becomes a real architectural
  change, not three file moves.
- **Bad**: requires moving 10–15 modules, not the 3 named in T08. AGENTS,
  architecture docs, and CI gates all need updates. One-release
  deprecation barrel at old paths for any module imported from outside
  `src/`.

## Negative space

Service tier does NOT mandate DI containers or interfaces for every
service — only for services with multiple implementations or test-time
substitution needs. Does NOT regulate internal service organization
beyond "one domain per folder."

## Dependencies

- Houses ADR-012's `CommandBus` (`services/commands/`).
- Hosts ADR-008's workspace facade backend (`services/workspace/`).
- Hosts ADR-009's document persistence (`services/persistence/`).
- Supersedes and widens existing T08.

## First-pass outcome (2026-05-24)

Baseline drained from 9 entries to 2. First moves landed:

| Old path | New path |
|---|---|
| `src/utils/imeToast.ts` | `src/services/ime/imeToast.ts` |
| `src/utils/imeToastPinAction.tsx` | `src/services/ime/imeToastPinAction.tsx` |
| `src/utils/workflowFeatureFlag.ts` | `src/services/featureFlags/workflowFeatureFlag.ts` |
| `src/utils/formatSettingsBridge.ts` | `src/services/formats/formatSettingsBridge.ts` |

Test files moved alongside. All `vi.mock("@/utils/...")` paths updated.
The `AGENTS.md` three-tier rule added.

**Verification:**

- `pnpm lint:deps` — 0 errors (was 0 with baseline-ignore; baseline now
  has 2 entries instead of 9, both queued for separate ADRs).
- Full suite — 18,827 tests pass.
- `pnpm tsc --noEmit` clean.

**What remains in the baseline (for follow-up ADRs):**

- `src/utils/sourceEditorExtensions.test.ts → src/plugins/sourceContextDetection/taskListActions.ts`
  — test-only cross-plugin import; will resolve when `sourceEditorExtensions`
  moves to `services/` (waits on ADR-009 which deletes `editorStore`).
- `src/plugins/sourceContextDetection/tableActions.ts ↔ tableDetection.ts`
  — circular dependency; tracked as the original plan's T12 work,
  not part of ADR-013.

**Files still in `utils/` that import stores or Tauri** — RESOLVED
2026-06-12 (audit H2): the remaining 12 Tauri/services/i18n-dependent
utils files were migrated into services domains (`media/`,
`persistence/`, `secrets/`, `dialogs/`, `navigation/`), and the tier is
now actually gated by the `utils-no-platform` dependency-cruiser rule
(sole sanctioned exception: `utils/debug`'s lazy plugin-log import).
A companion `services-no-upward` rule freezes the known
services→hooks/React inversions (audit H4, deferred) so they cannot
grow.
