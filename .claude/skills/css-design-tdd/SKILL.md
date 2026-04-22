---
name: css-design-tdd
description: Test-driven CSS design system modifications. Run checks before/after CSS changes to verify token usage, variable definitions, fallbacks, and consistency. Use when modifying CSS tokens, fixing design inconsistencies, or auditing CSS architecture.
---

# CSS Design System TDD

## Overview

Apply TDD principles to CSS design system work:
1. **RED**: Run checks that reveal current issues
2. **GREEN**: Fix CSS to pass checks
3. **REFACTOR**: Verify no regressions, clean up

## Available Checks

### 1. Undefined Variable Check
Find CSS variables used but never defined:

```bash
# Extract all var(--name) usages
grep -rhoE 'var\(--[a-zA-Z0-9-]+' src/**/*.css | sort -u | sed 's/var(//' > /tmp/css-vars-used.txt

# Extract all --name: definitions
grep -rhoE '^[[:space:]]*--[a-zA-Z0-9-]+:' src/**/*.css | sed 's/://' | sed 's/^[[:space:]]*//' | sort -u > /tmp/css-vars-defined.txt

# Find undefined (used but not defined)
comm -23 /tmp/css-vars-used.txt /tmp/css-vars-defined.txt
```

### 2. Missing Fallback Check
Find `var(--name)` without fallbacks in container blocks:

```bash
# Blockquote variables without fallback
grep -n 'var(--[^,)]*)[^,]' src/components/Editor/editor.css | grep -E 'blockquote|alert|details'

# All containers - should have fallbacks for --list-indent, etc.
grep -rn 'var(--list-indent)' src/**/*.css  # Should be var(--list-indent, 1em)
```

### 3. Hardcoded Color Check
Find hex/rgba colors that should be tokens:

```bash
# Hex colors outside :root definitions
grep -rn '#[0-9a-fA-F]\{3,6\}' src/**/*.css | grep -v ':root' | grep -v 'var(--'

# Hardcoded rgba (should be tokens in dark mode)
grep -rn 'rgba(255, 255, 255' src/**/*.css | grep -v ':root'
```

### 4. Container Consistency Check
Verify container blocks use consistent values:

```bash
# Check margins across containers
echo "=== MARGINS ==="
grep -rn 'margin:.*em' src/components/Editor/editor.css src/plugins/alertBlock/*.css src/plugins/detailsBlock/*.css

# Check padding
echo "=== PADDING ==="
grep -rn 'padding:' src/components/Editor/editor.css src/plugins/alertBlock/*.css src/plugins/detailsBlock/*.css | head -20

# Check list multipliers
echo "=== LIST MULTIPLIERS ==="
grep -rn 'list-indent.*\*' src/**/*.css
```

### 5. Focus Indicator Check
Find interactive elements without focus styles:

```bash
# Find elements with hover but no focus-visible
for file in src/**/*.css; do
  if grep -q ':hover' "$file" && ! grep -q ':focus-visible\|:focus' "$file"; then
    echo "Missing focus: $file"
  fi
done
```

### 6. Token Usage Audit
Check if specific tokens are used consistently:

```bash
# Radius token usage
echo "=== RADIUS ==="
grep -rn 'border-radius:' src/**/*.css | grep -v 'var(--radius'

# Shadow token usage
echo "=== SHADOWS ==="
grep -rn 'box-shadow:' src/**/*.css | grep -v 'var(--shadow\|var(--popup-shadow'
```

## TDD Workflow

### Phase 1: RED (Establish Baseline)

```bash
# Run all checks, save baseline
echo "=== CSS TDD BASELINE ===" > /tmp/css-baseline.txt
echo "Date: $(date)" >> /tmp/css-baseline.txt

# Run each check category
echo -e "\n### Undefined Variables ###" >> /tmp/css-baseline.txt
# ... run check 1 ...

echo -e "\n### Missing Fallbacks ###" >> /tmp/css-baseline.txt
# ... run check 2 ...

# Count issues
echo -e "\n### Summary ###" >> /tmp/css-baseline.txt
wc -l /tmp/css-baseline.txt
```

### Phase 2: GREEN (Fix Issues)

For each issue category:

1. **Read the target file** to understand context
2. **Make the minimal fix** (add fallback, use token, etc.)
3. **Re-run the specific check** to verify fix

Example fix workflow:
```bash
# Before: verify issue exists
grep -n 'var(--list-indent)' src/components/Editor/editor.css

# Make fix in editor.css (add fallback)
# var(--list-indent) → var(--list-indent, 1em)

# After: verify issue resolved
grep -n 'var(--list-indent)' src/components/Editor/editor.css  # Should show fallbacks
```

### Phase 3: REFACTOR (Verify No Regressions)

```bash
# Run full check suite again
# Compare to baseline - issues should decrease, not increase

# Visual verification
pnpm dev  # Check in browser: light mode, dark mode, all container types
```

## Check Scripts

### Quick Check (run before/after changes)

```bash
#!/bin/bash
# scripts/css-quick-check.sh

echo "=== CSS Quick Check ==="

echo -e "\n1. Missing Fallbacks:"
grep -rn 'var(--list-indent)[^,]' src/**/*.css 2>/dev/null | grep -v '1em)' || echo "  ✓ All fallbacks present"

echo -e "\n2. Hardcoded Dark Hover:"
grep -rn 'rgba(255, 255, 255, 0.08)' src/**/*.css 2>/dev/null | wc -l | xargs -I{} echo "  {} occurrences (should be 0)"

echo -e "\n3. Container Margin Consistency:"
echo "  Blockquote:" && grep -o 'margin:.*em' src/components/Editor/editor.css | grep -A1 blockquote | head -1
echo "  Alert:" && grep -o 'margin:.*em' src/plugins/alertBlock/alert-block.css | head -1
echo "  Details:" && grep -o 'margin:.*em' src/plugins/detailsBlock/details-block.css | head -1

echo -e "\n4. Focus States:"
for f in src/plugins/detailsBlock/*.css src/plugins/alertBlock/*.css; do
  if ! grep -q 'focus-visible' "$f" 2>/dev/null; then
    echo "  Missing focus-visible: $f"
  fi
done

echo -e "\nDone."
```

### Full Audit (run before major changes)

```bash
#!/bin/bash
# scripts/css-full-audit.sh

echo "=== CSS Full Audit ==="
echo "Date: $(date)"

echo -e "\n## 1. Undefined Variables"
grep -rhoE 'var\(--[a-zA-Z0-9-]+' src/**/*.css 2>/dev/null | sort -u | sed 's/var(//' > /tmp/used.txt
grep -rhoE '^\s*--[a-zA-Z0-9-]+:' src/**/*.css 2>/dev/null | sed 's/://' | tr -d ' ' | sort -u > /tmp/defined.txt
comm -23 /tmp/used.txt /tmp/defined.txt

echo -e "\n## 2. Hardcoded Hex Colors (outside :root)"
grep -rn '#[0-9a-fA-F]\{3,6\}' src/**/*.css 2>/dev/null | grep -v ':root' | grep -v '\.svg' | wc -l

echo -e "\n## 3. Hardcoded Z-Index"
grep -rn 'z-index: [0-9]' src/**/*.css 2>/dev/null | grep -v 'var(--' | wc -l

echo -e "\n## 4. Border Radius Not Using Tokens"
grep -rn 'border-radius:' src/**/*.css 2>/dev/null | grep -v 'var(--radius' | grep -v '0' | wc -l

echo -e "\n## 5. Missing Focus Indicators"
for f in $(find src -name "*.css" 2>/dev/null); do
  if grep -q ':hover' "$f" && ! grep -q ':focus' "$f"; then
    echo "  $f"
  fi
done

echo -e "\nAudit complete."
```

## Container Block Checklist

When modifying container blocks (blockquote, alert, details):

- [ ] Margin uses `1em 0` (consistent)
- [ ] Padding uses token or `0.75em 1em` pattern
- [ ] All `var()` calls have fallbacks
- [ ] `:focus-visible` defined for interactive elements
- [ ] Nested content rules exist (p, ul, ol, code, table)
- [ ] Border radius uses `--radius-md`
- [ ] Colors use tokens (no hardcoded hex in app CSS)

## Integration with pnpm check:all

The CSS check scripts above are inline examples — run them directly in your terminal or save locally. They are not committed project scripts.

## Reference Files

- Token definitions: `src/styles/index.css`
- Design system rules: `.claude/rules/31-design-tokens.md`
- Component patterns: `.claude/rules/32-component-patterns.md`
- Container audit: `dev-docs/audit/` (in repo)
