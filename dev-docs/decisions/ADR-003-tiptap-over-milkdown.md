# ADR-003: Tiptap over Milkdown

> Status: **Accepted** | Date: 2025-11-20

## Context

VMark originally used Milkdown as the WYSIWYG editor framework. Milkdown wraps
ProseMirror with a "Markdown-first" plugin system — it parses Markdown via
remark and provides its own API for custom nodes/marks. As the editor grew in
complexity (40+ plugins, custom table UI, multi-cursor, inline previews), the
Milkdown abstraction layer became a bottleneck: plugin wiring required
Milkdown-specific context (`Ctx`, `$prose`, `$view`), and debugging required
understanding both Milkdown's layer and ProseMirror's layer beneath it.

## Considered Options

1. **Stay with Milkdown** — continue building on the existing framework.
2. **Migrate to Tiptap** — a thinner ProseMirror wrapper with direct access to
   the underlying editor primitives.
3. **Raw ProseMirror** — drop all wrappers and use ProseMirror directly.

## Decision

Chosen: **Tiptap**, because it provides the thinnest viable abstraction over
ProseMirror while still offering a React binding (`@tiptap/react`) and an
extension API.

Key migration factors:

- Most VMark plugins were already plain ProseMirror plugins wrapped in Milkdown
  glue. Migration to Tiptap `Extension.create()` was mechanical.
- CodeMirror source mode was unaffected — it depends only on stores, not on the
  WYSIWYG framework.
- Markdown serialization was decoupled from both frameworks via the remark
  pipeline (see ADR-001), so no serialization rewrite was needed.

## Consequences

- Good: Direct ProseMirror access — no Milkdown context overhead for plugin
  development.
- Good: Larger ecosystem — Tiptap extensions for tables, lists, collaboration
  are maintained upstream.
- Good: Simpler debugging — one abstraction layer instead of two.
- Bad: Migration required touching every plugin file to replace Milkdown wiring
  with Tiptap extension wrappers (~40 files).
- Bad: Lost Milkdown's built-in Markdown ↔ ProseMirror bridge, but this was
  already replaced by the remark pipeline before migration.
