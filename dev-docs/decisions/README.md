# Architecture Decision Records

Decision records for VMark. Each ADR captures the "why" behind a significant
architectural choice using the [MADR](https://adr.github.io/madr/) format.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [001](ADR-001-markdown-as-source-of-truth.md) | Markdown as source of truth | Accepted | 2026-01-09 |
| [002](ADR-002-mcp-sidecar-architecture.md) | MCP sidecar architecture | Accepted | 2025-12-15 |
| [003](ADR-003-tiptap-over-milkdown.md) | Tiptap over Milkdown | Accepted | 2025-11-20 |
| [004](ADR-004-human-oriented-mcp-tools.md) | Human-oriented MCP tool design | Accepted | 2026-01-22 |
| [005](ADR-005-cli-based-ai-provider-routing.md) | CLI-based AI provider routing | Accepted | 2026-01-10 |
| [006](ADR-006-terminal-program-identity.md) | Terminal program identity | Accepted | — |
| [007](ADR-007-shell-as-composition-root.md) | Shell as composition root | Accepted | 2026-05-24 |
| [008](ADR-008-workspace-as-single-facade.md) | Workspace as single facade | Proposed | 2026-05-24 |
| [009](ADR-009-document-as-unit-of-state.md) | Document as the unit of state | Proposed | 2026-05-24 |
| [010](ADR-010-editor-host-as-mode-agnostic-interface.md) | Editor host as mode-agnostic interface | Proposed | 2026-05-24 |
| [011](ADR-011-plugin-manifest-contract.md) | Plugin manifest contract | Proposed | 2026-05-24 |
| [012](ADR-012-command-bus-as-single-intent-path.md) | Command bus as single intent path | Proposed | 2026-05-24 |
| [013](ADR-013-service-tier-as-cross-cutting-seam.md) | Service tier as cross-cutting seam | Proposed | 2026-05-24 |
| [014](ADR-014-theme-tokens-as-typed-data.md) | Theme tokens as typed data | Proposed | 2026-05-24 |

### Reskin foundation set (ADR-007 to ADR-014)

These eight ADRs are proposed as the target architecture for the
post-reskin VMark. They are reviewable independently but have
dependencies that should be honored when adopting:

```
ADR-013 (service tier) ──┬─→ ADR-012 (command bus) ──┬─→ ADR-008 (workspace facade)
                         │                            ├─→ ADR-009 (document state) ──→ ADR-010 (editor host)
                         └─→ ADR-011 (plugin manifest) ─┘
ADR-007 (shell) ─→ consumed by ADR-011 (slot descriptors)
ADR-014 (theme) ─→ consumed at ADR-007 (shell theme provider boundary)
```

The existing exploratory plan in `~/Downloads/20260524-pre-reskin-refactor.md`
predates these and is superseded for any reskin-load-bearing work.

## Adding a New ADR

1. Copy the template below into `ADR-NNN-short-title.md`.
2. Fill in Context, Options, Decision, and Consequences.
3. Add a row to the index table above.

### Template

```markdown
# ADR-NNN: {Title}

> Status: **Proposed** | Date: YYYY-MM-DD

## Context
{2-3 sentences: what problem, why a decision was needed}

## Considered Options
1. Option A
2. Option B

## Decision
Chosen: "Option X", because {justification}.

## Consequences
- Good: {benefits}
- Bad: {tradeoffs}
```
