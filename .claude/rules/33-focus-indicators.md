# 33 - Focus Indicators (Accessibility)

Keyboard focus must ALWAYS be visible. This is a WCAG requirement.

## Focus Patterns by Component Type

### 1. Toolbar/Popup Buttons: U-Shaped Underline

```css
.btn:focus-visible {
  outline: none;
  position: relative;
}

.btn:focus-visible::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 4px;
  right: 4px;
  height: 2px;
  background: var(--primary-color);
  border-radius: 1px;
}
```

**Use for:** Toolbar buttons, popup action buttons, icon buttons

### 2. Text Inputs in Popups: Caret Only

```css
.popup-input:focus {
  outline: none;
  box-shadow: none;
  border: none;
  /* Caret visibility is the focus indicator */
}
```

**Use for:** Inline edit fields, URL inputs, filter inputs within popups

**Exception:** If the input has a border normally, you may use a subtle background:
```css
.popup-input:focus {
  background: var(--bg-tertiary);
}
```

**Caret-only must be DECLARED.** No CSS analysis can see a caret, so
`pnpm lint:design-tokens` cannot distinguish this sanctioned pattern from a
button that simply lost its focus ring. Mark the rule:

```css
/* focus: caret-only — borderless text input in a popup; the caret is the
   indicator (.claude/rules/33-focus-indicators.md §2). */
.popup-input:focus,
.popup-input:focus-visible {
  outline: none;
  box-shadow: none;
}
```

The **reason is required** — the gate rejects a bare `/* focus: caret-only */`,
because a token with no justification is a mute button. Nine such rules exist;
`grep -rn "focus: caret-only" src` is the audit.

You do not need the marker when a `:focus-visible` rule on the same selector
paints something (`background`, a real `outline`, `border` or `box-shadow`) —
the gate reads that as the replacement and stays quiet.

### 3. Dialog Inputs: Bottom Border Highlight

```css
.dialog-input {
  border: none;
  border-bottom: 1px solid var(--border-color);
  outline: none;
}

.dialog-input:focus {
  border-bottom-color: var(--primary-color);
}
```

**Use for:** Form inputs in settings, modal dialogs, rename fields

### 4. Standalone Buttons: Standard Outline

```css
.standalone-btn:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
```

**Use for:** Primary action buttons outside popups, dialog submit buttons

### 5. List Items: Background Highlight

```css
.list-item:focus-visible {
  outline: none;
  background: var(--accent-bg);
}
```

**Use for:** File explorer items, dropdown menu items, autocomplete suggestions

### 6. Content Widgets (Checkboxes, Interactive Embeds): Outline or Background

```css
/* Task list checkbox */
.task-list-checkbox:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 1px;
}

/* Or use background highlight */
.task-list-checkbox:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-bg);
}
```

**Use for:** Task list checkboxes, embedded controls, clickable widgets within editor content

**Rule:** Global focus reset removes outlines — content widgets MUST define their own `:focus-visible` style.

## Rules

1. **NEVER remove focus without replacement**
   ```css
   /* WRONG - accessibility violation */
   .input:focus {
     outline: none;
   }

   /* CORRECT - replace with visible indicator */
   .input:focus {
     outline: none;
     border-bottom-color: var(--primary-color);
   }
   ```

2. **NEVER use `outline: none` globally on inputs**

3. **Avoid double indicators**
   - If using U-shaped underline, remove outline
   - If using border highlight, remove outline
   - Never combine outline + border + background

4. **Dark theme parity required**
   - Test focus visibility in night theme
   - `--primary-color` should contrast in both themes

5. **Focus must work without color alone**
   - Shape change (underline) helps colorblind users
   - Don't rely solely on color change

## Common Violations to Avoid

```css
/* VIOLATION: No focus indicator at all */
.input:focus {
  outline: none;
  box-shadow: none;
}

/* VIOLATION: Focus only visible via color */
.btn:focus {
  color: var(--primary-color);  /* Not enough */
}

/* VIOLATION: Focus indicator too subtle */
.item:focus {
  opacity: 0.9;  /* Not perceivable */
}
```

## Testing Checklist

- [ ] Tab through all interactive elements
- [ ] Verify focus is visible at each stop
- [ ] Test in light AND dark themes
- [ ] Ensure focus order is logical
- [ ] Check focus visibility at different zoom levels
