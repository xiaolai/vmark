#!/usr/bin/env bash
#
# Pre-commit hook: warn if a modified source file has a Purpose: header
# but the header lines weren't touched in this commit.
#
# This is a soft check — it prints warnings but does NOT block the commit.
# It catches "forgot to update docs" cases without producing false positives
# on pure-comment or trivial changes.
#
# "Touched" means the commit changed a line INSIDE the file's leading comment
# block. It used to mean "added a line containing Purpose:/Pipeline:/@module/…",
# which only matches an edit to a header's LABEL lines — so rewriting the body
# of a Key-decisions bullet, the single commonest way a header is legitimately
# updated, counted as not touching it at all. Measured on one real commit: three
# of six warnings were files whose headers HAD been updated. A warning that is
# wrong half the time is one people learn to scroll past, which costs more than
# the check was ever worth. The keyword rule is kept as an OR, for headers that
# do not lead the file (a Rust `//!` block under attributes).

set -euo pipefail

WARN_COUNT=0

# Staged modifications only (not additions/deletions), NUL-delimited: an
# unquoted `for file in $STAGED` word-split on spaces and glob-expanded, so an
# ordinary path like `src/with space.ts` was mangled into two nonexistent files.
while IFS= read -r -d '' file; do
  # Only check TypeScript/TSX and Rust source files
  case "$file" in
    *.ts|*.tsx|*.rs) ;;
    *) continue ;;
  esac

  # Skip test files
  case "$file" in
    *.test.*|*.spec.*|*__tests__*) continue ;;
  esac

  # Read the STAGED blob, not the working tree. The diff below describes the
  # index, so judging it against the file on disk compares two different
  # versions: with a partially staged file the header text and its line
  # boundaries both come out wrong, and the warning is about content git is not
  # committing. `git show ":$file"` is the version being committed.
  CONTENT=$(git show ":$file" 2>/dev/null) || continue

  # Check if file has a Purpose: header
  if ! printf '%s\n' "$CONTENT" | grep -q "Purpose:"; then
    continue
  fi

  DIFF=$(git diff --cached -U0 "$file")

  # A label line was added — unambiguous, and covers headers that do not lead
  # the file. The line must LOOK like a comment: the rule used to match the
  # label anywhere on an added line, so shipping `const s = "Purpose: ..."`
  # silenced the warning for the whole file.
  # Only `//`, `/*` and a `*` FOLLOWED BY WHITESPACE count. This hook scans
  # .ts/.tsx/.rs, and in those languages the other spellings are real code:
  # `#` begins a TypeScript private field and a Rust attribute, and a bare `*`
  # begins a Rust deref assignment (`*slot = "Purpose: ..."`). A JSDoc
  # continuation always separates the asterisk from its text, so requiring that
  # separator keeps every real header line and drops the code.
  if echo "$DIFF" | grep -qE '^\+[[:space:]]*(\*[[:space:]]|\*$|//|/\*).*(Purpose:|Pipeline:|Key decisions:|Known limitations:|@coordinates-with|@edge-case|@module)'; then
    continue
  fi

  # Otherwise: did the commit change any line inside the LEADING comment block?
  # `awk` reports the last line of that block — the run of `//`, `/*`, `*`, `#!`
  # and blank lines before the first line of real code.
  HEADER_END=$(printf '%s\n' "$CONTENT" | awk '
    /^[[:space:]]*(\/\/|\/\*|\*|#!)/ { last = NR; next }
    /^[[:space:]]*$/ { next }
    { exit }
    END { print last + 0 }
  ')
  [ "${HEADER_END:-0}" -gt 0 ] || HEADER_END=0

  # The header block as it stood BEFORE this change. A deletion is ambiguous on
  # the new side — removing the last header line and removing the first body
  # line produce the identical `+c,0` position — so deletions are judged
  # against the OLD header block, where the removed lines are stated exactly.
  OLD_CONTENT=$(git show "HEAD:$file" 2>/dev/null || true)
  OLD_HEADER_END=$(printf '%s\n' "$OLD_CONTENT" | awk '
    /^[[:space:]]*(\/\/|\/\*|\*|#!)/ { last = NR; next }
    /^[[:space:]]*$/ { next }
    { exit }
    END { print last + 0 }
  ')
  [ -n "${OLD_HEADER_END:-}" ] || OLD_HEADER_END=0

  # `@@ -a,b +c,d @@` — d lines added at c, b lines removed from a.
  #   * added/changed lines count when they land in the NEW header block;
  #   * removed lines count when they came OUT of the OLD header block —
  #     deleting a limitation that no longer applies IS updating the header.
  if { [ "$HEADER_END" -gt 0 ] || [ "$OLD_HEADER_END" -gt 0 ]; } && echo "$DIFF" | awk \
    -v newEnd="$HEADER_END" -v oldEnd="$OLD_HEADER_END" '
    /^@@/ {
      match($0, /\+[0-9]+(,[0-9]+)?/)
      split(substr($0, RSTART + 1, RLENGTH - 1), plus, ",")
      addStart = plus[1] + 0
      addCount = (2 in plus) ? plus[2] + 0 : 1
      if (addCount > 0 && addStart <= newEnd) { found = 1 }

      match($0, /-[0-9]+(,[0-9]+)?/)
      split(substr($0, RSTART + 1, RLENGTH - 1), minus, ",")
      delStart = minus[1] + 0
      delCount = (2 in minus) ? minus[2] + 0 : 1
      if (delCount > 0 && delStart <= oldEnd) { found = 1 }
    }
    END { exit found ? 0 : 1 }
  '; then
    continue
  fi

  # Header exists but wasn't touched — warn
  WARN_COUNT=$((WARN_COUNT + 1))
  echo "  warning: $file has a Purpose: header that wasn't updated"
done < <(git diff --cached --name-only -z --diff-filter=M)

if [ "$WARN_COUNT" -gt 0 ]; then
  echo ""
  echo "  $WARN_COUNT file(s) with doc headers were modified without updating comments."
  echo "  Review whether the Purpose/Pipeline/Key decisions still match the code."
  echo ""
fi

exit 0
