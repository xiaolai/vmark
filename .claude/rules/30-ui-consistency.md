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
- **Popup buttons**: Focus = U-shaped underline via `::after`, not rings.
- **Selection states**: Use `--accent-bg` + `--accent-primary`.
- **Hover states**: Use `--hover-bg` or `--bg-tertiary`.
- **Dark mode**: Use `.dark-theme` selector (not `[data-theme]`).
