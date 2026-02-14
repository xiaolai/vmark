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
