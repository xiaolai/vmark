#!/bin/bash
# CSS Quick Check - Run before/after CSS changes
# Usage: bash scripts/css-quick-check.sh

cd "$(dirname "$0")/.."

echo "=== CSS Quick Check ==="
echo ""

# 1. Missing Fallbacks for --list-indent
echo "1. Missing --list-indent Fallbacks:"
MISSING=$(grep -rn 'var(--list-indent)' src/ --include="*.css" 2>/dev/null | grep -v ', 1em)' | grep -v ':root' || true)
if [ -z "$MISSING" ]; then
  echo "   ✓ All --list-indent uses have fallbacks"
else
  echo "   ✗ Missing fallbacks:"
  echo "$MISSING" | sed 's/^/     /'
fi
echo ""

# 2. Hardcoded Dark Mode Hover (exclude index.css where token is defined)
echo "2. Hardcoded Dark Hover (rgba 255,255,255,0.08):"
COUNT=$(grep -rn 'rgba(255, 255, 255, 0.08)' src/ --include="*.css" 2>/dev/null | grep -v 'index.css' | wc -l | tr -d ' ')
if [ "$COUNT" = "0" ]; then
  echo "   ✓ None found"
else
  echo "   ✗ $COUNT occurrences (should use --hover-bg-dark token)"
  grep -rn 'rgba(255, 255, 255, 0.08)' src/ --include="*.css" 2>/dev/null | grep -v 'index.css' | head -5 | sed 's/^/     /'
fi
echo ""

# 3. Container Margin Consistency
echo "3. Container Block Margins:"
BQ_MARGIN=$(grep -E '\.tiptap-editor blockquote \{' -A5 src/components/Editor/editor.css 2>/dev/null | grep 'margin:' | head -1 | sed 's/.*margin: //' | sed 's/;.*//' || echo "?")
ALERT_MARGIN=$(grep -E '\.alert-block \{' -A5 src/plugins/alertBlock/alert-block.css 2>/dev/null | grep 'margin:' | head -1 | sed 's/.*margin: //' | sed 's/;.*//' || echo "?")
DETAILS_MARGIN=$(grep -E '\.details-block \{' -A5 src/plugins/detailsBlock/details-block.css 2>/dev/null | grep 'margin:' | head -1 | sed 's/.*margin: //' | sed 's/;.*//' || echo "?")
echo "   Blockquote: $BQ_MARGIN"
echo "   Alert:      $ALERT_MARGIN"
echo "   Details:    $DETAILS_MARGIN"
if [ "$BQ_MARGIN" = "$ALERT_MARGIN" ] && [ "$ALERT_MARGIN" = "$DETAILS_MARGIN" ]; then
  echo "   ✓ All consistent"
else
  echo "   ✗ Inconsistent margins"
fi
echo ""

# 4. Details Focus State
echo "4. Details Summary Focus State:"
if grep -q 'focus-visible' src/plugins/detailsBlock/details-block.css 2>/dev/null; then
  echo "   ✓ :focus-visible defined"
else
  echo "   ✗ Missing :focus-visible for summary element"
fi
echo ""

# 5. List Padding Multipliers
echo "5. List Padding Multipliers:"
BQ_MULT=$(grep -E 'list-indent.*\* [0-9.]+' src/components/Editor/editor.css 2>/dev/null | grep -oE '\* [0-9.]+' | head -1 || echo "* 2")
ALERT_MULT=$(grep -E 'list-indent.*\* [0-9.]+' src/plugins/alertBlock/alert-block.css 2>/dev/null | grep -oE '\* [0-9.]+' | head -1 || echo "* 2")
DETAILS_MULT=$(grep -E 'list-indent.*\* [0-9.]+' src/plugins/detailsBlock/details-block.css 2>/dev/null | grep -oE '\* [0-9.]+' | head -1 || echo "* 2")
echo "   Blockquote: $BQ_MULT"
echo "   Alert:      $ALERT_MULT"
echo "   Details:    $DETAILS_MULT"
if [ "$DETAILS_MULT" != "$ALERT_MULT" ]; then
  echo "   ✗ Details uses different multiplier"
else
  echo "   ✓ All consistent"
fi
echo ""

# 6. Nested Content Rules
echo "6. Nested Content Rules in Containers:"
echo "   Block        | code | table | img | hr"
echo "   -------------|------|-------|-----|----"

# Blockquote
bq_code=$(grep -cE 'blockquote.*code|blockquote code' src/components/Editor/editor.css 2>/dev/null | head -1 || echo "0")
bq_table=$(grep -cE 'blockquote.*table' src/components/Editor/editor.css 2>/dev/null | head -1 || echo "0")
bq_img=$(grep -cE 'blockquote.*img' src/components/Editor/editor.css 2>/dev/null | head -1 || echo "0")
bq_hr=$(grep -cE 'blockquote.*hr' src/components/Editor/editor.css 2>/dev/null | head -1 || echo "0")
[ "${bq_code:-0}" -gt 0 ] 2>/dev/null && c1="✓" || c1="✗"
[ "${bq_table:-0}" -gt 0 ] 2>/dev/null && c2="✓" || c2="✗"
[ "${bq_img:-0}" -gt 0 ] 2>/dev/null && c3="✓" || c3="✗"
[ "${bq_hr:-0}" -gt 0 ] 2>/dev/null && c4="✓" || c4="✗"
echo "   blockquote   |  $c1   |   $c2   |  $c3  |  $c4"

# Alert
al_code=$(grep -cE 'alert.*code|alert code' src/plugins/alertBlock/alert-block.css 2>/dev/null | head -1 || echo "0")
al_table=$(grep -cE 'alert.*table' src/plugins/alertBlock/alert-block.css 2>/dev/null | head -1 || echo "0")
al_img=$(grep -cE 'alert.*img' src/plugins/alertBlock/alert-block.css 2>/dev/null | head -1 || echo "0")
al_hr=$(grep -cE 'alert.*hr' src/plugins/alertBlock/alert-block.css 2>/dev/null | head -1 || echo "0")
[ "${al_code:-0}" -gt 0 ] 2>/dev/null && c1="✓" || c1="✗"
[ "${al_table:-0}" -gt 0 ] 2>/dev/null && c2="✓" || c2="✗"
[ "${al_img:-0}" -gt 0 ] 2>/dev/null && c3="✓" || c3="✗"
[ "${al_hr:-0}" -gt 0 ] 2>/dev/null && c4="✓" || c4="✗"
echo "   alert        |  $c1   |   $c2   |  $c3  |  $c4"

# Details
de_code=$(grep -cE 'details.*code|details code' src/plugins/detailsBlock/details-block.css 2>/dev/null | head -1 || echo "0")
de_table=$(grep -cE 'details.*table' src/plugins/detailsBlock/details-block.css 2>/dev/null | head -1 || echo "0")
de_img=$(grep -cE 'details.*img' src/plugins/detailsBlock/details-block.css 2>/dev/null | head -1 || echo "0")
de_hr=$(grep -cE 'details.*hr' src/plugins/detailsBlock/details-block.css 2>/dev/null | head -1 || echo "0")
[ "${de_code:-0}" -gt 0 ] 2>/dev/null && c1="✓" || c1="✗"
[ "${de_table:-0}" -gt 0 ] 2>/dev/null && c2="✓" || c2="✗"
[ "${de_img:-0}" -gt 0 ] 2>/dev/null && c3="✓" || c3="✗"
[ "${de_hr:-0}" -gt 0 ] 2>/dev/null && c4="✓" || c4="✗"
echo "   details      |  $c1   |   $c2   |  $c3  |  $c4"
echo ""

echo "=== Check Complete ==="
