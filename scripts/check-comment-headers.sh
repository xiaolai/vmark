#!/usr/bin/env bash
#
# Pre-commit hook: warn if a modified source file has a Purpose: header
# but the header lines weren't touched in this commit.
#
# This is a soft check — it prints warnings but does NOT block the commit.
# It catches "forgot to update docs" cases without producing false positives
# on pure-comment or trivial changes.

set -euo pipefail

WARN_COUNT=0

# Get staged files (only modifications, not additions/deletions)
STAGED=$(git diff --cached --name-only --diff-filter=M)

for file in $STAGED; do
  # Only check TypeScript/TSX and Rust source files
  case "$file" in
    *.ts|*.tsx|*.rs) ;;
    *) continue ;;
  esac

  # Skip test files
  case "$file" in
    *.test.*|*.spec.*|*__tests__*) continue ;;
  esac

  # Check if file has a Purpose: header
  if ! grep -q "Purpose:" "$file" 2>/dev/null; then
    continue
  fi

  # Check if the staged diff touches any comment lines (lines starting with
  # *, //, //!, or containing Purpose:/Pipeline:/Key decisions:/Known limitations:/@coordinates-with)
  DIFF=$(git diff --cached -U0 "$file")
  if echo "$DIFF" | grep -qE '^\+.*(Purpose:|Pipeline:|Key decisions:|Known limitations:|@coordinates-with|@edge-case|@module)'; then
    # Header was updated — good
    continue
  fi

  # Header exists but wasn't touched — warn
  WARN_COUNT=$((WARN_COUNT + 1))
  echo "  warning: $file has a Purpose: header that wasn't updated"
done

if [ "$WARN_COUNT" -gt 0 ]; then
  echo ""
  echo "  $WARN_COUNT file(s) with doc headers were modified without updating comments."
  echo "  Review whether the Purpose/Pipeline/Key decisions still match the code."
  echo ""
fi

exit 0
