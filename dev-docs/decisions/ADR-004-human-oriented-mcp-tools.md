# ADR-004: Human-Oriented MCP Tool Design

> Status: **Accepted** | Date: 2026-01-22

## Context

VMark's MCP tools (~60 tools) needed a design philosophy. The initial tools
mirrored the human editor interaction model: cursor positioning, selection
management, format toggling. This is **procedural and stateful** — each
operation depends on prior state (cursor position, selection). AI clients
struggled with this model because they think in terms of document structure and
transformations, not cursor navigation.

A redesign was needed to make MCP tools more effective for AI use while
remaining usable by humans.

## Considered Options

1. **Pure AI-oriented tools** — structural addressing, AST-level operations,
   declarative mutations. Drop cursor/selection concepts entirely.
2. **Hybrid: human-oriented base + AI introspection tools** — keep the existing
   cursor/selection model but add introspection tools so AI can understand
   document state before editing.
3. **Dual API** — maintain separate human and AI tool sets.

## Decision

Chosen: **Hybrid approach** (Option 2), because it preserves backward
compatibility while making AI workflows practical.

Changes made:

- Added 6 introspection tools (`editor_get_state`, `format_get_active`,
  `block_get_info`, `document_get_structure`, `document_diff_apply`,
  `batch_edit`) so AI can understand state in 1 call instead of 3-4.
- Removed 5 AI proxy tools that created recursive AI-calls-AI patterns.
- Deprecated `cursor_set_position` (redundant with `selection_set`).
- Kept all existing manipulation tools for human-oriented workflows.

## Consequences

- Good: AI can now introspect document state efficiently — single-call context
  gathering instead of multi-step cursor navigation.
- Good: Existing MCP clients continue working — no breaking changes to the
  manipulation API.
- Good: `batch_edit` and `document_diff_apply` enable atomic multi-site edits,
  reducing race conditions with concurrent user input.
- Bad: Tool count remains high (~60). Future simplification may consolidate
  tools further.
- Bad: The hybrid model means AI clients still need to understand cursor
  concepts for some operations, rather than working purely with structure.
