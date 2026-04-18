#!/bin/bash
# Lint for bare console.error/warn/log calls in production code.
# Allowed: utils/debug barrel + utils/debug/*.ts (define loggers),
# perfLog.ts (opt-in dev tool), test files, setup.ts, JSDoc comments,
# and template strings.

set -euo pipefail

# Find console.* calls in production TypeScript files
VIOLATIONS=$(grep -rn "console\.\(error\|warn\|log\)" src/ \
  --include="*.ts" --include="*.tsx" \
  | grep -v "node_modules" \
  | grep -v "\.test\." \
  | grep -v "__tests__" \
  | grep -v "utils/debug\.ts" \
  | grep -v "utils/debug/" \
  | grep -v "perfLog\.ts" \
  | grep -v "setup\.ts" \
  | grep -v " \* " \
  | grep -v "pdfHtmlTemplate\.ts" \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "ERROR: Found bare console.* calls in production code."
  echo "Use structured loggers from @/utils/debug instead."
  echo ""
  echo "$VIOLATIONS"
  exit 1
fi

echo "OK: No bare console.* calls found in production code."
