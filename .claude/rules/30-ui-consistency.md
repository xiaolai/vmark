# 30 - UI Consistency

> See detailed specs in `dev-docs/design-system.md`.

## Core Principles

- Preserve established patterns and visual language.
- Prefer incremental adjustments over redesigns unless requested.
- Keep cross-surface behavior consistent (WYSIWYG vs Source).

## Quick Rules

1. **Use tokens first** - Never hardcode colors. See `31-design-tokens.md`.
2. **Follow component patterns** - See `32-component-patterns.md`.
3. **Focus must be visible** - See `33-focus-indicators.md` (accessibility).
4. **Dark theme parity** - See `34-dark-theme.md`.

## Summary (Details in Sub-Rules)

- **Popup surface**: 1px border, `--radius-lg` (8px), `--popup-shadow`, compact padding.
- **Popup inputs**: Borderless, no outline. Focus = caret only.
- **Popup buttons**: Focus = flat 2px bar via `::after` (D4, rule 33 §1), not rings.
- **Selection states**: `--accent-bg` background, `--text-color` text, `--accent-primary` icons/indicators (R6 — selection keeps its ink).
- **Hover states**: Use `--hover-bg`, `--hover-bg-strong` or `--bg-tertiary`; list rows may use the subtler `--subtle-bg`/`--subtle-bg-hover` tier.
- **Dark mode**: Use `.dark-theme` selector (not `[data-theme]`).
