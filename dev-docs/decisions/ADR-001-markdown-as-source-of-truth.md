# ADR-001: Markdown as Source of Truth

> Status: **Accepted** | Date: 2026-01-09

## Context

VMark has two editor surfaces — WYSIWYG (Tiptap/ProseMirror) and Source
(CodeMirror 6). Both need a shared document representation. The question was
whether the canonical document state should live as a ProseMirror doc tree, a
Markdown string, or some intermediate AST.

Keeping ProseMirror as the source of truth would couple all persistence, export,
and mode-switching logic to a specific editor engine. Any future engine swap
would cascade across the entire app.

## Considered Options

1. **ProseMirror document tree** — the WYSIWYG editor's native format.
2. **Markdown string** — a plain-text format both surfaces can parse/serialize.
3. **Intermediate AST (mdast)** — a structured tree independent of any editor.

## Decision

Chosen: **Markdown string**, because it is the lowest-common-denominator format
that both editors can natively consume.

- The document store (`useDocumentStore`) holds a Markdown string per tab.
- WYSIWYG edits serialize back to Markdown via a remark pipeline
  (`src/utils/markdownPipeline/`).
- Source mode edits the Markdown string directly in CodeMirror.
- Mode switching simply re-parses the same Markdown string into the target
  editor's internal format.

## Consequences

- Good: Engine-agnostic — swapping Tiptap for another WYSIWYG editor only
  requires a new Markdown ↔ editor adapter, not a store redesign.
- Good: File I/O is trivial — read/write `.md` files with no conversion.
- Good: Export (HTML, PDF) starts from a well-defined Markdown contract.
- Bad: Round-trip fidelity is bounded by what the remark pipeline can preserve.
  Custom syntax (alerts, wiki links, footnotes) requires custom remark plugins.
- Bad: Every WYSIWYG keystroke triggers a serialize step, adding latency.
  Mitigated by debounced serialization and incremental updates.
