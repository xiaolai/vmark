#!/bin/bash
# decode-curly-quotes.sh
# PostToolUse hook: converts \uXXXX escape sequences back to real Unicode
# after Claude writes/edits files.
#
# Why: The Claude API silently normalizes curly quotes and CJK punctuation
# to ASCII equivalents. Claude writes \uXXXX escapes as a workaround;
# this hook converts them back to proper Unicode on disk.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

[ -z "$FILE_PATH" ] && exit 0
[ ! -f "$FILE_PATH" ] && exit 0

# Never run on ourselves -- self-modification corrupts the perl regexes
case "$FILE_PATH" in
  */decode-curly-quotes.sh) exit 0 ;;
esac

# Only process text files
if file --mime-type "$FILE_PATH" 2>/dev/null | grep -qv 'text/'; then
  exit 0
fi

# Check if file contains any \uXXXX sequences before running perl
# Note: use grep -E (not -P) -- macOS BSD grep lacks -P support
if ! grep -qE '\\u[0-9A-Fa-f]{4}' "$FILE_PATH" 2>/dev/null; then
  exit 0
fi

# Convert Unicode escape sequences to actual characters
perl -i -CS -pe '
  s/\\u201C/\x{201C}/g;
  s/\\u201D/\x{201D}/g;
  s/\\u2018/\x{2018}/g;
  s/\\u2019/\x{2019}/g;
  s/\\u300C/\x{300C}/g;
  s/\\u300D/\x{300D}/g;
  s/\\u300E/\x{300E}/g;
  s/\\u300F/\x{300F}/g;
  s/\\u3010/\x{3010}/g;
  s/\\u3011/\x{3011}/g;
  s/\\u2014/\x{2014}/g;
  s/\\u2013/\x{2013}/g;
  s/\\u2026/\x{2026}/g;
  s/\\uFF08/\x{FF08}/g;
  s/\\uFF09/\x{FF09}/g;
  s/\\uFF0C/\x{FF0C}/g;
  s/\\uFF1A/\x{FF1A}/g;
  s/\\uFF1B/\x{FF1B}/g;
  s/\\uFF01/\x{FF01}/g;
  s/\\uFF1F/\x{FF1F}/g;
' "$FILE_PATH"

exit 0
