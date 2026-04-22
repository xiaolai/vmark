---
name: shortcut-audit
description: Audit keyboard shortcuts in VMark code vs dev docs. Use when asked to review, reconcile, or optimize shortcuts, or when updating shortcut documentation.
---

# Shortcut Audit

## Overview
Compare shortcut definitions in code against documentation and report gaps or conflicts.

## Workflow
1) Read docs:
   - `website/guide/shortcuts.md` (primary, in repo)
   - `dev-docs/shortcuts.md` (if present — not always created)
2) Scan code for shortcut sources (see `references/paths.md`).
3) Extract current shortcuts from code and map them to doc entries.
4) Report:
   - Missing doc entries
   - Docs that reference removed shortcuts
   - OS-level conflicts or collisions
5) Propose updates and required tests if changes are requested.

## Notes
- Confirm WYSIWYG and Source mode bindings separately.
- Prefer existing conventions in VMark unless told to redesign.
