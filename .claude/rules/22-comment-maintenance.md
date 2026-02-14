# 22 - Comment Maintenance

When modifying code in files that have AI-maintenance documentation comments, keep the comments in sync with the code.

## What Counts as a Documented File

Files with a `Purpose:` line in their header block, or Rust files with `//!` module docs.

## When to Update Comments

| Change Type | Action Required |
|-------------|-----------------|
| Change function behavior | Update its TSDoc / `///` doc |
| Add/remove/rename exports | Add/remove/update their docs |
| Change what a file coordinates with | Update `@coordinates-with` lines |
| Change data flow or pipeline | Update `Pipeline:` in header |
| Change a design decision | Update `Key decisions:` in header |
| Fix a known limitation | Remove it from `Known limitations:` |
| Add a new edge case handler | Add `@edge-case` inline comment |
| Rename a file | Update `@module` path and any `@coordinates-with` references in other files |

## When NOT to Update Comments

- Drive-by comment updates in files you didn't modify — don't touch unrelated files
- Whitespace-only or import-order changes — no doc change needed
- Test file changes — test files don't have maintenance comments

## Comment Rot Prevention

- Never write comments that reference line numbers, dates, or author names
- Never leave `// TODO` without a concrete description of what needs doing
- If you notice a stale comment while editing, fix it in the same commit

## Quick Check

Before committing, scan your changed files for `Purpose:` headers and verify they still accurately describe what the file does.
