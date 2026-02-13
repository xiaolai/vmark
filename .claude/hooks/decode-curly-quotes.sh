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

# Only process text files
if file --mime-type "$FILE_PATH" 2>/dev/null | grep -qv 'text/'; then
  exit 0
fi

# Check if file contains any \uXXXX sequences before running perl
if ! grep -qP '\\u[0-9A-Fa-f]{4}' "$FILE_PATH" 2>/dev/null; then
  exit 0
fi

# Convert Unicode escape sequences to actual characters
perl -i -CS -pe '
  # Curly quotes
  s/\\u201C/\x{201C}/g;   # " left double quotation mark
  s/\\u201D/\x{201D}/g;   # " right double quotation mark
  s/\\u2018/\x{2018}/g;   # ' left single quotation mark
  s/\\u2019/\x{2019}/g;   # ' right single quotation mark
  # CJK brackets
  s/\\u300C/\x{300C}/g;   # 「 left corner bracket
  s/\\u300D/\x{300D}/g;   # 」 right corner bracket
  s/\\u300E/\x{300E}/g;   # 『 left white corner bracket
  s/\\u300F/\x{300F}/g;   # 』 right white corner bracket
  s/\\u3010/\x{3010}/g;   # 【 left black lenticular bracket
  s/\\u3011/\x{3011}/g;   # 】 right black lenticular bracket
  # Typography
  s/\\u2014/\x{2014}/g;   # — em dash
  s/\\u2013/\x{2013}/g;   # – en dash
  s/\\u2026/\x{2026}/g;   # … ellipsis
  # Fullwidth CJK punctuation
  s/\\uFF08/\x{FF08}/g;   # （ fullwidth left parenthesis
  s/\\uFF09/\x{FF09}/g;   # ） fullwidth right parenthesis
  s/\\uFF0C/\x{FF0C}/g;   # ， fullwidth comma
  s/\\uFF1A/\x{FF1A}/g;   # ： fullwidth colon
  s/\\uFF1B/\x{FF1B}/g;   # ； fullwidth semicolon
  s/\\uFF01/\x{FF01}/g;   # ！ fullwidth exclamation mark
  s/\\uFF1F/\x{FF1F}/g;   # ？ fullwidth question mark
' "$FILE_PATH"

exit 0
