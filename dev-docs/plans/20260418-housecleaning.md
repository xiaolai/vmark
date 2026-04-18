# Housecleaning Plan — 2026-04-18

Branch: `chore/housecleaning`
Worktree: `/Users/joker/github/xiaolai/myprojects/vmark-housecleaning`

## Goal

Pay down measurable debt without touching working features. Three bounded passes, each independently shippable. No forcing function beyond the existing `AGENTS.md` rules (300-line cap, token-first CSS, Zustand conventions).

## Non-goals — do NOT do these

- Rename stores, hooks, plugins, files, or variables for feel.
- Consolidate, regroup, or flatten the plugin / store / hook directory layout.
- Replace libraries (Zustand, Tiptap, Tauri, Vite, Vitest).
- Rewrite any working plugin or handler.
- Add new abstractions, helpers, or "cleanup" utilities.
- Touch code unrelated to a phase's explicit targets.

If you feel the urge to do any of these mid-phase — stop. It's grooming.

## Phase 0 — Baseline metrics (30 min)

Capture before-numbers so progress is measurable. Record in `dev-docs/plans/20260418-housecleaning-metrics.md`.

```bash
# File counts and sizes
find src src-tauri/src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" \) \
  ! -name "*.test.*" ! -name "*.spec.*" | wc -l

# Files over 300 lines
find src src-tauri/src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" \) \
  ! -name "*.test.*" -exec wc -l {} + | sort -rn | awk '$1 > 300'

# Test suite size and time
pnpm test --reporter=verbose 2>&1 | tail -20

# Dependency footprint
cat package.json | jq '.dependencies, .devDependencies | length'
```

Record: total non-test files, count > 300 lines, total test count, total test time (cold), total deps, Rust crate count.

## Phase A — Dead code + dependency sweep (~2–3 days)

**Why first:** fastest wins, reduces surface before splits and test audit. Low risk, fully mechanical.

### Steps

1. **Unused TypeScript exports**
   ```bash
   pnpm dlx knip
   ```
   Review each flagged export. Delete if genuinely unused. Keep if:
   - Used by Tauri invoke (may not be statically traceable)
   - Used by MCP handlers
   - Part of a public-ish API

2. **Unused dependencies**
   ```bash
   pnpm dlx depcheck --ignore-bin-package
   ```
   Remove confirmed-unused deps. Verify by running `pnpm check:all` after each batch of removals.

3. **Unused Rust crates**
   ```bash
   cargo install cargo-machete   # one-time
   cd src-tauri && cargo machete
   ```
   Remove unused crates from `Cargo.toml`.

4. **Security & outdated**
   ```bash
   pnpm audit
   cd src-tauri && cargo audit   # install cargo-audit if needed
   ```
   Address highs/criticals only. Do not mass-update majors — out of scope.

### Acceptance

- `pnpm check:all` passes.
- `cargo check` and `cargo test` pass in `src-tauri/`.
- Commit per logical group (e.g., "chore: remove unused frontend deps", "chore: drop dead utility exports").

### Stop conditions

- If a "dead" export turns out to be used via dynamic import or MCP — keep it, add a one-line comment explaining why static analysis missed it.
- Do not refactor the code that uses the surviving export. Scope creep.

## Phase B — File-size audit & split (~1 week)

**Why second:** structure work on a smaller surface (Phase A already trimmed it). Splits move tests around, better to do before test audit.

### Known targets (TypeScript)

| File | Lines | Split hint |
|------|------:|------------|
| `src/lib/cjkFormatter/rules.ts` | 821 | Rule groups → sibling files (e.g., `rules/punctuation.ts`, `rules/spacing.ts`) |
| `src/hooks/mcpBridge/batchOpHandlers.ts` | 693 | One handler per file under `batchOp/` |
| `src/utils/debug.ts` | 692 | Category loggers → `debug/<category>.ts`, barrel re-export |
| `src/hooks/mcpBridge/index.ts` | 616 | Dispatcher stays; pull switch cases to category files |
| `src/hooks/mcpBridge/suggestionHandlers.ts` | 576 | Split by operation type |
| `src/hooks/mcpBridge/sectionHandlers.ts` | 570 | Split by operation type |
| `src/utils/markdownPipeline/parser.ts` | 569 | Extract per-node-type parsers |

Run the Phase 0 command again to catch anything missed, including Rust files.

### Rules for splitting

- **Behavior-preserving only.** No API changes, no renames, no "while I'm here" edits.
- **One file = one responsibility.** If a split feels forced, the original wasn't doing one thing — leave a TODO comment and move on.
- **Barrel re-exports are fine** for backward-compatible imports, but prefer updating call sites to point at the new file directly when the diff is small.
- **Tests travel with code.** If `foo.ts` has `foo.test.ts`, and you split into `foo/a.ts` + `foo/b.ts`, split the test file too or keep one test file covering both — whichever is clearer. Do not leave orphaned tests.

### Per-file procedure

1. Read the file fully.
2. Identify the natural seams (exported groups, node types, operation categories).
3. Write the split plan as a 3–5 line comment at the top of a scratch file (not committed).
4. Execute: create new files, move code, update imports, run `pnpm check:all`.
5. Commit per file: `refactor: split cjkFormatter/rules.ts into rule groups`.

### Acceptance

- No source file > 300 lines (excluding tests, generated code, locale JSON).
- `pnpm check:all` passes after each split.
- No behavior change — tests unchanged except for import paths.

## Phase C — Test suite audit (~1 week)

**Why last:** cleaner structure makes it easier to see what each test actually proves.

### Categories to identify

| Category | Signal | Action |
|----------|--------|--------|
| Wiring-only | Only asserts `toHaveBeenCalled` / `toHaveBeenCalledWith`, no behavior check | Rewrite to assert observable outcome, or delete if redundant |
| Flaky | Intermittent failures in CI or `pnpm test` re-runs | Fix the test or the code; if can't reproduce, quarantine + issue |
| Slow | > 500ms per test (`vitest --reporter=verbose`) | Investigate — usually a real bug or missing mock at a boundary |
| Redundant | Multiple tests cover same branch with no additional value | Delete all but one |
| Snapshot-for-logic | `.toMatchSnapshot()` where explicit assertions would be clearer | Replace with explicit assertions |

### Procedure

1. Run full suite with timing: `pnpm test --reporter=verbose > test-report.txt`.
2. Sort by duration, investigate top 20.
3. Grep for wiring-only signals:
   ```bash
   grep -rn "toHaveBeenCalled" src --include="*.test.*" | wc -l
   ```
   Spot-check 30 matches. Rewrite the worst offenders.
4. Look for redundant describe blocks (same setup, trivially different assertions).
5. Run `pnpm test --coverage` before and after — coverage should not drop meaningfully. If it does, you deleted real tests.

### Acceptance

- Total test count reduced OR test time reduced by ≥ 20% (whichever is the real signal of quality improvement).
- Coverage ≥ pre-audit numbers (or within 1–2%).
- Zero flaky tests in three consecutive `pnpm test` runs.
- `pnpm check:all` passes.

### Stop conditions

- If a test looks bad but you can't see what it's actually checking — leave it. Don't delete what you don't understand.
- If the coverage gate would fail, restore tests and investigate which branch got uncovered.

## Execution notes

- **Commit cadence:** one logical change per commit. Conventional Commits style (matches existing history). Example: `chore(deps): drop unused frontend packages`, `refactor(cjk): split rules.ts into category files`, `test: remove wiring-only mcpBridge assertions`.
- **No squashing phases into one PR.** Each phase is its own PR (or direct merge if you prefer), so blame history stays legible.
- **`pnpm check:all` after every logical step.** Not just at phase boundaries.
- **If something breaks and isn't caused by your change** — stop, investigate, file an issue, move on to a different target. Don't fix unrelated breakage in this branch.
- **Don't rebase main into this branch mid-phase.** Merge main in at phase boundaries only.

## Out of scope — explicitly deferred

- Platform abstraction for web SPA (no web version planned).
- Store / hook / plugin consolidation.
- MCP architecture changes.
- Design-token or CSS refactors beyond what rule violations demand.
- Documentation rewrites (update only what your code changes touch per rule `22-comment-maintenance.md`).

## Success signal

After all three phases:

- Baseline metrics doc shows real before/after deltas.
- No source file > 300 lines.
- Test suite is faster and leaner.
- Dependency list is shorter.
- No feature behavior changed.
- You can point at a commit log that tells a clean story.

If at the end of Phase A you look at the remaining two phases and think "eh, not worth it" — that's a valid finding. Stop there.
