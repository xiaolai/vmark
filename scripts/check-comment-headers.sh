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
  # A label word counts only when the line carrying it is INSIDE A COMMENT.
  #
  # No prefix test can decide this. `//` and `/*` are unambiguous, but a JSDoc
  # continuation's `*` is spelled exactly like a Rust deref (`* slot = "..."`)
  # and a TypeScript generator (`* method() { ... }`), and `#` — tried and
  # removed — is a private field and an attribute. Successive prefix rules kept
  # admitting one more piece of real code, because the prefix is not the
  # property; position is. So the comment ranges are computed from the staged
  # blob, and an added line qualifies only if its NEW line number falls in one.
  #
  # `*` cannot simply be dropped either: this repo documents exports with JSDoc
  # BELOW the file header, and editing one is a genuine documentation update
  # that the leading-block rule further down cannot see.
  COMMENT_LINES=$(printf '%s\n' "$CONTENT" | awk '
    {
      isComment = 0
      if (inBlock) isComment = 1
      else if ($0 ~ /^[[:space:]]*\/\//) isComment = 1
      else if ($0 ~ /\/\*/) isComment = 1
      if ($0 ~ /\/\*/ && $0 !~ /\*\//) inBlock = 1
      else if (inBlock && $0 ~ /\*\//) inBlock = 0
      # Comma-separated, NOT newline-separated: BSD awk (macOS, the primary
      # platform here) rejects a -v value containing a newline with
      # "newline in string" — on stderr, leaving the if below false and the
      # detector silently switched off. No apostrophes in this block: it lives
      # inside a single-quoted awk program.
      if (isComment) printf "%s,", NR
    }')

  if echo "$DIFF" | awk -v commentLines="$COMMENT_LINES" '
    BEGIN {
      n = split(commentLines, rows, ",")
      for (i = 1; i <= n; i++) if (rows[i] != "") isComment[rows[i] + 0] = 1
      label = "(Purpose:|Pipeline:|Key decisions:|Known limitations:|@coordinates-with|@edge-case|@module)"
    }
    /^@@/ {
      match($0, /\+[0-9]+/)
      lineNo = substr($0, RSTART + 1, RLENGTH - 1) + 0
      inHunk = 1
      next
    }
    # Everything before the first @@ is diff preamble — and `+++ b/path` starts
    # with a `+`, so counting it as an added line shifted every line number
    # after it.
    !inHunk { next }
    /^\+/ {
      if ($0 ~ label && isComment[lineNo]) { found = 1 }
      lineNo++
      next
    }
    /^-/ { next }
    { lineNo++ }
    END { exit found ? 0 : 1 }
  '; then
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
