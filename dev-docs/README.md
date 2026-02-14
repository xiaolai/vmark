# VMark Developer Documentation

## Active Docs (tracked in git)

- `dev-docs/architecture.md`: system architecture overview — C4 diagram, entry points, data flows, module map.
- `dev-docs/design-system.md`: design tokens, components, patterns (single source of truth).
- `dev-docs/css-reference.md`: visual QA reference document for CSS changes.
- `dev-docs/decisions/`: architecture decision records (ADRs).

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

## Archive

Historical docs live in `archive/` (local, not tracked in git).
