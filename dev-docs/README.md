# VMark Developer Documentation

## Active Docs (tracked in git)

- `dev-docs/architecture.md`: system architecture overview — C4 diagram, entry points, data flows, module map.
- `dev-docs/design-system.md`: design tokens, components, patterns (single source of truth).
- `dev-docs/css-reference.md`: visual QA reference document for CSS changes.
- `dev-docs/cjk-gotchas.md`: CJK formatter pitfalls — things that will bite you if you're not careful.
- `dev-docs/large-file-open-pipeline.md`: end-to-end pipeline for the large-file open UX — tiers, routing, forced Source mode, indeterminate indicator, and the perf tricks in TiptapEditor.
- `dev-docs/plans/20260504-github-actions-workflow-viewer.md`: GitHub Actions workflow viewer + structured editor — IR pivot, ADRs, 10-phase plan with all phases complete. End-user docs at `website/guide/workflow-viewer.md`; perf benchmark at `src/bench/workflow.bench.ts`.
- `dev-docs/decisions/`: architecture decision records (ADRs).
  - `heading-ime-composition-fix.md`: How we fixed the WebKit heading IME split-block bug — 5 attempts, root cause analysis, and why prevention beats repair.

## Agent Configuration

- `AGENTS.md`: working agreement + required practices.
- `.claude/rules/`: engineering guardrails, TDD, UI consistency, design tokens, shortcuts.

## Website (User-Facing Docs)

- `website/guide/`: VitePress site for end-user documentation.
- See `.claude/rules/21-website-docs.md` for sync rules.

## Documentation Conventions

- Prefer a single source of truth for each topic.
- Date + status new documents (Active / Historical / Draft) to reduce ambiguity.
- Update docs in the same change that modifies behavior.

## Important History

Records of significant codebase-wide changes — process, decisions, and lessons learned.

- `important-history/20260214-codebase-documentation.md`: How we added AI-maintenance comments to ~400 files using parallel git worktrees.
- `important-history/20260423-smart-cmd-a-hidden-cost.md`: What Issue #816 taught us about replacing universal keyboard conventions — a retrospective + checklist for future "nice features".

## Archive

Historical docs live in `archive/` (local, not tracked in git).
