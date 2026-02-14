# 34 - Dark Theme Rules

All styling must work in both light and dark themes.

## Theme Detection

**Standard selector:** `.dark-theme`

```css
/* Light mode (default) */
.component {
  background: var(--bg-color);
  color: var(--text-color);
}

/* Dark mode override */
.dark-theme .component {
  /* Only override if token doesn't handle it */
}
```

## Selector Standards

| Selector | Status | Notes |
|----------|--------|-------|
| `.dark-theme` | **Primary** | Use this |
| `.dark` | Allowed | Tailwind compatibility |
| `[data-theme="night"]` | **Deprecated** | Migrate to `.dark-theme` |

**Rule:** Always use `.dark-theme` for new CSS. Never use attribute selectors.

## When Overrides Are Needed

Most cases should NOT need overrides if using tokens correctly:

```css
/* No override needed - token handles it */
.component {
  background: var(--bg-color);      /* Automatically correct in dark */
  color: var(--text-color);         /* Automatically correct in dark */
  border-color: var(--border-color); /* Automatically correct in dark */
}
```

**Override only when:**
1. Using `rgba()` values that need different opacity in dark
2. Using specific visual effects (shadows, glows)
3. Adjusting contrast for readability

## Common Dark Theme Patterns

### Shadows
```css
.popup {
  box-shadow: var(--popup-shadow);
}

.dark-theme .popup {
  box-shadow: var(--popup-shadow-dark);
}
```

### Hover States

**Prefer tokens over hardcoded rgba:**

```css
/* CORRECT - uses token */
.item:hover {
  background: var(--hover-bg);
}

/* WRONG - hardcoded rgba bypasses theme system */
.item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.dark-theme .item:hover {
  background: rgba(255, 255, 255, 0.06);  /* Extra maintenance burden */
}
```

**Only use raw rgba when:**
1. The token doesn't exist yet (file an issue to add it)
2. You need a non-standard opacity for a specific visual effect

**Scrollbar colors:**
```css
/* CORRECT - tokens adapt to theme */
::-webkit-scrollbar-thumb {
  background: var(--border-color);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--md-char-color);
}
```

### Search Highlights
```css
.search-match {
  background: rgba(255, 200, 0, 0.3);
}

.dark-theme .search-match {
  background: rgba(255, 200, 0, 0.25);
}
```

### Subtle Backgrounds
```css
.subtle-bg {
  background: rgba(0, 0, 0, 0.02);
}

.dark-theme .subtle-bg {
  background: rgba(255, 255, 255, 0.03);
}
```

## Tokens with Built-in Dark Support

These tokens are automatically updated by `useTheme.ts`:

| Token | Light | Dark |
|-------|-------|------|
| `--bg-color` | Theme-specific | Theme-specific |
| `--text-color` | `#1a1a1a` | Light text |
| `--text-secondary` | `#666666` | `#858585` |
| `--border-color` | `#d5d4d4` | Darker border |
| `--selection-color` | Blue tint | Cyan tint |
| `--md-char-color` | `#777777` | `#6a9955` |
| `--accent-bg` | Blue 10% | Blue 12% |
| `--error-color` | `#cf222e` | `#f85149` |
| `--error-bg` | `#ffebe9` | Red 15% |

### Dark Alert Tokens

Alert blocks use centralized dark tokens (defined in `index.css`):

| Light Token | Dark Token |
|-------------|------------|
| `--alert-note` | `--alert-note-dark` (#58a6ff) |
| `--alert-tip` | `--alert-tip-dark` (#3fb950) |
| `--alert-important` | `--alert-important-dark` (#a371f7) |
| `--alert-warning` | `--alert-warning-dark` (#d29922) |
| `--alert-caution` | `--alert-caution-dark` (#f85149) |

**Pattern for dark alert backgrounds:**
```css
.dark-theme .alert-note {
  --alert-border: var(--alert-note-dark);
  --alert-bg: color-mix(in srgb, var(--alert-note-dark) 8%, transparent);
}
```

## Testing Requirements

1. **Visual check in both themes** before committing CSS changes
2. **Use reference document** - open `dev-docs/css-reference.md` to verify all elements (local, not in repo)
3. **Contrast ratio** - text must be readable (WCAG AA: 4.5:1)
4. **Focus indicators** - must be visible in dark theme
5. **Shadows** - verify depth perception works in dark
6. **Compare screenshots** - check against `dev-docs/archive/screenshots/` baselines (local)

## Avoiding Common Mistakes

```css
/* WRONG: Hardcoded color won't adapt */
.component {
  background: #f5f5f5;
}

/* CORRECT: Token adapts automatically */
.component {
  background: var(--bg-secondary);
}

/* WRONG: White text hardcoded */
.active-item {
  color: white;
}

/* CORRECT: Inverts properly */
.active-item {
  color: var(--bg-color);
}
```

## Migration Checklist

When fixing old code:
- [ ] Replace `[data-theme="night"]` with `.dark-theme`
- [ ] Replace hardcoded colors with tokens
- [ ] Add `.dark-theme` override if using `rgba()`
- [ ] Test both themes visually
